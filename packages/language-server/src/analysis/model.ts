import type { SemanticDeclarationKind, VariableKind } from "server/parser/types/declaration.js";
import {
    type DeclarationNameByKind,
    type FunctionName,
    functionNameToString,
    qnameToString,
    varNameToString,
} from "server/parser/types/name.js";
import type { BuiltinFunctionDefinition } from "server/wrapper/builtin-functions.js";
import type { Diagnostic, Range } from "vscode-languageserver";

import type { Scope } from "./scope.js";

export type DefinitionKind = SemanticDeclarationKind | "builtin-function";

export type DefinitionNameByKind = DeclarationNameByKind & {
    "builtin-function": FunctionName;
};

interface AbstractDefinition<K extends DefinitionKind> {
    name: DefinitionNameByKind[K];
    kind: K;

    // List of references that resolve to this declaration.
    references: Reference[];

    isBuiltin: boolean;
}

export type BaseDefinition<K extends DefinitionKind = DefinitionKind> = K extends DefinitionKind
    ? AbstractDefinition<K>
    : never;

export interface BaseSourceDefinition<
    K extends SemanticDeclarationKind = SemanticDeclarationKind,
> extends AbstractDefinition<K> {
    // Entire range of the declaration.
    range: Range;

    // Range of the declaration name token.
    selectionRange: Range;

    // Offset where this declaration becomes visible.
    visibleFrom: number | null;

    isBuiltin: false;
}

export interface SourceVariableDefinition extends BaseSourceDefinition<VariableKind> {
    kind: VariableKind;
}

export interface SourceParameterDefinition extends BaseSourceDefinition<"parameter"> {
    kind: "parameter";
    function: SourceFunctionDefinition;
}

export interface SourceFunctionDefinition extends BaseSourceDefinition<"function"> {
    kind: "function";
    parameters: SourceParameterDefinition[];
}

export interface SourceNamespaceDefinition extends BaseSourceDefinition<"namespace"> {
    kind: "namespace";
    namespaceUri: string;
}

export type SourceDefinition =
    | SourceVariableDefinition
    | SourceParameterDefinition
    | SourceFunctionDefinition
    | SourceNamespaceDefinition
    | BaseSourceDefinition<"context-item">
    | BaseSourceDefinition<"type">;

export type Definition = SourceDefinition | BuiltinFunctionDefinition;

export interface Reference {
    name: string;
    range: Range;
}

export interface ResolvedReference extends Reference {
    declaration: Definition;
}

export interface SymbolIndexEntry {
    range: Range;
    declaration: Definition;

    // The reference corresponding to this occurrence, if it is a reference.
    reference: Reference | undefined;
}

export interface JsoniqAnalysis {
    moduleScope: Scope;

    // All declarations, sorted by declaration position.
    definitions: SourceDefinition[];

    // All resolved references in traversal order.
    references: ResolvedReference[];

    diagnostics: Diagnostic[];

    // Declarations and references, sorted by source position.
    symbolIndex: SymbolIndexEntry[];
}

export function isSourceDefinition(
    declaration: BaseDefinition | undefined,
): declaration is SourceDefinition {
    return declaration !== undefined && declaration.isBuiltin === false;
}

export function isSourceVariableDefinition(
    declaration: BaseDefinition | undefined,
): declaration is SourceVariableDefinition {
    return ["declare-variable", "let", "for", "for-position", "group-by", "count"].includes(
        declaration?.kind ?? "",
    );
}

export function isSourceParameterDefinition(
    declaration: BaseDefinition | undefined,
): declaration is SourceParameterDefinition {
    return isSourceDefinition(declaration) && declaration.kind === "parameter";
}

export function isSourceFunctionDefinition(
    declaration: BaseDefinition | undefined,
): declaration is SourceFunctionDefinition {
    return isSourceDefinition(declaration) && declaration.kind === "function";
}

export function definitionNameToString(definition: BaseDefinition): string {
    switch (definition.kind) {
        case "context-item":
            return definition.name.label;
        case "namespace":
            return definition.name.prefix;
        case "function":
        case "builtin-function":
            return functionNameToString(definition.name);
        case "type":
            return qnameToString(definition.name.qname);
        case "parameter":
        case "declare-variable":
        case "let":
        case "for":
        case "for-position":
        case "group-by":
        case "count":
            return varNameToString(definition.name);
        default:
            throw definition satisfies never;
    }
}
