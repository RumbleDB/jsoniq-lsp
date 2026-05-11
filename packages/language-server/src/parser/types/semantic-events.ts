import type { Range } from "vscode-languageserver";

import type { SemanticDeclarationKind } from "./declaration.js";

export type SemanticEvent =
    | SemanticScopeEvent
    | SemanticEnterDeclarationEvent
    | SemanticExitDeclarationEvent
    | SemanticReferenceEvent;

export type ScopeKind = "function" | "flowr";

export interface SemanticScopeEvent {
    type: "enterScope" | "exitScope";
    range: Range;
    scopeKind: ScopeKind;
}

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

export interface SemanticEnterDeclarationEvent {
    type: "enterDeclaration";
    declaration: SemanticDeclaration;
}

export interface SemanticExitDeclarationEvent {
    type: "exitDeclaration";
    declaration: SemanticDeclaration;
}

export interface SemanticReferenceEvent {
    type: "reference";
    name: string;
    kind: "variable" | "function";
    range: Range;
}
