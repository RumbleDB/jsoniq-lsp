import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "server/utils/logger.js";
import { WrapperLaunchConfig } from "./index.js";

/// Production environment: use the release-manifest.json (which should be placed in the same directory as this file)
const CURRENT_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER_JAR_PRODUCTION_FOLDER = CURRENT_MODULE_DIR;
const WRAPPER_RELEASE_MANIFEST_FILE = "release-manifest.json";
const WRAPPER_REMOTE_JAR_FILE = "rumble-lsp-wrapper.remote.jar";

interface WrapperReleaseManifest {
    jarUrl: string;
    jarSha256: string;
}

function readReleaseManifest(): WrapperReleaseManifest {
    const manifestPath = path.join(WRAPPER_JAR_PRODUCTION_FOLDER, WRAPPER_RELEASE_MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Wrapper release manifest not found: '${manifestPath}'.`);
    }
    const manifestRaw = fs.readFileSync(manifestPath, "utf8");
    return JSON.parse(manifestRaw) as WrapperReleaseManifest;
}

function computeFileSha256(filePath: string): string {
    const fileContent = fs.readFileSync(filePath);
    return createHash("sha256").update(fileContent).digest("hex");
}

const logger = createLogger("wrapper:jar-resolution/production");

export async function resolveProductionJarPath(): Promise<string> {
    const manifest = readReleaseManifest();
    const cachedJarPath = path.join(WRAPPER_JAR_PRODUCTION_FOLDER, WRAPPER_REMOTE_JAR_FILE);

    if (fs.existsSync(cachedJarPath) && computeFileSha256(cachedJarPath) === manifest.jarSha256) {
        return cachedJarPath;
    }

    logger.info(`Downloading wrapper jar from '${manifest.jarUrl}'.`);
    const response = await fetch(manifest.jarUrl);
    if (!response.ok) {
        throw new Error(`Failed to download wrapper jar: HTTP ${response.status} ${response.statusText}`);
    }

    const jarBuffer = Buffer.from(await response.arrayBuffer());
    if (manifest.jarSha256 !== undefined && manifest.jarSha256.length > 0) {
        const downloadedSha = createHash("sha256").update(jarBuffer).digest("hex");
        if (downloadedSha !== manifest.jarSha256) {
            throw new Error(
                `Downloaded wrapper jar hash mismatch: expected '${manifest.jarSha256}', got '${downloadedSha}'.`
            );
        }
    }

    fs.mkdirSync(WRAPPER_JAR_PRODUCTION_FOLDER, { recursive: true });
    fs.writeFileSync(cachedJarPath, jarBuffer);

    return cachedJarPath;
};

export async function resolveProdLaunchConfig(): Promise<WrapperLaunchConfig> {
    const cachedJarPath = await resolveProductionJarPath();
    return {
        args: ["-jar", cachedJarPath, "--daemon"],
    };
};