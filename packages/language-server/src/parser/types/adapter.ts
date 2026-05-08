import type { TextDocument } from "vscode-languageserver-textdocument";

import { CompletionIntent } from "./completion.js";
import { ParseResult } from "./result.js";

export interface ParserAdapter {
    readonly id: string;

    supports(document: TextDocument): boolean;

    parse(document: TextDocument): ParseResult;

    getCompletionIntent(parsed: ParseResult, cursorOffset: number): CompletionIntent | null;
}
