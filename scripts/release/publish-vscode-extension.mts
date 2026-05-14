import fs from "node:fs";
import path from "node:path";

import { ensureRelease, releaseTag, uploadReleaseAsset } from "./github.mts";
import {
    findOneFile,
    LANGUAGE_SERVER_PACKAGE_DIR,
    readPackage,
    run,
    VSCODE_EXTENSION_PACKAGE_DIR,
    type PackageJson,
} from "./shared.mts";

export async function publishVsCodeExtension(extensionPackage: PackageJson): Promise<void> {
    const languageServerPackage = readPackage(LANGUAGE_SERVER_PACKAGE_DIR);

    run(
        "npm",
        [
            "pkg",
            "set",
            `dependencies.${languageServerPackage.name}=${languageServerPackage.version}`,
        ],
        { cwd: VSCODE_EXTENSION_PACKAGE_DIR },
    );
    run("npm", ["install"], { cwd: VSCODE_EXTENSION_PACKAGE_DIR });
    run("npm", ["run", "build:prod"], { cwd: VSCODE_EXTENSION_PACKAGE_DIR });

    run(
        "npx",
        [
            "--allow-build=@vscode/vsce-sign",
            "--allow-build=keytar",
            "@vscode/vsce",
            "package",
            "--skip-license",
        ],
        { cwd: VSCODE_EXTENSION_PACKAGE_DIR },
    );

    const vsixPath = findOneFile(VSCODE_EXTENSION_PACKAGE_DIR, ".vsix");

    const tag = releaseTag(extensionPackage);
    const release = await ensureRelease(tag, tag);
    await uploadReleaseAsset(release, vsixPath);
}
