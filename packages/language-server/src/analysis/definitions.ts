import type { SemanticDeclaration } from "server/parser/types/semantic-events.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import type {
    SourceDefinition,
    SourceFunctionDefinition,
    SourceParameterDefinition,
    SourceVariableDefinition,
} from "./model.js";

export function createSourceDefinition(
    document: TextDocument,
    declaration: SemanticDeclaration,
    containingFunction?: SourceFunctionDefinition,
): SourceDefinition {
    const base = {
        name: declaration.name,
        range: declaration.range,
        selectionRange: declaration.selectionRange,
        references: [],
        visibleFrom:
            declaration.completed === false ? null : document.offsetAt(declaration.range.end),
        isBuiltin: false as const,
    } satisfies Omit<SourceDefinition, "kind">;

    if (declaration.kind === "function") {
        return {
            ...base,
            kind: "function",
            parameters: [],

            /// For function declarations, the declaration becomes visible after the symbol name
            visibleFrom: document.offsetAt(declaration.selectionRange.end),
        } satisfies SourceFunctionDefinition;
    }

    if (declaration.kind === "parameter") {
        if (containingFunction === undefined) {
            throw new Error("Parameter declaration must belong to a function.");
        }

        return {
            ...base,
            kind: "parameter",
            function: containingFunction,
        } satisfies SourceParameterDefinition;
    }

    if (
        declaration.kind === "namespace" ||
        declaration.kind === "context-item" ||
        declaration.kind === "type"
    ) {
        /// TODO: Add more support for these kinds of definitions
        return {
            ...base,
            kind: declaration.kind,
        } satisfies SourceDefinition;
    }

    return {
        ...base,
        kind: declaration.kind,
    } satisfies SourceVariableDefinition;
}
