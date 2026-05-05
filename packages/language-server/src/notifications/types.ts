export const WRAPPER_DOWNLOAD_PROGRESS_NOTIFICATION = "jsoniq/wrapper-download-progress";
export const MEMORY_USAGE_NOTIFICATION = "jsoniq/memory-usage";

export type MemoryUsage = {
    languageServer: number;
    wrapper: number | null;
}   