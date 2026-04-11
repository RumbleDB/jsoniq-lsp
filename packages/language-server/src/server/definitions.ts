import {
    type Location,
    type Position,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    getAnalysis,
    findVariableOccurrenceNearOffset,
} from "./analysis.js";

/**
 * Finds the definition location for the variable at the given position in the document, by analyzing variable scopes and occurrences.
 * 
 * @param document The TextDocument representing the JSONiq source code to analyze
 * @param position The Position in the document for which to find the definition location (e.g. the position of the cursor in the editor)
 * @returns A Location object representing the definition location of the variable at the given position, or null if no definition is found
 */
export function findDefinitionLocation(document: TextDocument, position: Position): Location | null {
    const analysis = getAnalysis(document);
    const offset = document.offsetAt(position);
    const occurrence = findVariableOccurrenceNearOffset(analysis, offset);

    if (occurrence === undefined) {
        return null;
    }

    return {
        uri: document.uri,
        range: occurrence.declaration.selectionRange,
    };
}
