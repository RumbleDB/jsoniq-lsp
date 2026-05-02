import {
    BaseErrorListener,
    CharStream,
    CommonTokenStream,
    type ATNSimulator,
    type RecognitionException,
    type Recognizer,
    Token,
} from "antlr4ng";
import {
    Diagnostic,
    DiagnosticSeverity,
    type Range,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { jsoniqLexer } from "grammar/jsoniqLexer.js";
import { jsoniqParser } from "grammar/jsoniqParser.js";
import type {
    ParseResult,
    SyntaxContext,
} from "server/parser/types.js";
import { collectSemanticEvents } from "./semantic-events.js";

export interface JsoniqParsedDocument extends ParseResult {
    parser: jsoniqParser;
    tokens: Token[];
}

class JsoniqErrorListener extends BaseErrorListener {
    public readonly diagnostics: Diagnostic[] = [];
    public readonly contexts: SyntaxContext[] = [];

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

        if (recognizer instanceof jsoniqParser) {
            try {
                const offset = this.document.offsetAt(range.start);
                this.contexts.push({
                    offset,
                    expectedTokenSet: recognizer.getExpectedTokens(),
                    ruleStack: toParserRuleStack(recognizer, recognizer.getRuleInvocationStack()),
                });
            } catch {
                // The parser can be in an invalid state after a complete parse; diagnostics still matter.
            }
        }

        this.diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range,
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

export function parseJsoniq(document: TextDocument): JsoniqParsedDocument {
    const { lexer, parser, tokenStream } = createParser(document.getText());
    const errorListener = new JsoniqErrorListener(document);

    lexer.removeErrorListeners();
    parser.removeErrorListeners();
    lexer.addErrorListener(errorListener);
    parser.addErrorListener(errorListener);

    const tree = parser.moduleAndThisIsIt();

    tokenStream.fill();

    return {
        parser,
        tokens: tokenStream.getTokens(),
        diagnostics: errorListener.diagnostics,
        completionContexts: errorListener.contexts,
        semanticEvents: collectSemanticEvents(tree, document),
    };
}

function createParser(source: string): { lexer: jsoniqLexer; parser: jsoniqParser; tokenStream: CommonTokenStream } {
    const input = CharStream.fromString(source);
    const lexer = new jsoniqLexer(input);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new jsoniqParser(tokenStream);

    return { lexer, parser, tokenStream };
}

function toParserRuleStack(parser: jsoniqParser, ruleNames: string[]): number[] {
    return ruleNames
        .map((ruleName) => parser.getRuleIndex(ruleName))
        .filter((ruleIndex) => ruleIndex >= 0);
}
