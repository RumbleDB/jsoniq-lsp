import type { FunctionName, QName, VarName } from "server/parser/types/name.js";
import type { Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type {
    DeclarationKind,
    SourceDefinition,
    SourceFunctionDefinition,
    SourceNamespaceDefinition,
    SourceParameterDefinition,
    SourceVariableDefinition,
    VariableKind,
} from "./model.js";

interface DefinitionBaseInput {
    range: Range;
    selectionRange: Range;
    visibleFrom?: number | null;
}

function createBaseDefinition(document: TextDocument, input: DefinitionBaseInput) {
    return {
        range: input.range,
        selectionRange: input.selectionRange,
        references: [],
        visibleFrom:
            input.visibleFrom === undefined
                ? document.offsetAt(input.range.end)
                : input.visibleFrom,
        isBuiltin: false as const,
    };
}

export function createVariableDefinition(
    document: TextDocument,
    kind: VariableKind,
    name: VarName,
    range: Range,
    selectionRange: Range,
    visibleFrom?: number | null,
): SourceVariableDefinition {
    return {
        ...createBaseDefinition(
            document,
            visibleFrom === undefined
                ? { range, selectionRange }
                : { range, selectionRange, visibleFrom },
        ),
        kind,
        name,
    };
}

export function createFunctionDefinition(
    document: TextDocument,
    name: FunctionName,
    range: Range,
    selectionRange: Range,
): SourceFunctionDefinition {
    return {
        ...createBaseDefinition(document, {
            range,
            selectionRange,
            visibleFrom: document.offsetAt(selectionRange.end),
        }),
        kind: "function",
        name,
        parameters: [],
    };
}

export function createParameterDefinition(
    document: TextDocument,
    name: VarName,
    range: Range,
    selectionRange: Range,
    containingFunction: SourceFunctionDefinition,
): SourceParameterDefinition {
    return {
        ...createBaseDefinition(document, { range, selectionRange }),
        kind: "parameter",
        name,
        function: containingFunction,
    };
}

export function createNamespaceDefinition(
    document: TextDocument,
    prefix: string,
    namespaceUri: string,
    range: Range,
    selectionRange: Range,
): SourceNamespaceDefinition {
    return {
        ...createBaseDefinition(document, { range, selectionRange }),
        kind: "namespace",
        name: { prefix },
        namespaceUri,
    };
}

export function createTypeDefinition(
    document: TextDocument,
    name: { qname: QName },
    range: Range,
    selectionRange: Range,
): Extract<SourceDefinition, { kind: "type" }> {
    return {
        ...createBaseDefinition(document, { range, selectionRange }),
        kind: "type" satisfies DeclarationKind,
        name,
    };
}
