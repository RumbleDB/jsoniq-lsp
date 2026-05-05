import type * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node.js";
import { registerWrapperDownloadProgressNotification } from "./download-progress.js";

export function initializeCustomNotifications(
    client: LanguageClient,
    context: vscode.ExtensionContext,
): void {
    context.subscriptions.push(registerWrapperDownloadProgressNotification(client));
}
