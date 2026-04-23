import type { Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { upperBound } from "../utils/binary-search.js";
import { comparePositions } from "../utils/position.js";
import {
    type BaseDefinition,
    type JsoniqAnalysis,
    type OccurrenceIndexEntry,
    type SourceDefinition,
    isSourceFunctionDefinition,
} from "./model.js";
import { getAnalysis } from "./service.js";

export async function getVisibleDeclarationsAtPosition(document: TextDocument, position: Position): Promise<BaseDefinition[]> {
    const analysis = await getAnalysis(document);
    const visibleByName = new Map<string, BaseDefinition>();
    const source = document.getText();
    const positionOffset = document.offsetAt(position);

    let index = upperBound(analysis.definitions, position, (left, right) => comparePositions(left.range.start, right)) - 1;

    while (index >= 0) {
        const declaration = analysis.definitions[index];

        if (
            declaration !== undefined
            && isDeclarationVisibleAtOffset(document, source, declaration, positionOffset)
            && comparePositions(position, declaration.scopeEnd) <= 0
            && !visibleByName.has(declaration.name)
        ) {
            visibleByName.set(declaration.name, declaration);
        }

        index -= 1;
    }

    return [...visibleByName.values()];
}

function isDeclarationVisibleAtOffset(
    document: TextDocument,
    source: string,
    declaration: SourceDefinition,
    queryOffset: number,
): boolean {
    if (isSourceFunctionDefinition(declaration)) {
        return document.offsetAt(declaration.selectionRange.end) < queryOffset;
    }

    const declarationEndOffset = document.offsetAt(declaration.range.end);

    return declarationEndOffset < queryOffset
        && source.slice(declarationEndOffset, queryOffset).trim() !== "";
}

export function findVariableOccurrenceAtPosition(
    analysis: JsoniqAnalysis,
    position: Position,
): OccurrenceIndexEntry | undefined {
    const occurrenceIndex = upperBound(
        analysis.occurrenceIndex,
        position,
        (occurrence, targetPosition) => comparePositions(occurrence.range.start, targetPosition),
    ) - 1;

    const occurrence = analysis.occurrenceIndex[occurrenceIndex];

    if (occurrence !== undefined && comparePositions(position, occurrence.range.end) < 0) {
        return occurrence;
    }

    return undefined;
}

export function findVariableOccurrenceNearPosition(
    analysis: JsoniqAnalysis,
    position: Position,
): OccurrenceIndexEntry | undefined {
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
