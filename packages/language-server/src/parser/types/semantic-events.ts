import type { Range } from "vscode-languageserver";

import type { SemanticDeclarationKind } from "./declaration.js";

export type SemanticEvent =
    | SemanticScopeEvent
    | SemanticEnterDeclarationEvent
    | SemanticExitDeclarationEvent
    | SemanticReferenceEvent;

export type ScopeKind = "function" | "flowr";

export type SemanticScopeEvent = {
    type: "enterScope" | "exitScope";
    range: Range;
    scopeKind: ScopeKind;
};

export type SemanticEnterDeclarationEvent = {
    type: "enterDeclaration";
    declaration: SemanticDeclaration;
};

export type SemanticExitDeclarationEvent = {
    type: "exitDeclaration";
    declaration: SemanticDeclaration;
};

export type SemanticReferenceEvent = {
    type: "reference";
    name: string;
    kind: "variable" | "function";
    range: Range;
};

interface SemanticDeclarationBase<K extends SemanticDeclarationKind> {
    name: string;
    kind: K;
    range: Range;
    selectionRange: Range;
    completed?: boolean;
}

export type SemanticSimpleDeclarationKind = Exclude<SemanticDeclarationKind, "namespace">;

export type SemanticDeclaration = SemanticSimpleDeclaration | SemanticNamespaceDeclaration;

export type SemanticSimpleDeclaration = SemanticDeclarationBase<SemanticSimpleDeclarationKind>;

export interface SemanticNamespaceDeclaration extends SemanticDeclarationBase<"namespace"> {
    namespaceUri: string;
}
