import {
    MarkupKind,
    type Hover,
    type Position,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    findVariableOccurrenceNearPosition,
    getAnalysis,
} from "./analysis.js";

export function findHover(document: TextDocument, position: Position): Hover | null {
    const analysis = getAnalysis(document);
    const occurrence = findVariableOccurrenceNearPosition(analysis, position);

    if (occurrence === undefined) {
        return null;
    }

    const declaration = occurrence.declaration;
    const declarationLine = declaration.selectionRange.start.line + 1;

    return {
        range: occurrence.reference?.range ?? declaration.selectionRange,
        contents: {
            kind: MarkupKind.Markdown,
            value: [
                "```jsoniq",
                declaration.name,
                "```",
                `kind: \`${declaration.kind}\``,
                `declared at line ${declarationLine}`,
            ].join("\n"),
        },
    };
}
