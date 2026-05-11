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

export interface SemanticDeclaration {
    name: string;
    kind: SemanticDeclarationKind;
    range: Range;
    selectionRange: Range;
    completed?: boolean;
}

export interface SemanticNamespaceDeclaration extends SemanticDeclaration {
    kind: "namespace";
    prefix: string;
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
