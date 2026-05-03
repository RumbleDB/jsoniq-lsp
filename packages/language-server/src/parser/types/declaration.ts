export type VariableKind =
    | "declare-variable"
    | "let"
    | "for"
    | "for-position"
    | "group-by"
    | "count";

export type SemanticDeclarationKind =
    | VariableKind
    | "namespace"
    | "context-item"
    | "type"
    | "parameter"
    | "function";
