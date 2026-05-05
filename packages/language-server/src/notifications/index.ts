import { setWrapperResolutionOptions } from "server/wrapper/client.js";
import { WRAPPER_DOWNLOAD_PROGRESS_NOTIFICATION, MEMORY_USAGE_NOTIFICATION, MemoryUsage } from "./types.js";
import { Connection } from "vscode-languageserver/node.js";
import { DownloadProgress } from "server/wrapper/executable/download.js";
import { setMemoryUsageNotification } from "./memory-usage.js";

export {
    WRAPPER_DOWNLOAD_PROGRESS_NOTIFICATION,
    type DownloadProgress,

    MEMORY_USAGE_NOTIFICATION,
    type MemoryUsage,
}

export const initializeCustomNotifications = (connection: Connection): void => {
    setWrapperResolutionOptions({
        onProgress: (progress) => {
            connection.sendNotification(WRAPPER_DOWNLOAD_PROGRESS_NOTIFICATION, progress satisfies DownloadProgress);
        },
    });

    setMemoryUsageNotification(connection);
};
