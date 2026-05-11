import type {
    SemanticDeclaration,
    SemanticNamespaceDeclaration,
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

    if (declaration.kind === "namespace") {
        /// TODO: Make TypeScript understand that declaration is a SemanticNamespaceDeclaration without this assertion
        const nsDecl = declaration as SemanticNamespaceDeclaration;
        return {
            ...base,
            kind: "namespace",
            prefix: nsDecl.prefix,
            namespaceUri: nsDecl.namespaceUri,
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
