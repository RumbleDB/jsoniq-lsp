import { ATNSimulator, BaseErrorListener, RecognitionException, Recognizer, Token } from "antlr4ng";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument, Range } from "vscode-languageserver-textdocument";

import { getDocumentText } from "./utils.js";

export class ErrorListener extends BaseErrorListener {
    public readonly diagnostics: Diagnostic[] = [];

    public constructor(private readonly document: TextDocument) {
        super();
    }

    public override syntaxError<S extends Token, T extends ATNSimulator>(
        recognizer: Recognizer<T>,
        offendingSymbol: S | null,
        line: number,
        column: number,
        message: string,
        _error: RecognitionException | null,
    ): void {
        const range = this.createRange(offendingSymbol, line, column);

        this.diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
            message,
            source: "parser",
        });
    }

    private createRange(offendingSymbol: Token | null, line: number, column: number): Range {
        if (
            offendingSymbol !== null &&
            offendingSymbol.start >= 0 &&
            offendingSymbol.stop >= offendingSymbol.start
        ) {
            return {
                start: this.document.positionAt(offendingSymbol.start),
                end: this.document.positionAt(offendingSymbol.stop + 1),
            };
        }

        const startOffset = this.document.offsetAt({
            line: Math.max(line - 1, 0),
            character: Math.max(column, 0),
        });
        const endOffset = Math.min(startOffset + 1, getDocumentText(this.document).length);

        return {
            start: this.document.positionAt(startOffset),
            end: this.document.positionAt(endOffset),
        };
    }
}
