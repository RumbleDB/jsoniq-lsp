import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ensureRelease, releaseTag, uploadReleaseAsset, type Release } from "./github.mts";
import {
    findOneFile,
    LANGUAGE_SERVER_PACKAGE_DIR,
    PACKAGE_ROOT,
    RELEASE_OUTPUT_DIR,
    run,
    type PackageJson,
} from "./shared.mts";

const WRAPPER_TARGET_DIR = `${PACKAGE_ROOT}/packages/rumble-lsp-wrapper/target`;
const MANIFEST_PATH = `${LANGUAGE_SERVER_PACKAGE_DIR}/assets/wrapper/release-manifest.json`;

function sha256(file: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function buildLanguageServerProductionArtifacts(): void {
    run("pnpm", ["run", "generate:grammar"]);
    run("pnpm", ["run", "build:core:prod"]);
}

export async function attachLanguageServerArtifacts(
    release: Release,
    tag: string,
): Promise<string> {
    const jarPath = findOneFile(WRAPPER_TARGET_DIR, "-all.jar");
    const jarSha256 = sha256(jarPath);
    const jarSizeBytes = fs.statSync(jarPath).size;
    const jarAsset = await uploadReleaseAsset(release, jarPath);

    const manifest = {
        tag,
        releaseName: release.name,
        releaseUrl: release.html_url,
        assetName: jarAsset.name,
        jarUrl: jarAsset.browser_download_url,
        jarSha256,
        jarSizeBytes,
        createdAt: new Date().toISOString(),
        commitSha: process.env.GITHUB_SHA,
    };

    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 4)}\n`, "utf8");

    run("pnpm", [
        "--dir",
        LANGUAGE_SERVER_PACKAGE_DIR,
        "pack",
        "--pack-destination",
        RELEASE_OUTPUT_DIR,
    ]);

    const packagePath = findOneFile(RELEASE_OUTPUT_DIR, ".tgz");
    await uploadReleaseAsset(release, packagePath);

    return packagePath;
}

export async function publishLanguageServer(languageServerPackage: PackageJson): Promise<string> {
    buildLanguageServerProductionArtifacts();

    const tag = releaseTag(languageServerPackage);
    const release = await ensureRelease(tag, tag);
    const packagePath = await attachLanguageServerArtifacts(release, tag);

    run("pnpm", ["publish", "--access", "public", "--no-git-checks"], {
        cwd: LANGUAGE_SERVER_PACKAGE_DIR,
    });

    return packagePath;
}
