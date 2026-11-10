import {expect, test} from "bun:test";
import {Script} from "node:vm";
import {renderDisposableAcceptanceShim} from "../../scripts/prepare-solcord-disposable-acceptance";
test("the exact generated disposable startup shim is valid JavaScript", () => {
    expect(() => new Script(renderDisposableAcceptanceShim())).not.toThrow();
});
