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
    /// Remove node_modules and package-lock.json to ensure a clean install and build (vsce does not support pnpm node_modules structure)
    run("rm", [
        "-rf",
        `${VSCODE_EXTENSION_PACKAGE_DIR}/node_modules`,
        `${VSCODE_EXTENSION_PACKAGE_DIR}/package-lock.json`,
    ]);

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
    run("npm", ["install", "--omit=dev"], { cwd: VSCODE_EXTENSION_PACKAGE_DIR });
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
