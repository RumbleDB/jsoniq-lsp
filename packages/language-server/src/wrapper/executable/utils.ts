import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const CURRENT_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function findPackageRoot(): string {
    let dir = CURRENT_MODULE_DIR;

    while (true) {
        const pkg = path.join(dir, "package.json");
        if (fs.existsSync(pkg)) {
            return dir;
        }

        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error("Could not find package.json");
        }
        dir = parent;
    }
}
