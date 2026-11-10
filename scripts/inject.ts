const args = process.argv;

import fs from "fs";
import path from "path";
import bun from "bun";

import doSanityChecks from "./helpers/validate";
import buildPackage from "./helpers/package";
import copyFiles from "./helpers/copy";
import {stageReleaseArtifact} from "./helpers/install";
import {injectDeveloperLoader, validateDeveloperLayout} from "./helpers/developer-inject";
import {comparator} from "../src/common/semver";

const useSolcordRelease = args[2] && args[2].toLowerCase() === "release";
const releaseInput = useSolcordRelease ? args[3] && args[3].toLowerCase() : args[2] && args[2].toLowerCase();
const release = releaseInput === "canary" ? "Discord Canary" : releaseInput === "ptb" ? "Discord PTB" : "Discord";
const solcordPath = useSolcordRelease ? path.resolve(__dirname, "..", "dist", "solcord.asar") : path.resolve(__dirname, "..", "dist");
let installedSolcordPath = solcordPath;

const resources = await (async function () {
    let basedir = "";
    if (process.platform === "win32") {
        basedir = path.join(process.env.LOCALAPPDATA!, release.replace(/ /g, ""));
    }
    else if (process.env.WSL_DISTRO_NAME) {
        const appdata = (await bun.$`wslpath "$(cmd.exe /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r')"`.text()).trim();
        basedir = path.join(appdata, release.replace(/ /g, ""));
    }
    else {
        if (process.platform === "darwin") {
            return path.sep + path.join("Applications", `${release}.app`, "Contents", "Resources");
        }

        basedir = path.join(process.env.XDG_CONFIG_HOME ? process.env.XDG_CONFIG_HOME : path.join(process.env.HOME!, ".config"), release.toLowerCase().replace(" ", ""));
    }

    if (!fs.existsSync(basedir)) throw new Error(`No ${release} install at ${basedir}`);

    const dirs = fs.readdirSync(basedir)
        .filter(x => x.startsWith("app-"));

    if (dirs.length === 0) {
        throw new Error("Discord requires the new updater. Please update Discord.");
    }

    const latest = dirs
        .filter((item) => item.startsWith("app-") && fs.statSync(path.join(basedir, item)).isDirectory())
        .map(item => item.slice(4))
        .reduce((pre, cur) => {
            if (comparator(pre, cur) === 1) return cur;
            return pre;
        });

    return path.join(basedir, `app-${latest}`, "resources");
})();

validateDeveloperLayout(resources);

if (useSolcordRelease) {
    if (!fs.existsSync(solcordPath) || !fs.statSync(solcordPath).isFile() || fs.statSync(solcordPath).size === 0) {
        throw new Error(`Solcord release artifact is missing or empty: ${solcordPath}`);
    }
    if (process.platform === "win32") {
        const appData = process.env.APPDATA;
        if (!appData || !path.isAbsolute(appData)) throw new Error("APPDATA did not resolve to an absolute Windows path.");
        installedSolcordPath = path.join(appData, "BetterDiscord", "data", "betterdiscord.asar");
        const sha256 = stageReleaseArtifact(solcordPath, installedSolcordPath);
        console.log(`    ✅ Staged Solcord ${sha256.slice(0, 12)}… at the compatibility target`);
    }
}
else {
    doSanityChecks(solcordPath);
    buildPackage(solcordPath);
}
console.log("");

console.log(`Injecting into ${release}`);
console.log(`    ✅ Found ${release} in ${resources}`);

const asarDir = path.join(resources, "app");

let requirePath: string;
if (process.env.WSL_DISTRO_NAME) {
    if (useSolcordRelease) {
        const target = path.join(asarDir, "..", "..", "solcord.asar");
        fs.copyFileSync(solcordPath, target);
        requirePath = "../../solcord.asar";
    }
    else {
        copyFiles(solcordPath, path.join(asarDir, "..", "..", "betterdiscord"));
        requirePath = "../../betterdiscord";
    }
}
else {
    requirePath = installedSolcordPath;
}


// __betterdiscord_inject_meta__ is used so the updater module can use the correct path
injectDeveloperLoader(resources, requirePath);
console.log("    ✅ Committed the loader and verified packed Discord startup path");

console.log("");

console.log(`Solcord injection successful. Restart ${release} when you are ready to test.`);
