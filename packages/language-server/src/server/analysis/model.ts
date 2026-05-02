import type {
    Position,
    Range,
} from "vscode-languageserver";

import type { BuiltinFunctionDefinition } from "../wrapper/builtin-functions.js";

export type VariableKind =
    | "declare-variable"
    | "let"
    | "for"
    | "for-position"
    | "group-by"
    | "count";

export type SourceDefinitionKind =
    | VariableKind
    | "namespace"
    | "context-item"
    | "type"
    | "parameter"
    | "function";

export type DefinitionKind = SourceDefinitionKind | "builtin-function";

export interface BaseDefinition {
    name: string;
    kind: DefinitionKind;

    // List of references that resolve to this declaration.
    references: Reference[];

    isBuiltin: boolean;
}

export interface BaseSourceDefinition extends BaseDefinition {
    // Entire range of the declaration.
    range: Range;

    // Range of the declaration name token.
    selectionRange: Range;

    // Position where this definition goes out of scope.
    scopeEnd: Position;

    isBuiltin: false;

    inferredType?: string;
}

export interface SourceVariableDefinition extends BaseSourceDefinition {
    kind: VariableKind;
}

export interface SourceParameterDefinition extends BaseSourceDefinition {
    kind: "parameter";
    function: SourceFunctionDefinition;
}

export interface SourceFunctionDefinition extends BaseSourceDefinition {
    kind: "function";
    parameters: SourceParameterDefinition[];
}

export type SourceDefinition =
    | SourceVariableDefinition
    | SourceParameterDefinition
    | SourceFunctionDefinition
    | (BaseSourceDefinition & { kind: "namespace" | "context-item" | "type" });

export type Definition = SourceDefinition | BuiltinFunctionDefinition;

export interface Reference {
    name: string;
    range: Range;
}

export interface ResolvedReference extends Reference {
    declaration: Definition;
}

export interface OccurrenceIndexEntry {
    range: Range;
    declaration: Definition;

    // The reference corresponding to this occurrence, if it is a reference.
    reference: Reference | undefined;
}

export interface JsoniqAnalysis {
    // All declarations, sorted by declaration position.
    definitions: SourceDefinition[];

    // All resolved references in traversal order.
    references: ResolvedReference[];

    unresolvedReferences: Reference[];

    // Declarations and references, sorted by source position.
    occurrenceIndex: OccurrenceIndexEntry[];

}

export function isSourceDefinition(declaration: BaseDefinition | undefined): declaration is SourceDefinition {
    return declaration !== undefined && declaration.isBuiltin === false;
}

export function isSourceVariableDefinition(declaration: BaseDefinition | undefined): declaration is SourceVariableDefinition {
    return ["declare-variable", "let", "for", "for-position", "group-by", "count"].includes(declaration?.kind ?? "");
}

export function isSourceParameterDefinition(declaration: BaseDefinition | undefined): declaration is SourceParameterDefinition {
    return isSourceDefinition(declaration) && declaration.kind === "parameter";
}

export function isSourceFunctionDefinition(declaration: BaseDefinition | undefined): declaration is SourceFunctionDefinition {
    return isSourceDefinition(declaration) && declaration.kind === "function";
}
