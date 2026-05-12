import type { Range } from "vscode-languageserver";

import type { DeclarationNameByKind } from "./name.js";

export type VariableKind =
    | "declare-variable"
    | "let"
    | "for"
    | "for-position"
    | "group-by"
    | "count"
    | "catch-variable";

export type DeclarationKind = VariableKind | "namespace" | "type" | "parameter" | "function";

type AstDeclarationBase<K extends DeclarationKind> = {
    name: DeclarationNameByKind[K];
    kind: K;
    range: Range;
    selectionRange: Range;
    completed?: boolean;
};

export type AstParameterDeclaration = AstDeclarationBase<"parameter"> & {
    extra?: never;
};

type AstDeclarationExtra = {
    namespace: { namespaceUri: string };
    function: { parameters: AstParameterDeclaration[] };
};

export type AstDeclaration<K extends DeclarationKind> = K extends DeclarationKind
    ? AstDeclarationBase<K> &
          (K extends keyof AstDeclarationExtra
              ? { extra: AstDeclarationExtra[K] }
              : { extra?: never })
    : never;

export type AnyAstDeclaration = AstDeclaration<DeclarationKind>;
