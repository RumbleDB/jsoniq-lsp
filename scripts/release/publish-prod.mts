import { getRelease, releaseTag } from "./github.mts";
import { publishLanguageServer } from "./language-server.mts";
import {
    LANGUAGE_SERVER_PACKAGE_DIR,
    npmPackageExists,
    prepareOutputDir,
    readPackage,
    VSCODE_EXTENSION_PACKAGE_DIR,
    WRAPPER_PACKAGE_DIR,
} from "./shared.mts";
import { publishVsCodeExtension } from "./vscode-extension.mts";
import { ensureWrapperRelease } from "./wrapper.mts";

async function main(): Promise<void> {
    prepareOutputDir();

    const wrapperPackage = readPackage(WRAPPER_PACKAGE_DIR);
    const languageServerPackage = readPackage(LANGUAGE_SERVER_PACKAGE_DIR);
    const extensionPackage = readPackage(VSCODE_EXTENSION_PACKAGE_DIR);

    const shouldPublishLanguageServer = !npmPackageExists(
        languageServerPackage.name,
        languageServerPackage.version,
    );
    const shouldPublishVsCodeExtension = (await getRelease(releaseTag(extensionPackage))) === null;

    if (!shouldPublishLanguageServer && !shouldPublishVsCodeExtension) {
        console.log("No unpublished npm package or missing VS Code extension release found.");
        return;
    }

    const wrapperManifest = await ensureWrapperRelease(wrapperPackage);
    const languageServerPackagePath = shouldPublishLanguageServer
        ? await publishLanguageServer(languageServerPackage, wrapperManifest)
        : undefined;

    if (!shouldPublishVsCodeExtension) {
        return;
    }

    await publishVsCodeExtension(extensionPackage, languageServerPackagePath);
}

await main();
