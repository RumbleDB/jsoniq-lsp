import { DocumentSymbol } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { SymbolsBuilder } from "./analysis/symbols.js";

/**
 * Collects DocumentSymbols from the given TextDocument.
 */
export async function collectDocumentSymbols(document: TextDocument): Promise<DocumentSymbol[]> {
    return new SymbolsBuilder(document).build();
}
