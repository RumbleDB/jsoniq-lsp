import {
    MarkupKind,
    type Hover,
    type Position,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    findSymbolAtPosition,
} from "./analysis/queries.js";
import { getAnalysis } from "./analysis/service.js";
import { isSourceDefinition, type Definition } from "./analysis/model.js";

export async function findHover(document: TextDocument, position: Position): Promise<Hover | null> {
    const analysis = await getAnalysis(document, { typeInference: true });
    const occurrence = findSymbolAtPosition(analysis, position);

    if (occurrence === undefined || occurrence.declaration === undefined) {
        return null;
    }

    const declaration = occurrence.declaration;
    
    return {
        range: occurrence.range,
        contents: {
            kind: MarkupKind.Markdown,
            value: createHoverContent(declaration),
        },
    };
}

function createHoverContent(declaration: Definition): string {
    if (isSourceDefinition(declaration)) {
        const declarationLine = declaration.selectionRange.start.line + 1;

        return [
            "```jsoniq",
            declaration.name,
            "```",
            `kind: \`${declaration.kind}\``,
            `declared at line ${declarationLine}`,
            `inferred type: \`${declaration.inferredType ?? "unknown"}\``,
        ].join("\n");
    }
    else {
        return [
            "```jsoniq",
            declaration.name,
            "```",
            `kind: \`${declaration.kind}\``,
            `(builtin function)`,
        ].join("\n");
    }
}
