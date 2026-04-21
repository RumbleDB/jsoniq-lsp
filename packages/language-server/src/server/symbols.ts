import { DocumentSymbol } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getAnalysis } from "./analysis.js";

/**
 * Collects DocumentSymbols from the given TextDocument.
 */
export async function collectDocumentSymbols(document: TextDocument): Promise<DocumentSymbol[]> {
    const analysis = await getAnalysis(document);
    return analysis.documentSymbols;
}
