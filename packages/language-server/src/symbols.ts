import { DocumentSymbol } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { DocumentSymbolsBuilder } from "./analysis/symbols.js";

/**
 * Collects DocumentSymbols from the given TextDocument.
 */
export async function collectDocumentSymbols(document: TextDocument): Promise<DocumentSymbol[]> {
    return new DocumentSymbolsBuilder(document).build();
}
