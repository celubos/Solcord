// SPDX-License-Identifier: Apache-2.0

export interface SolcordProductIdentity {
    product: "Solcord";
    numericVersion: `${number}.${number}.${number}`;
    candidateLabel: `v${string}`;
}

export const SOLCORD_PRODUCT_IDENTITY = Object.freeze({
    product: "Solcord",
    numericVersion: "2.0.1",
    candidateLabel: "v2.0.1-rc.8"
} satisfies SolcordProductIdentity);

export function assertSolcordPackageVersion(version: string): void {
    if (version !== SOLCORD_PRODUCT_IDENTITY.numericVersion) {
        throw new Error("Solcord package.json version does not match the typed product identity.");
    }
}
