// SPDX-License-Identifier: Apache-2.0
import crypto from "node:crypto";
import fs from "node:fs";

export function hashFile(file) {
    const descriptor = fs.openSync(file, "r");
    const before = fs.fstatSync(descriptor);
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        while (true) {
            const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytes === 0) break;
            hash.update(buffer.subarray(0, bytes));
        }
        const after = fs.fstatSync(descriptor);
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("A file changed while it was hashed.");
        return hash.digest("hex");
    }
    finally {fs.closeSync(descriptor);}
}
