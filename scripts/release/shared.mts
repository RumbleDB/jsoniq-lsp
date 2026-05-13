import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findPackageRoot(): string {
    let dir = path.dirname(fileURLToPath(import.meta.url));

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

export const PACKAGE_ROOT = findPackageRoot();

export const LANGUAGE_SERVER_PACKAGE_DIR = `${PACKAGE_ROOT}/packages/language-server`;
export const VSCODE_EXTENSION_PACKAGE_DIR = `${PACKAGE_ROOT}/packages/vscode-extension`;
export const RELEASE_OUTPUT_DIR = `${PACKAGE_ROOT}/.release-assets`;

export type PackageJson = {
    name: string;
    version: string;
};

export function readPackage(packageDir: string): PackageJson {
    return JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
}

export function run(
    command: string,
    args: string[],
    options: Parameters<typeof execFileSync>[2] = {},
): void {
    execFileSync(command, args, { stdio: "inherit", ...options });
}

export function output(
    command: string,
    args: string[],
    options: Parameters<typeof execFileSync>[2] = {},
): string {
    return execFileSync(command, args, { encoding: "utf8", ...options })
        .toString()
        .trim();
}

export function findOneFile(dir: string, suffix: string): string {
    const matches = fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(suffix))
        .map((file) => path.join(dir, file))
        .sort();

    if (matches.length !== 1) {
        throw new Error(
            `Expected exactly one '${suffix}' file in ${dir}, found ${matches.length}.`,
        );
    }

    return matches[0];
}

export function npmPackageExists(name: string, version: string): boolean {
    try {
        execFileSync("npm", ["view", `${name}@${version}`, "version"], {
            stdio: "pipe",
        });
        return true;
    } catch (error) {
        const stderr =
            typeof error === "object" &&
            error !== null &&
            "stderr" in error &&
            Buffer.isBuffer(error.stderr)
                ? error.stderr.toString("utf8")
                : "";

        if (stderr.includes("E404")) {
            return false;
        }

        throw error;
    }
}

export function prepareOutputDir() {
    fs.rmSync(RELEASE_OUTPUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(RELEASE_OUTPUT_DIR, { recursive: true });
}
