import type { Diagnostic } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { SemanticEvent } from "./semantic-events.js";

export interface ParserKeywordCompletion {
    label: string;
    insertText?: string;
}

export interface CompletionIntent {
    allowVariableReferences: boolean;
    allowVariableDeclarations: boolean;
    allowFunctions: boolean;
    keywords: ParserKeywordCompletion[];
}

export interface ParseResult {
    diagnostics: Diagnostic[];
    semanticEvents: readonly SemanticEvent[];
}

export interface ParserAdapter {
    readonly id: string;

    supports(document: TextDocument): boolean;

    parse(document: TextDocument): ParseResult;

    getCompletionIntent(parsed: ParseResult, cursorOffset: number): CompletionIntent | null;
}
