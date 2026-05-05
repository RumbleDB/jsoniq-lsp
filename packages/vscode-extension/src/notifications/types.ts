export const WRAPPER_DOWNLOAD_PROGRESS_NOTIFICATION = "jsoniq/wrapper-download-progress";

export interface WrapperDownloadProgress {
    stage: "download-started" | "download-progress" | "download-complete" | "verified" | "download-failed";
    downloadedBytes: number;
    totalBytes: number;
    message?: string;
}
