import type { Range } from "vscode-languageserver";

import type { SemanticDeclarationKind } from "./declaration.js";
import type { DeclarationNameByKind, ReferenceNameByKind } from "./name.js";

export type SemanticEvent =
    | SemanticScopeEvent
    | SemanticDeclarationEvent
    | AnySemanticReferenceEvent;

export type ScopeKind = "function" | "flowr";

export type SemanticScopeEvent = {
    type: "enterScope" | "exitScope";
    range: Range;
    scopeKind: ScopeKind;
};

export type SemanticDeclarationEvent = {
    type: "declaration";
    declaration: AnySemanticDeclaration;
};

export type SemanticReferenceEvent<K extends keyof ReferenceNameByKind> =
    K extends keyof ReferenceNameByKind
        ? {
              type: "reference";
              name: ReferenceNameByKind[K];
              kind: K;
              range: Range;
          }
        : never;

export type AnySemanticReferenceEvent = SemanticReferenceEvent<keyof ReferenceNameByKind>;

type SemanticDeclarationBase<K extends SemanticDeclarationKind> = {
    name: DeclarationNameByKind[K];
    kind: K;
    range: Range;
    selectionRange: Range;
    completed?: boolean;
};

export type SemanticParameterDeclaration = SemanticDeclarationBase<"parameter"> & {
    extra?: never;
};

type SemanticDeclarationExtra = {
    namespace: { namespaceUri: string };
    function: { parameters: SemanticParameterDeclaration[] };
};

export type SemanticDeclaration<K extends SemanticDeclarationKind> =
    K extends SemanticDeclarationKind
        ? SemanticDeclarationBase<K> &
              (K extends keyof SemanticDeclarationExtra
                  ? { extra: SemanticDeclarationExtra[K] }
                  : { extra?: never })
        : never;

export type AnySemanticDeclaration = SemanticDeclaration<SemanticDeclarationKind>;
