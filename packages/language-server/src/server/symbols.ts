import { DocumentSymbol } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getAnalysis } from "./analysis.js";

/**
 * Collects DocumentSymbols from the given TextDocument.
 */
export function collectDocumentSymbols(document: TextDocument): DocumentSymbol[] {
    return getAnalysis(document).documentSymbols;
}
