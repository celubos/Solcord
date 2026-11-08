// SPDX-License-Identifier: Apache-2.0

export interface ClientModCompatibilityConfig {
    shouldShow: boolean;
    allowPreloadOverride: boolean;
}

/** Only an explicit boolean grants the security-sensitive preload override. */
export function normalizeClientModCompatibilityConfig(value: unknown): ClientModCompatibilityConfig {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {shouldShow: record.shouldShow !== false, allowPreloadOverride: record.allowPreloadOverride === true};
}
