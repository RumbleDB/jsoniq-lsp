import {
    BaseErrorListener,
    CharStream,
    CommonTokenStream,
    type ATNSimulator,
    type RecognitionException,
    type Recognizer,
    type Token,
} from "antlr4ng";
import {
    Diagnostic,
    DiagnosticSeverity,
    type Range,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { jsoniqLexer } from "../grammar/jsoniqLexer.js";
import { jsoniqParser, type ModuleAndThisIsItContext } from "../grammar/jsoniqParser.js";

export interface JsoniqParseResult {
    diagnostics: Diagnostic[];
    tree: ModuleAndThisIsItContext;
}

class CollectingErrorListener extends BaseErrorListener {
    public readonly diagnostics: Diagnostic[] = [];

    public constructor(private readonly document: TextDocument) {
        super();
    }

    public override syntaxError<S extends Token, T extends ATNSimulator>(
        _recognizer: Recognizer<T>,
        offendingSymbol: S | null,
        line: number,
        column: number,
        message: string,
        _error: RecognitionException | null,
    ): void {
        this.diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: this.createRange(offendingSymbol, line, column),
            message,
            source: "jsoniq",
        });
    }

    private createRange(offendingSymbol: Token | null, line: number, column: number): Range {
        if (offendingSymbol !== null && offendingSymbol.start >= 0 && offendingSymbol.stop >= offendingSymbol.start) {
            return {
                start: this.document.positionAt(offendingSymbol.start),
                end: this.document.positionAt(offendingSymbol.stop + 1),
            };
        }

        const startOffset = this.document.offsetAt({
            line: Math.max(line - 1, 0),
            character: Math.max(column, 0),
        });
        const endOffset = Math.min(startOffset + 1, this.document.getText().length);

        return {
            start: this.document.positionAt(startOffset),
            end: this.document.positionAt(endOffset),
        };
    }
}

export function parseJsoniqDocument(document: TextDocument): JsoniqParseResult {
    const input = CharStream.fromString(document.getText());
    const lexer = new jsoniqLexer(input);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new jsoniqParser(tokenStream);
    const errorListener = new CollectingErrorListener(document);

    lexer.removeErrorListeners();
    parser.removeErrorListeners();
    lexer.addErrorListener(errorListener);
    parser.addErrorListener(errorListener);

    const tree = parser.moduleAndThisIsIt();

    return {
        diagnostics: errorListener.diagnostics,
        tree,
    };
}

export function collectSyntaxDiagnostics(document: TextDocument): Diagnostic[] {
    return parseJsoniqDocument(document).diagnostics;
}
