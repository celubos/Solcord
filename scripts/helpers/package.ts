import fs from "fs";
import path from "path";


export default function (dist: string) {
    console.log("");
    console.log("Ensuring valid package.json");

    const pkgFile = path.join(dist, "package.json");
    // Ignored output is not authority: never preserve stale keys such as type=module.
    fs.writeFileSync(pkgFile, JSON.stringify({name: "solcord", main: "main.js"}));
    console.log("    ✅ Created new package.json");
};
