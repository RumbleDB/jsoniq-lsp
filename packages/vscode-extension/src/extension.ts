import path from "node:path";

import * as vscode from "vscode";
import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
    TransportKind,
} from "vscode-languageclient/node.js";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const serverModule = context.asAbsolutePath(path.join("..", "language-server", "dist", "server", "main.js"));

    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.stdio,
        },
        debug: {
            module: serverModule,
            transport: TransportKind.stdio,
            options: {
                execArgv: ["--nolazy", "--inspect=6009"],
            },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: "file", language: "jsoniq" },
        ],
    };

    client = new LanguageClient(
        "jsoniqLanguageServer",
        "JSONiq Language Server",
        serverOptions,
        clientOptions,
    );

    context.subscriptions.push(client);
    await client.start();
}

export async function deactivate(): Promise<void> {
    if (client !== undefined) {
        await client.stop();
        client = undefined;
    }
}
