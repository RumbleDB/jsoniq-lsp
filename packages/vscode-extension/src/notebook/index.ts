import * as vscode from "vscode";
import { NotebookCellTextDocumentFilter } from "vscode-languageserver-protocol";

import { JSONIQ_LANGUAGE_ID } from "../const";
import { clearNotebookCellTracking, updateNotebookCells } from "./cells";
import { JUPYTER_NOTEBOOK_TYPE } from "./const";

export const JUPYTER_NOTEBOOK_SELECTOR = {
    notebook: JUPYTER_NOTEBOOK_TYPE,
    language: JSONIQ_LANGUAGE_ID,
} satisfies NotebookCellTextDocumentFilter;

export async function registerJupyterNotebookSupport(
    context: vscode.ExtensionContext,
): Promise<void> {
    context.subscriptions.push(
        vscode.workspace.onDidOpenNotebookDocument((notebook) => {
            void updateNotebookCells(notebook.getCells());
        }),
        vscode.workspace.onDidChangeNotebookDocument((event) => {
            const changedCells = [
                ...event.contentChanges.flatMap((change) => change.addedCells),
                ...event.cellChanges.map((change) => change.cell),
            ];

            clearNotebookCellTracking(
                event.contentChanges.flatMap((change) => change.removedCells),
            );
            void updateNotebookCells(changedCells);
        }),
        vscode.workspace.onDidCloseNotebookDocument((notebook) => {
            clearNotebookCellTracking(notebook.getCells());
        }),
    );

    /// Update all currently open notebook cells in case any of them contain the magic comment
    await updateNotebookCells(
        vscode.workspace.notebookDocuments.flatMap((notebook) => notebook.getCells()),
    );
}
