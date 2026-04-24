import type {
    Range,
    SymbolKind,
} from "vscode-languageserver";

import type { SourceDefinitionKind } from "../analysis/model.js";

export type SemanticEvent =
    | SemanticScopeEvent
    | SemanticDeclarationEvent
    | SemanticReferenceEvent
    | SemanticDocumentSymbolEvent;

export interface SemanticScopeEvent {
    type: "enterScope" | "exitScope";
    range: Range;
}

export interface SemanticDeclarationEvent {
    type: "declaration";
    name: string;
    kind: SourceDefinitionKind;
    range: Range;
    selectionRange: Range;
    timing: "beforeChildren" | "afterChildren";
    containingFunctionName?: string;
}

export interface SemanticReferenceEvent {
    type: "reference";
    name: string;
    kind: "variable" | "function";
    range: Range;
}

export interface SemanticDocumentSymbolEvent {
    type: "documentSymbol";
    name: string;
    kind: SymbolKind;
    range: Range;
    selectionRange: Range;
    parentName?: string;
}
