import fs from "node:fs";
import path from "node:path";

import { ensureRelease, releaseTag, uploadReleaseAsset } from "./github.mts";
import { findOneFile, run, VSCODE_EXTENSION_PACKAGE_DIR, type PackageJson } from "./shared.mts";

export async function publishVsCodeExtension(extensionPackage: PackageJson): Promise<void> {
    const tag = releaseTag(extensionPackage);
    const release = await ensureRelease(tag, tag);

    run("pnpm", ["run", "build:client"]);

    for (const file of fs.readdirSync(VSCODE_EXTENSION_PACKAGE_DIR)) {
        if (file.endsWith(".vsix")) {
            fs.rmSync(path.join(VSCODE_EXTENSION_PACKAGE_DIR, file));
        }
    }

    run("npm", ["install", "--omit=dev"], { cwd: VSCODE_EXTENSION_PACKAGE_DIR });
    run(
        "pnpm",
        [
            "dlx",
            "--allow-build=@vscode/vsce-sign",
            "--allow-build=keytar",
            "@vscode/vsce",
            "package",
            "--skip-license",
        ],
        { cwd: VSCODE_EXTENSION_PACKAGE_DIR },
    );

    const vsixPath = findOneFile(VSCODE_EXTENSION_PACKAGE_DIR, ".vsix");
    await uploadReleaseAsset(release, vsixPath);
}
