import * as vscode from "vscode";
import { DocumentUri } from "vscode-languageclient";

import { JSONIQ_LANGUAGE_ID } from "../const";
import { JSONIQ_MAGIC_PATTERN, JUPYTER_NOTEBOOK_TYPE } from "./const";

/// Tracks the original language of notebook cells that have been retagged as JSONiq, so that they can be reverted if the magic comment is removed.
const previousCellLanguage = new Map<DocumentUri, string>();

export async function updateNotebookCellLanguage(cell: vscode.NotebookCell): Promise<void> {
    if (cell.notebook.notebookType !== JUPYTER_NOTEBOOK_TYPE) {
        /// Ignore non-Jupyter notebooks for now
        return;
    }

    const { document } = cell;
    const firstLine = document.lineCount === 0 ? "" : document.lineAt(0).text.trimStart();
    const hasJsoniqMagic = JSONIQ_MAGIC_PATTERN.test(firstLine);
    const documentKey: DocumentUri = document.uri.toString();
    const previousLanguage = previousCellLanguage.get(documentKey);

    if (hasJsoniqMagic && document.languageId !== JSONIQ_LANGUAGE_ID) {
        previousCellLanguage.set(documentKey, document.languageId);
        await vscode.languages.setTextDocumentLanguage(document, JSONIQ_LANGUAGE_ID);
        return;
    }

    if (
        !hasJsoniqMagic &&
        previousLanguage !== undefined &&
        document.languageId === JSONIQ_LANGUAGE_ID
    ) {
        /// Revert to the previous language now that the magic comment has been removed
        previousCellLanguage.delete(documentKey);
        await vscode.languages.setTextDocumentLanguage(document, previousLanguage);
        return;
    }

    if (
        !hasJsoniqMagic &&
        previousLanguage !== undefined &&
        document.languageId === previousLanguage
    ) {
        previousCellLanguage.delete(documentKey);
    }
}

export async function updateNotebookCells(cells: readonly vscode.NotebookCell[]): Promise<void> {
    await Promise.all(cells.map((cell) => updateNotebookCellLanguage(cell)));
}

export function clearNotebookCellTracking(cells: readonly vscode.NotebookCell[]): void {
    for (const cell of cells) {
        previousCellLanguage.delete(cell.document.uri.toString());
    }
}
