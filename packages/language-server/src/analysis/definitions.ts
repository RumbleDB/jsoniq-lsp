import { functionNameToString, qnameToString, varNameToString } from "server/parser/types/name.js";
import type { AnySemanticDeclaration } from "server/parser/types/semantic-events.js";
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
    containingFunction?: SourceFunctionDefinition,
): SourceDefinition {
    const base = {
        name: declarationNameToString(declaration),
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

    if (declaration.kind === "namespace") {
        return {
            ...base,
            kind: "namespace",
            namespaceUri: declaration.extra.namespaceUri,
        } satisfies SourceNamespaceDefinition;
    }

    if (declaration.kind === "context-item" || declaration.kind === "type") {
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

function declarationNameToString(declaration: AnySemanticDeclaration): string {
    switch (declaration.kind) {
        case "context-item":
            return declaration.name.label;
        case "namespace":
            return declaration.name.prefix;
        case "function":
            return functionNameToString(declaration.name);
        case "type":
            return qnameToString(declaration.name.qname);
        case "parameter":
        case "declare-variable":
        case "let":
        case "for":
        case "for-position":
        case "group-by":
        case "count":
            return varNameToString(declaration.name);
        default:
            throw declaration satisfies never;
    }
}
