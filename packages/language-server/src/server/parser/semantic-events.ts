import type { Range } from "vscode-languageserver";

import type { SourceDefinitionKind } from "../analysis/model.js";

export type SemanticEvent =
    | SemanticScopeEvent
    | SemanticDeclarationEvent
    | SemanticReferenceEvent;

export type ScopeKind = "function" | "flowr";

export interface SemanticScopeEvent {
    type: "enterScope" | "exitScope";
    range: Range;
    scopeKind: ScopeKind;
}

export interface SemanticDeclarationEvent {
    type: "declaration";
    name: string;
    kind: SourceDefinitionKind;
    range: Range;
    selectionRange: Range;
    availability: "beforeChildren" | "afterChildren";
}

export interface SemanticReferenceEvent {
    type: "reference";
    name: string;
    kind: "variable" | "function";
    range: Range;
}
