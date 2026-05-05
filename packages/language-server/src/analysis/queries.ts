import type { Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { upperBound } from "server/utils/binary-search.js";
import { comparePositions } from "server/utils/position.js";
import {
    type BaseDefinition,
    type JsoniqAnalysis,
    type SymbolIndexEntry,
} from "./model.js";
import { getAnalysis } from "./service.js";

export async function getVisibleDeclarationsAtPosition(document: TextDocument, position: Position): Promise<BaseDefinition[]> {
    const analysis = await getAnalysis(document);
    const positionOffset = document.offsetAt(position);
    const scope = analysis.moduleScope.findInnermostScope(positionOffset);
    return [...scope.listVisibleDefinitions(positionOffset).values()];
}

export function findSymbolAtPosition(
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
