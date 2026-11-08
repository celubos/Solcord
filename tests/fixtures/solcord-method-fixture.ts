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

export function nativeIpcHandlerFixture(name: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/electron/main/modules/ipc.ts");
    const declarations = parsed.statements.filter(ts.isVariableStatement);
    const handler = declarations.flatMap(statement => statement.declarationList.declarations).find(declaration => declaration.name.getText(parsed) === name)?.initializer;
    if (!handler) throw new Error(`Production IPC handler is missing: ${name}`);
    const dependencies = declarations.filter(statement => statement.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === "SAFE_WEB_PREFERENCES")).map(statement => statement.getText(parsed)).join("\n");
    return evaluate(handler.getText(parsed), dependencies, bindings);
}

export function modalMethodFixture(name: string, bindings: Record<string, unknown>): FixtureMethod {
    const parsed = source("src/betterdiscord/ui/modals.ts");
    const owner = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "Modals") as ts.ClassDeclaration | undefined;
    const member = owner?.members.find(node => (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && node.name.getText(parsed) === name) as ts.MethodDeclaration | ts.GetAccessorDeclaration | undefined;
    if (!member?.body) throw new Error(`Production modal member is missing: ${name}`);
    return evaluate(`(function(${member.parameters.map(parameter => parameter.getText(parsed)).join(",")}) ${member.body.getText(parsed)})`, "", bindings);
}
