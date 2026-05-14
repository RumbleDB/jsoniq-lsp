import { ensureRelease, releaseTag, uploadReleaseAsset } from "./github.mts";
import {
    findOneFile,
    LANGUAGE_SERVER_PACKAGE_DIR,
    readPackage,
    run,
    VSCODE_EXTENSION_PACKAGE_DIR,
    type PackageJson,
} from "./shared.mts";

export function cleanVsCodeExtensionInstall(): void {
    /// vsce does not support pnpm's node_modules layout, so package from a clean npm install.
    run("rm", [
        "-rf",
        `${VSCODE_EXTENSION_PACKAGE_DIR}/node_modules`,
        `${VSCODE_EXTENSION_PACKAGE_DIR}/package-lock.json`,
    ]);
}

export function setVsCodeExtensionLanguageServerDependency(versionSpec: string): void {
    const languageServerPackage = readPackage(LANGUAGE_SERVER_PACKAGE_DIR);
    run("npm", ["pkg", "set", `dependencies.${languageServerPackage.name}=${versionSpec}`], {
        cwd: VSCODE_EXTENSION_PACKAGE_DIR,
    });
}

export function installAndBuildVsCodeExtension(): void {
    run("npm", ["install"], { cwd: VSCODE_EXTENSION_PACKAGE_DIR });
    run("npm", ["run", "build:prod"], { cwd: VSCODE_EXTENSION_PACKAGE_DIR });
}

export function packVsCodeExtension(preRelease: boolean): string {
    const args = [
        "dlx",
        "--allow-build=@vscode/vsce-sign",
        "--allow-build=keytar",
        "@vscode/vsce",
        "package",
        "--skip-license",
    ];

    if (preRelease) {
        args.push("--pre-release");
    }

    run("pnpm", args, { cwd: VSCODE_EXTENSION_PACKAGE_DIR });

    return findOneFile(VSCODE_EXTENSION_PACKAGE_DIR, ".vsix");
}

export async function publishVsCodeExtension(extensionPackage: PackageJson): Promise<void> {
    const languageServerPackage = readPackage(LANGUAGE_SERVER_PACKAGE_DIR);

    cleanVsCodeExtensionInstall();
    setVsCodeExtensionLanguageServerDependency(languageServerPackage.version);
    installAndBuildVsCodeExtension();

    const vsixPath = packVsCodeExtension(false);

    const tag = releaseTag(extensionPackage);
    const release = await ensureRelease(tag, tag);

    await uploadReleaseAsset(release, vsixPath);
}
