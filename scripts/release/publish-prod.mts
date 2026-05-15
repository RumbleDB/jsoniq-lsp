import { getRelease, releaseTag } from "./github.mts";
import { publishLanguageServer } from "./language-server.mts";
import {
    LANGUAGE_SERVER_PACKAGE_DIR,
    npmPackageExists,
    prepareOutputDir,
    readPackage,
    VSCODE_EXTENSION_PACKAGE_DIR,
} from "./shared.mts";
import { publishVsCodeExtension } from "./vscode-extension.mts";

prepareOutputDir();

const languageServerPackage = readPackage(LANGUAGE_SERVER_PACKAGE_DIR);
const extensionPackage = readPackage(VSCODE_EXTENSION_PACKAGE_DIR);

const languageServerNeedsPublish = !npmPackageExists(
    languageServerPackage.name,
    languageServerPackage.version,
);
const extensionReleaseExists = (await getRelease(releaseTag(extensionPackage))) !== null;

if (!languageServerNeedsPublish && extensionReleaseExists) {
    console.log("No unpublished npm package or missing VS Code extension release found.");
    process.exit(0);
}

let languageServerPackagePath: string | undefined;

if (languageServerNeedsPublish) {
    languageServerPackagePath = await publishLanguageServer(languageServerPackage);
}

if (!extensionReleaseExists) {
    await publishVsCodeExtension(extensionPackage, languageServerPackagePath);
}
