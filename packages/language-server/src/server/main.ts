import {
    TextDocumentSyncKind,
    createConnection,
    ProposedFeatures,
    TextDocuments,
    type InitializeParams,
    type InitializeResult,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import { parseJsoniqDocument } from "./parser.js";
import { collectSemanticDiagnostics, collectSemanticTokens, legend as semanticLegend } from "./semantic.js";
import { collectDocumentSymbols } from "./symbols.js";
import { findDefinitionLocation } from "./definitions.js";
import { findReferenceLocations } from "./references.js";
import { buildRenameWorkspaceEdit, prepareRename } from "./rename.js";
import { findHover } from "./hover.js";
import { findCompletions } from "./completion.js";
import { initializeBuiltinFunctionDefinitions } from "./builtin-definitions.js";
import { clearTypeInferenceCache } from "./type-inference.js";
import { collectTypeDiagnostics } from "./type-diagnostics.js";
import { connection as wrapperConnection } from "./wrapper-connection.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

async function refreshDiagnostics(uri: string): Promise<void> {
    const document = documents.get(uri);

    if (document === undefined) {
        return;
    }

    const syntaxDiagnostics = parseJsoniqDocument(document).diagnostics;
    const semanticDiagnostics = syntaxDiagnostics.length === 0
        ? await collectSemanticDiagnostics(document)
        : [];
    const typeDiagnostics = syntaxDiagnostics.length === 0
        ? await collectTypeDiagnostics(document)
        : [];

    connection.sendDiagnostics({
        uri: document.uri,
        diagnostics: [
            ...syntaxDiagnostics,
            ...semanticDiagnostics,
            ...typeDiagnostics,
        ],
    });
}

connection.onInitialize(async (_params: InitializeParams): Promise<InitializeResult> => {
    wrapperConnection.ensureProcess();
    await initializeBuiltinFunctionDefinitions();

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            documentSymbolProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            hoverProvider: true,
            completionProvider: {
                triggerCharacters: ["$"],
            },
            renameProvider: {
                prepareProvider: true,
            },
            semanticTokensProvider: {
                legend: semanticLegend,
                full: true,
            },
        },
        serverInfo: {
            name: "jsoniq-lsp",
            version: "0.1.0",
        },
    };
});

connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);

    if (document === undefined) {
        return [];
    }

    return collectDocumentSymbols(document);
});

connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);

    if (document === undefined) {
        return null;
    }

    return findDefinitionLocation(document, params.position);
});

connection.onReferences((params) => {
    const document = documents.get(params.textDocument.uri);

    if (document === undefined) {
        return [];
    }

    return findReferenceLocations(document, params.position, params.context.includeDeclaration);
});

connection.onPrepareRename((params) => {
    const document = documents.get(params.textDocument.uri);

    if (document === undefined) {
        return null;
    }

    return prepareRename(document, params.position);
});

connection.onRenameRequest((params) => {
    const document = documents.get(params.textDocument.uri);

    if (document === undefined) {
        return null;
    }

    return buildRenameWorkspaceEdit(document, params.position, params.newName);
});

connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);

    if (document === undefined) {
        return null;
    }

    return findHover(document, params.position);
});

connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);

    if (document === undefined) {
        return [];
    }

    return findCompletions(document, params.position);
});

connection.languages.semanticTokens.on((params) => {
    const document = documents.get(params.textDocument.uri);

    if (document === undefined) {
        return { data: [] };
    }

    return collectSemanticTokens(document);
});

documents.onDidOpen(async (event) => {
    await refreshDiagnostics(event.document.uri);
});

documents.onDidChangeContent(async (event) => {
    await refreshDiagnostics(event.document.uri);
});

documents.onDidClose((event) => {
    clearTypeInferenceCache(event.document.uri);
    connection.sendDiagnostics({
        uri: event.document.uri,
        diagnostics: [],
    });
});

documents.listen(connection);
connection.listen();
