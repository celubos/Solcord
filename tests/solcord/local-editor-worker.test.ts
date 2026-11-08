import {afterEach, describe, expect, spyOn, test} from "bun:test";
import {createLocalMonacoWorker} from "../../src/common/monaco-worker";

const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const created: FakeWorker[] = [];
class FakeWorker extends EventTarget {
    terminated = false;
    constructor(readonly url: string) {super(); created.push(this);}
    terminate() {this.terminated = true;}
}
afterEach(() => {for (const worker of created.splice(0)) worker.terminate(); if (original) Object.defineProperty(globalThis, "Worker", original); else Reflect.deleteProperty(globalThis, "Worker");});
describe("local editor worker lifetime", () => {
    test("the blob bootstraps only local code and its URL is released on load and teardown", async () => {
        let blob: Blob | undefined;
        const create = spyOn(URL, "createObjectURL").mockImplementation(value => {blob = value as Blob; return "blob:fixture";});
        const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        Object.defineProperty(globalThis, "Worker", {configurable: true, writable: true, value: FakeWorker});
        try {
            const worker = createLocalMonacoWorker("workerMain.js", "css") as unknown as FakeWorker;
            expect(worker.url).toBe("blob:fixture");
            const code = await blob!.text();
            expect(code).toContain("solcord://editor/monaco/vs/base/worker/workerMain.js");
            expect(code).not.toMatch(/https?:/);
            worker.dispatchEvent(new MessageEvent("message"));
            worker.terminate(); worker.terminate();
            expect(revoke.mock.calls).toHaveLength(1); expect(worker.terminated).toBe(true);
            createLocalMonacoWorker("workerMain.js", "javascript");
            window.dispatchEvent(new Event("beforeunload"));
            expect(revoke.mock.calls).toHaveLength(2); expect(created.every(entry => entry.terminated)).toBe(true);
        }
        finally {create.mockRestore(); revoke.mockRestore();}
    });
});
