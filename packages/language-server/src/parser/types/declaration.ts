export type VariableKind =
    | "declare-variable"
    | "let"
    | "for"
    | "for-position"
    | "group-by"
    | "count"
    | "catch-variable";

export type SemanticDeclarationKind =
    | VariableKind
    | "namespace"
    | "type"
    | "parameter"
    | "function";
