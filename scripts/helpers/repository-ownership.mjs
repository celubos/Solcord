// SPDX-License-Identifier: Apache-2.0
export const SOLCORD_OWNERSHIP_ROOTS = Object.freeze([
    "src/common/solcord/", "src/betterdiscord/modules/solcord/", "src/betterdiscord/ui/solcord/",
    "src/betterdiscord/styles/solcord.css", "installer/Solcord.Installer/", "scripts/", "tests/solcord/", "tests/installer/", "docs/"
]);

export function isSolcordOwned(file) {
    return SOLCORD_OWNERSHIP_ROOTS.some(root => root.endsWith("/") ? file.startsWith(root) : file === root)
        || file.startsWith("src/electron/") && /(?:^|\/)solcord[^/]*\.[^/]+$/.test(file);
}
