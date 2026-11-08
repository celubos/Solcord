// SPDX-License-Identifier: Apache-2.0

import {describe, expect, test} from "bun:test";
import {normalizeClientModCompatibilityConfig} from "../../src/electron/main/modules/client-mod-config";

describe("native compatibility settings and explicit consent", () => {
    test("valid JSON with a malformed document shape cannot crash window construction", () => {
        for (const value of [null, undefined, false, true, 0, 123, "", "false", [], [true]]) {
            expect(normalizeClientModCompatibilityConfig(value)).toEqual({shouldShow: true, allowPreloadOverride: false});
        }
    });
    test("truthy strings or numbers cannot grant unrestricted preload assignment", () => {
        for (const value of ["false", "true", "1", 1, {}, [], null, undefined, false]) {
            expect(normalizeClientModCompatibilityConfig({shouldShow: value, allowPreloadOverride: value}).allowPreloadOverride).toBe(false);
        }
        expect(normalizeClientModCompatibilityConfig({shouldShow: false, allowPreloadOverride: true})).toEqual({shouldShow: false, allowPreloadOverride: true});
    });
});
