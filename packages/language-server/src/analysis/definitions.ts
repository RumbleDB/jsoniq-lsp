import type {
    AnySemanticDeclaration,
    SemanticParameterDeclaration,
} from "server/parser/types/semantic-events.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import type {
    SourceDefinition,
    SourceFunctionDefinition,
    SourceNamespaceDefinition,
    SourceParameterDefinition,
    SourceVariableDefinition,
} from "./model.js";

export function createSourceDefinition(
    document: TextDocument,
    declaration: AnySemanticDeclaration,
): SourceDefinition {
    const base = {
        range: declaration.range,
        selectionRange: declaration.selectionRange,
        references: [],
        visibleFrom:
            declaration.completed === false ? null : document.offsetAt(declaration.range.end),
        isBuiltin: false as const,
    };

    if (declaration.kind === "function") {
        return {
            ...base,
            name: declaration.name,
            kind: "function",
            parameters: [],

            /// For function declarations, the declaration becomes visible after the symbol name
            visibleFrom: document.offsetAt(declaration.selectionRange.end),
        } satisfies SourceFunctionDefinition;
    }

    if (declaration.kind === "parameter") {
        throw new Error("Parameter declarations must be created with their owning function.");
    }

    if (declaration.kind === "namespace") {
        return {
            ...base,
            name: declaration.name,
            kind: "namespace",
            namespaceUri: declaration.extra.namespaceUri,
        } satisfies SourceNamespaceDefinition;
    }

    if (declaration.kind === "context-item") {
        /// TODO: Add more support for these kinds of definitions
        return {
            ...base,
            name: declaration.name,
            kind: declaration.kind,
        } satisfies SourceDefinition;
    }

    if (declaration.kind === "type") {
        /// TODO: Add more support for these kinds of definitions
        return {
            ...base,
            name: declaration.name,
            kind: declaration.kind,
        } satisfies SourceDefinition;
    }

    return {
        ...base,
        name: declaration.name,
        kind: declaration.kind,
    } satisfies SourceVariableDefinition;
}

export function createSourceParameterDefinition(
    document: TextDocument,
    declaration: SemanticParameterDeclaration,
    containingFunction: SourceFunctionDefinition,
): SourceParameterDefinition {
    return {
        range: declaration.range,
        selectionRange: declaration.selectionRange,
        references: [],
        visibleFrom:
            declaration.completed === false ? null : document.offsetAt(declaration.range.end),
        isBuiltin: false,
        name: declaration.name,
        kind: "parameter",
        function: containingFunction,
    };
}
