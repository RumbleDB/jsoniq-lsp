import type { Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { upperBound } from "../utils/binary-search.js";
import { comparePositions } from "../utils/position.js";
import {
    type BaseDefinition,
    type JsoniqAnalysis,
    type SymbolIndexEntry,
} from "./model.js";
import { getAnalysis } from "./service.js";

export async function getVisibleDeclarationsAtPosition(document: TextDocument, position: Position): Promise<BaseDefinition[]> {
    const analysis = await getAnalysis(document);
    const positionOffset = document.offsetAt(position);
    const scope = analysis.rootScope.findInnermostScope(positionOffset);
    return [...scope.listVisibleDefinitions(positionOffset).values()];
}

export function findVariableOccurrenceAtPosition(
    analysis: JsoniqAnalysis,
    position: Position,
): SymbolIndexEntry | undefined {
    const occurrenceIndex = upperBound(
        analysis.symbolIndex,
        position,
        (occurrence, targetPosition) => comparePositions(occurrence.range.start, targetPosition),
    ) - 1;

    const occurrence = analysis.symbolIndex[occurrenceIndex];

    if (occurrence !== undefined && comparePositions(position, occurrence.range.end) < 0) {
        return occurrence;
    }

    return undefined;
}

export function findVariableOccurrenceNearPosition(
    analysis: JsoniqAnalysis,
    position: Position,
): SymbolIndexEntry | undefined {
    const exact = findVariableOccurrenceAtPosition(analysis, position);
    if (exact !== undefined) {
        return exact;
    }

    if (position.character > 0) {
        const previous = findVariableOccurrenceAtPosition(analysis, {
            line: position.line,
            character: position.character - 1,
        });
        if (previous !== undefined) {
            return previous;
        }
    }

    return findVariableOccurrenceAtPosition(analysis, {
        line: position.line,
        character: position.character + 1,
    });
}
