import {migrateDiscordUpdate, type DiscordUpdateMigrationOptions, type DiscordUpdateMigrationResult} from "./discord-update-migration";

/** How often a running client looks for a background-staged Discord version. */
export const DISCORD_UPDATE_CHECK_INTERVAL_MS = 60_000;
/** A staged version must be unchanged this long before Solcord attaches to it. */
export const DISCORD_UPDATE_STABLE_MS = 60_000;
const QUIT_ATTEMPTS = 3;
const QUIT_RETRY_DELAY_MS = 150;

type Migrate = (options: DiscordUpdateMigrationOptions) => DiscordUpdateMigrationResult;

function pause(milliseconds: number): void {
    // Synchronous on purpose: the quit hook must finish before Discord spawns the new version.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Keeps Solcord attached when Discord updates itself. Discord now stages a new
 * app-* folder in the background and its launcher can switch versions without
 * the old client quitting normally, so a quit hook alone is not enough: while
 * the client runs, attach as soon as the staged files are complete and stable.
 * The quit hook remains a last chance, retrying briefly if the archive is
 * still locked (for example while it is being scanned).
 */
export class DiscordUpdateWatch {
    readonly #options: Omit<DiscordUpdateMigrationOptions, "minimumStableMs" | "now">;
    readonly #migrate: Migrate;
    readonly #sleep: (milliseconds: number) => void;
    #settled = false;

    constructor(options: Omit<DiscordUpdateMigrationOptions, "minimumStableMs" | "now">, migrate: Migrate = migrateDiscordUpdate, sleep: (milliseconds: number) => void = pause) {
        this.#options = options;
        this.#migrate = migrate;
        this.#sleep = sleep;
    }

    /** Proactive check while the client runs. Returns the last result. */
    check(now = Date.now()): DiscordUpdateMigrationResult {
        if (this.#settled) return "already-migrated";
        const result = this.#safe({...this.#options, minimumStableMs: DISCORD_UPDATE_STABLE_MS, now});
        if (result === "migrated" || result === "already-migrated" || result === "occupied-loader") this.#settled = true;
        return result;
    }

    /** Last chance when the client quits: no stability wait, brief retries on failure. */
    onQuit(): DiscordUpdateMigrationResult {
        let result: DiscordUpdateMigrationResult = "failed";
        for (let attempt = 1; attempt <= QUIT_ATTEMPTS; attempt++) {
            result = this.#safe({...this.#options});
            if (result !== "failed") break;
            if (attempt < QUIT_ATTEMPTS) this.#sleep(QUIT_RETRY_DELAY_MS);
        }
        return result;
    }

    #safe(options: DiscordUpdateMigrationOptions): DiscordUpdateMigrationResult {
        try {return this.#migrate(options);}
        catch (error) {
            options.log?.(`Discord update check failed: ${String(error)}`);
            return "failed";
        }
    }
}
