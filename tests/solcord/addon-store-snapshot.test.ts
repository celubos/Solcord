import {describe, expect, mock, test} from "bun:test";
import React from "react";

const noop = () => {};
mock.module("@common/logger", () => ({"default": {debug: noop, warn: noop, stacktrace: noop}}));
mock.module("@common/i18n", () => ({t: (key: string) => key}));
mock.module("@stores/toasts", () => ({"default": {show: noop}}));
mock.module("@stores/json", () => ({"default": {get: noop, set: noop}}));
mock.module("@stores/settings", () => ({"default": {get: () => false, on: noop}}));
mock.module("@modules/pluginmanager", () => ({"default": {}}));
mock.module("@modules/thememanager", () => ({"default": {}}));
mock.module("@modules/addonmanager", () => ({"default": class {}}));
mock.module("@polyfill/request", () => ({"default": noop}));
mock.module("@ui/modals", () => ({"default": {}}));
mock.module("@ui/modals/installmodal", () => ({"default": () => null}));
mock.module("@data/web", () => ({"default": {resources: {thumbnail: (value: string) => value}}}));
mock.module("@modules/net", () => ({fetch: noop}));
mock.module("react", () => ({"default": React, ...React}));
const {default: AddonStore, Addon} = await import("../../src/betterdiscord/modules/addonstore");

describe("catalog cache snapshots", () => {
    test("repeated offline fallback replaces a deduplicated snapshot and expires removed indexes", () => {
        const records = Object.fromEntries(Array.from({length: 10}, (_, id) => [`Fixture${id}.plugin.js`, {
            id,
name: `Fixture${id}`,
type: "plugin",
file_name: `Fixture${id}.plugin.js`,
downloads: 1,
likes: 1,
            version: "1.0.0",
tags: [],
initial_release_date: "2026-01-01",
latest_release_date: "2026-01-01",
            thumbnail_url: "",
latest_source_url: "https://fixture.test/file",
description: "local fixture",
author: {github_id: 1, display_name: "fixture"}
        }]));
        const cache = AddonStore as unknown as {_cache: {addons: Record<string, unknown>; known: string[]; version: string;}; _useCache(): void;};
        cache._cache = {addons: {...records, duplicate: records["Fixture0.plugin.js"]}, known: ["Fixture0.plugin.js"], version: "fixture"};
        for (let cycle = 0; cycle < 5; cycle++) {cache._useCache(); expect(AddonStore.getAddons()).toHaveLength(10); expect(Object.keys(Addon.cache)).toHaveLength(10);}
        expect(cache._cache.known).toEqual(["Fixture0.plugin.js"]);
        delete cache._cache.addons["Fixture9.plugin.js"];
        cache._useCache();
        expect(AddonStore.getAddons()).toHaveLength(9);
        expect(AddonStore.getAddon("Fixture9")).toBeUndefined();
    });
});
