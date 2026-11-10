// SPDX-License-Identifier: Apache-2.0

import {SOLCORD_CATALOG_DETAIL_SHA256} from "@common/solcord/addon-trust.generated";
import type {AddonCandidate} from "@common/solcord/addon-catalog.generated";

let pending: Promise<readonly AddonCandidate[]> | undefined;

/** The full catalog is an integrity-bound local asset, never a remote request. */
export function loadSolcordCatalogDetails(read: typeof fetch = fetch): Promise<readonly AddonCandidate[]> {
    if (pending) return pending;
    pending = (async () => {
        const response = await read("solcord://catalog/index.json", {credentials: "omit", referrerPolicy: "no-referrer"});
        if (!response.ok) throw new Error("Local catalog is unavailable.");
        const data = await response.arrayBuffer();
        if (data.byteLength > 2 * 1024 * 1024) throw new Error("Local catalog exceeds its package limit.");
        const digest = await crypto.subtle.digest("SHA-256", data);
        const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
        if (hash !== SOLCORD_CATALOG_DETAIL_SHA256) throw new Error("Local catalog integrity check failed.");
        const records: unknown = JSON.parse(new TextDecoder().decode(data));
        if (!Array.isArray(records)) throw new Error("Local catalog format is invalid.");
        return records as AddonCandidate[];
    })().catch(error => {pending = undefined; throw error;});
    return pending;
}
