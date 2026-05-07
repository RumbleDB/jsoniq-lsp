import { createLogger } from "server/utils/logger.js";
import { resolveDevLaunchConfig } from "./dev.js";
import { resolveProdLaunchConfig } from "./prod.js";
import { DownloadProgressReporter } from "./download.js";

const logger = createLogger("wrapper:jar-resolution");

export interface WrapperLaunchConfig {
    args: string[];
}

export interface WrapperResolutionOptions {
    onProgress?: DownloadProgressReporter;
}

export async function resolveWrapperLaunchConfig(
    options: WrapperResolutionOptions = {},
): Promise<WrapperLaunchConfig> {
    const developmentConfig = resolveDevLaunchConfig();
    if (developmentConfig !== undefined) {
        return developmentConfig;
    }

    logger.debug(
        "No development wrapper configuration found, falling back to production configuration.",
    );
    return resolveProdLaunchConfig(options);
}
