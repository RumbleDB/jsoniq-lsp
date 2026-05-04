import type { SemanticDeclaration } from "server/parser/types/semantic-events.js";
import type {
    SourceDefinition,
    SourceFunctionDefinition,
    SourceParameterDefinition,
    SourceVariableDefinition,
} from "./model.js";
import { TextDocument } from "vscode-languageserver-textdocument";

export function createSourceDefinition(
    document: TextDocument,
    declaration: SemanticDeclaration,
    containingFunction?: SourceFunctionDefinition,
): SourceDefinition {
    const base = {
        name: declaration.name,
        range: declaration.range,
        selectionRange: declaration.selectionRange,
        scopeEnd: { line: 0, character: 0 },
        references: [],
        isBuiltin: false as const,
    };

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
            visibleFrom: document.offsetAt(declaration.range.end),
        } satisfies SourceParameterDefinition;
    }

    if (declaration.kind === "namespace" || declaration.kind === "context-item" || declaration.kind === "type") {
        /// TODO: Add more support for these kinds of definitions
        return {
            ...base,
            kind: declaration.kind,
            visibleFrom: document.offsetAt(declaration.range.end),
        } satisfies SourceDefinition;
    }

    return {
        ...base,
        kind: declaration.kind,
        visibleFrom: document.offsetAt(declaration.range.end),
    } satisfies SourceVariableDefinition;
}
