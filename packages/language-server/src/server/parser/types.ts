import type { IntervalSet } from "antlr4ng";
import type { Diagnostic } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { SemanticEvent } from "./semantic-events.js";

export interface SyntaxContext {
    expectedTokenSet: IntervalSet;
    ruleStack: number[];
    offset: number;
}

export interface ParseResult {
    diagnostics: Diagnostic[];
    completionContexts: SyntaxContext[];
    semanticEvents: readonly SemanticEvent[];
}

export interface ParsedDocument {
    result: ParseResult;
}

export interface ParserAdapter {
    readonly id: string;

    supports(document: TextDocument): boolean;

    parse(document: TextDocument): ParsedDocument;

    collectCompletionContext(parsed: ParsedDocument, cursorOffset: number): SyntaxContext | null;
}
