import type { Range } from "vscode-languageserver";

import type { SemanticDeclarationKind } from "./declaration.js";
import type { DeclarationNameByKind, ReferenceNameByKind } from "./name.js";

export type SemanticEvent =
    | SemanticScopeEvent
    | SemanticEnterDeclarationEvent
    | SemanticExitDeclarationEvent
    | AnySemanticReferenceEvent;

export type ScopeKind = "function" | "flowr";

export type SemanticScopeEvent = {
    type: "enterScope" | "exitScope";
    range: Range;
    scopeKind: ScopeKind;
};

export type SemanticEnterDeclarationEvent = {
    type: "enterDeclaration";
    declaration: AnySemanticDeclaration;
};

export type SemanticExitDeclarationEvent = {
    type: "exitDeclaration";
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

type SemanticDeclarationExtra = {
    namespace: { namespaceUri: string };
};

export type SemanticDeclaration<K extends SemanticDeclarationKind> =
    K extends SemanticDeclarationKind
        ? SemanticDeclarationBase<K> &
              (K extends keyof SemanticDeclarationExtra
                  ? { extra: SemanticDeclarationExtra[K] }
                  : { extra?: never })
        : never;

export type AnySemanticDeclaration = SemanticDeclaration<SemanticDeclarationKind>;
