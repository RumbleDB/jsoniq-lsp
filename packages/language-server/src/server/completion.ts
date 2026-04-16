import {
    CompletionItemKind,
    type CompletionItem,
    type Position,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getVisibleDeclarationsAtPosition } from "./analysis.js";

export function findVariableCompletions(document: TextDocument, position: Position): CompletionItem[] {
    const visibleDeclarations = getVisibleDeclarationsAtPosition(document, position);

    return visibleDeclarations
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((declaration, index) => ({
            label: declaration.name,
            kind: CompletionItemKind.Variable,
            detail: `JSONiq ${declaration.kind}`,
            sortText: `${index.toString().padStart(5, "0")}:${declaration.name}`,
        }));
}
