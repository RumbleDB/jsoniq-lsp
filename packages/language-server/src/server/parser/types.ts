import type { IntervalSet } from "antlr4ng";
import type { Diagnostic } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { SemanticEvent } from "./semantic-events.js";

export interface ParserSyntaxContext {
    expectedTokenSet: IntervalSet;
    ruleStack: number[];
    offset: number;
}

export interface ParserKeywordCompletion {
    label: string;
    insertText?: string;
}

export interface CompletionIntent {
    insideVariableBindingHeader: boolean;
    declaringVariableName: boolean;
    expectingName: boolean;
    expressionReferenceContext: boolean;
    keywords: ParserKeywordCompletion[];
}

export interface ParseResult {
    diagnostics: Diagnostic[];
    completionContexts: ParserSyntaxContext[];
    semanticEvents: readonly SemanticEvent[];
}

export interface ParserAdapter {
    readonly id: string;

    supports(document: TextDocument): boolean;

    parse(document: TextDocument): ParseResult;

    collectCompletionContext(parsed: ParseResult, cursorOffset: number): ParserSyntaxContext | null;

    getCompletionIntent(context: ParserSyntaxContext): CompletionIntent;
}
