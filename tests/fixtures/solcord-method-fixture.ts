// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {Script} from "node:vm";

type FixtureMethod = (this: unknown, ...args: unknown[]) => unknown;

const sources = new Map<string, ts.SourceFile>();
function source(relative: string, kind = ts.ScriptKind.TS): ts.SourceFile {
    let parsed = sources.get(relative);
    if (!parsed) {
        const filename = path.resolve(import.meta.dir, "../..", relative);
        parsed = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, kind);
        sources.set(relative, parsed);
    }
    return parsed;
}

function evaluate(expression: string, declarations: string, bindings: Record<string, unknown>): FixtureMethod {
    const js = new Bun.Transpiler({loader: "ts"}).transformSync(`${declarations}\nconst implementation = ${expression};`);
    const factory = new Script(`(function(${Object.keys(bindings).join(",")}) {${js}\nreturn implementation;})`).runInThisContext() as (...values: unknown[]) => FixtureMethod;
    return factory(...Object.values(bindings));
}

/** Execute the shipping method body with controlled IPC/store boundaries and real models.
 * Only private-field spelling is adapted so the fixture can supply those boundaries.
 */
export function runtimeMethodFixture(name: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/betterdiscord/modules/solcord/runtime.ts");
    const runtime = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "SolcordRuntimeStore") as ts.ClassDeclaration | undefined;
    const method = runtime?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name) as ts.MethodDeclaration | undefined;
    if (!method?.body) throw new Error(`Production runtime method is missing: ${name}`);
    const declarations = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && ["errorName", "normalizeTimelineReadOutcome"].includes(node.name?.text ?? "")).map(node => node.getText(parsed)).join("\n");
    const asynchronous = method.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : "";
    return evaluate(`(${asynchronous}function(${method.parameters.map(parameter => parameter.getText(parsed)).join(",")}) ${method.body.getText(parsed).replaceAll("this.#", "this.")})`, declarations, bindings);
}

export function panelHandlerFixture(componentName: string, handlerName: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/betterdiscord/ui/solcord/panel.tsx", ts.ScriptKind.TSX);
    const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === componentName) as ts.FunctionDeclaration | undefined;
    let handler: ts.ArrowFunction | undefined;
    component?.body?.forEachChild(node => {
        if (!ts.isVariableStatement(node)) return;
        for (const declaration of node.declarationList.declarations) {
            if (declaration.name.getText(parsed) === handlerName && declaration.initializer && ts.isArrowFunction(declaration.initializer)) handler = declaration.initializer;
        }
    });
    if (!handler) throw new Error(`Production panel handler is missing: ${componentName}.${handlerName}`);
    return evaluate(handler.getText(parsed), "", bindings);
}

export function mainStartupMethodFixture(name: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/electron/main/modules/betterdiscord.ts");
    const owner = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "BetterDiscord") as ts.ClassDeclaration | undefined;
    const method = owner?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name) as ts.MethodDeclaration | undefined;
    if (!method?.body) throw new Error(`Production main startup method is missing: ${name}`);
    const asynchronous = method.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : "";
    return evaluate(`(${asynchronous}function(${method.parameters.map(parameter => parameter.getText(parsed)).join(",")}) ${method.body.getText(parsed)})`, "", bindings);
}

export function settingsMethodFixture(name: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/betterdiscord/ui/settings.tsx", ts.ScriptKind.TSX);
    const declaration = parsed.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).find(node => node.name.getText(parsed) === "SettingsRenderer");
    const initializer = declaration?.initializer;
    const owner = initializer && ts.isNewExpression(initializer) && ts.isClassExpression(initializer.expression) ? initializer.expression : undefined;
    const method = owner?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name) as ts.MethodDeclaration | undefined;
    if (!method?.body) throw new Error(`Production settings method is missing: ${name}`);
    const js = ts.transpileModule(`const implementation = function(${method.parameters.map(parameter => parameter.getText(parsed)).join(",")}) ${method.body.getText(parsed)};`, {
        compilerOptions: {target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.React, jsxFactory: "React.createElement", jsxFragmentFactory: "React.Fragment"}, fileName: "settings-method.tsx"
    }).outputText;
    return new Script(`(function(${Object.keys(bindings).join(",")}) {${js}\nreturn implementation;})`).runInThisContext()(...Object.values(bindings));
}

export function nativeIpcHandlerFixture(name: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/electron/main/modules/ipc.ts");
    const declarations = parsed.statements.filter(ts.isVariableStatement);
    const handler = declarations.flatMap(statement => statement.declarationList.declarations).find(declaration => declaration.name.getText(parsed) === name)?.initializer;
    if (!handler) throw new Error(`Production IPC handler is missing: ${name}`);
    const dependencies = declarations.filter(statement => statement.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === "SAFE_WEB_PREFERENCES")).map(statement => statement.getText(parsed)).join("\n");
    return evaluate(handler.getText(parsed), dependencies, bindings);
}

export function registeredNativeIpcHandlerFixture(event: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/electron/main/modules/ipc.ts");
    let handler: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(parsed) === "ipc.handle" && node.arguments[0]?.getText(parsed) === `IPCEvents.${event}`) handler = node.arguments[1];
        ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (!handler) throw new Error(`Production IPC registration is missing: ${event}`);
    return evaluate(handler.getText(parsed), "", bindings);
}

export function rendererIpcMethodFixture(name: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/betterdiscord/modules/ipc.ts");
    let method: ts.MethodDeclaration | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isClassExpression(node) && node.name?.text === "IPCRenderer") method = node.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(parsed) === name) as ts.MethodDeclaration | undefined;
        ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (!method?.body) throw new Error(`Production renderer IPC method is missing: ${name}`);
    return evaluate(`(function(${method.parameters.map(parameter => parameter.getText(parsed)).join(",")}) ${method.body.getText(parsed)})`, "", bindings);
}

export function modalMethodFixture(name: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/betterdiscord/ui/modals.ts");
    const owner = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "Modals") as ts.ClassDeclaration | undefined;
    const member = owner?.members.find(node => (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && node.name.getText(parsed) === name) as ts.MethodDeclaration | ts.GetAccessorDeclaration | undefined;
    if (!member?.body) throw new Error(`Production modal member is missing: ${name}`);
    return evaluate(`(function(${member.parameters.map(parameter => parameter.getText(parsed)).join(",")}) ${member.body.getText(parsed)})`, "", bindings);
}
