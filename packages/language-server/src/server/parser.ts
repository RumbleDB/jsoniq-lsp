import {
    BaseErrorListener,
    CharStream,
    CommonTokenStream,
    type ATNSimulator,
    IntervalSet,
    type RecognitionException,
    type Recognizer,
    Token,
} from "antlr4ng";
import { CodeCompletionCore } from "antlr4-c3";
import {
    Diagnostic,
    DiagnosticSeverity,
    type DocumentUri,
    type Range,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { jsoniqLexer } from "../grammar/jsoniqLexer.js";
import { jsoniqParser, type ModuleAndThisIsItContext } from "../grammar/jsoniqParser.js";
import { lowerBound } from "./utils/binary-search.js";

/**
 * Creates a new instance of the JSONiq parser for the given source code. 
 * @param source The source code to parse
 * @returns An object containing the lexer, parser, and token stream for the given source code
 */
function createParser(source: string): { lexer: jsoniqLexer; parser: jsoniqParser; tokenStream: CommonTokenStream } {
    const input = CharStream.fromString(source);
    const lexer = new jsoniqLexer(input);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new jsoniqParser(tokenStream);

    return { lexer, parser, tokenStream };
}

/**
 * This is the result of collecting the expected syntax at a given position,
 * which includes the set of expected tokens and the rule stack at that position.
 */
export interface JsoniqCompletionContext {
    /**
     * List of token types that are expected at the position where code completion is invoked.
     */
    tokens: IntervalSet;

    /**
     * The stack of parser rules that are active at the position where code completion is invoked, with the most recently entered rule first.
     * This can be used to determine the syntactic context for code completion suggestions (e.g., whether we are inside a function declaration, an expression, etc.).
     */
    ruleStack: string[];

    /**
     * The offset in the document where this completion context was captured.
     * We use offset here instead of Position because later, when querying 
     */
    offset: number;

}

export interface JsoniqParseResult {
    diagnostics: Diagnostic[];
    completionContexts: JsoniqCompletionContext[];
    tree: ModuleAndThisIsItContext;
}
/**
 * Class used to collect syntax errors and capture parser context for completion.
 */
class JsoniqErrorListener extends BaseErrorListener {
    public readonly diagnostics: Diagnostic[] = [];
    public readonly contexts: JsoniqCompletionContext[] = [];

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
                this.contexts.push({
                    offset: this.document.offsetAt(range.start),
                    tokens: recognizer.getExpectedTokens(),
                    ruleStack: recognizer.getRuleInvocationStack(),
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

interface CachedParse {
    version: number;
    parser: jsoniqParser;
    tokens: Token[];
    result: JsoniqParseResult;
}

function buildCachedParse(document: TextDocument): CachedParse {
    const { lexer, parser, tokenStream } = createParser(document.getText());
    const errorListener = new JsoniqErrorListener(document);

    lexer.removeErrorListeners();
    parser.removeErrorListeners();
    lexer.addErrorListener(errorListener);
    parser.addErrorListener(errorListener);

    const tree = parser.moduleAndThisIsIt();

    tokenStream.fill();
    const tokens = tokenStream.getTokens();

    return {
        version: document.version,
        parser,
        tokens,
        result: {
            diagnostics: errorListener.diagnostics,
            completionContexts: errorListener.contexts,
            tree,
        },
    };
}

const parseCache = new Map<DocumentUri, CachedParse>();

function getCachedParse(document: TextDocument): CachedParse {
    const cached = parseCache.get(document.uri);

    if (cached !== undefined && cached.version === document.version) {
        return cached;
    }

    const next = buildCachedParse(document);
    parseCache.set(document.uri, next);
    return next;
}

/**
 * Parses a JSONiq document and returns the parse result, 
 * which includes syntax diagnostics, completion contexts, and the parse tree.
 * @param document The JSONiq document to parse
 * @returns An object containing syntax diagnostics, completion contexts, and the parse tree for the given document
 */
export function parseJsoniqDocument(document: TextDocument): JsoniqParseResult {
    return getCachedParse(document).result;
}

/**
 * Default rule stack to use when the expected syntax cannot be determined from the input prefix.
 */
const TOP_LEVEL_RULE_STACK = ["prolog", "mainModule", "module", "moduleAndThisIsIt"];

/**
 * Collects the expected syntax at a given position in the document for code completion purposes.
 * @param document The JSONiq document for which to collect completion context
 * @param cursorOffset The offset in the document where code completion is invoked
 * @returns 
 */
export function collectCompletionContext(document: TextDocument, cursorOffset: number): JsoniqCompletionContext | null {
    const cached = getCachedParse(document);
    const caretTokenIndex = findCaretTokenIndex(cached.tokens, cursorOffset);
    const tokenTypes = getCompletionTokenTypes(cached.parser, caretTokenIndex);
    const context = closestCompletionContext(cached.result.completionContexts, cursorOffset);
    const ruleStack = context?.ruleStack ?? TOP_LEVEL_RULE_STACK;

    if (tokenTypes.length === 0) {
        // C3 can fail to determine expected tokens in certain cases
        // In that case, we fallback to using the context from the closest syntax error
        return context ?? null;
    }

    return {
        tokens: new IntervalSet([...tokenTypes]),
        ruleStack,
        offset: context?.offset ?? cursorOffset,
    };
}

/**
 * Find the closest completion context to the given cursor offset from a list of collected contexts.
 * @param contexts The list of collected completion contexts, which should be sorted by their offset in ascending order
 * @param cursorOffset The offset in the document where code completion is invoked
 * @returns The completion context that is closest to the given cursor offset, or null if no contexts are available
 */
function closestCompletionContext(
    contexts: JsoniqCompletionContext[],
    cursorOffset: number,
): JsoniqCompletionContext | null {
    if (contexts.length === 0) {
        return null;
    }

    // Find the closest context to the cursor offset using binary search, since contexts are collected in order of occurrence in the document.
    const insertionPoint = lowerBound(contexts, cursorOffset, (context, target) => context.offset - target);
    const candidates: JsoniqCompletionContext[] = [];

    if (insertionPoint > 0) {
        candidates.push(contexts[insertionPoint - 1]!);
    }
    if (insertionPoint < contexts.length) {
        candidates.push(contexts[insertionPoint]!);
    }

    let closest = candidates[0]!;
    for (let i = 1; i < candidates.length; i++) {
        if (Math.abs(candidates[i]!.offset - cursorOffset) < Math.abs(closest.offset - cursorOffset)) {
            closest = candidates[i]!;
        }
    }

    return {
        tokens: closest.tokens,
        ruleStack: closest.ruleStack,
        offset: closest.offset,
    };
}

/**
 * Get the token types that are expected at the given caret token index, using the ANTLR code completion core.
 * @param parser The JSONiq parser for the document being analyzed
 * @param caretTokenIndex The index of the token at the caret position for which to collect expected token types
 * @returns An array of token types that are expected at the given caret token index
 */
function getCompletionTokenTypes(parser: jsoniqParser, caretTokenIndex: number): number[] {
    const core = new CodeCompletionCore(parser);
    core.ignoredTokens = IGNORED_COMPLETION_TOKENS;
    core.preferredRules = new Set([jsoniqParser.RULE_qname]);

    const candidates = core.collectCandidates(caretTokenIndex);
    return [...candidates.tokens.keys()].filter((tokenType) => tokenType !== Token.EOF);
}

/**
 * Find the index of the token at the caret position, or the nearest token if the caret is between tokens. 
 * Uses binary search since tokens are sorted by their start offset.
 * @param tokens The array of tokens in the document
 * @param cursorOffset The offset in the document where code completion is invoked
 * @returns The index of the token at the caret position or the nearest token
 */
function findCaretTokenIndex(tokens: Token[], cursorOffset: number): number {
    if (tokens.length === 0) {
        return 0;
    }

    // Binary search to find the insertion point for cursorOffset in the token.start sequence
    const insertionPoint = lowerBound(tokens, cursorOffset, (token, target) => token.start - target);

    // Check if the token before the insertion point contains the cursor
    if (insertionPoint > 0) {
        const token = tokens[insertionPoint - 1]!;
        if (token.type !== Token.EOF && token.start <= cursorOffset && cursorOffset <= token.stop + 1) {
            return token.tokenIndex;
        }
    }

    // Otherwise, return the token at or after the insertion point
    if (insertionPoint < tokens.length) {
        return tokens[insertionPoint]!.tokenIndex;
    }

    // Cursor is after all tokens; return the last token
    return tokens[tokens.length - 1]!.tokenIndex;
}

/**
 * Set of token types that should be ignored when collecting expected tokens for code completion, 
 * as they are not useful for suggesting completions to the user. 
 */
const IGNORED_COMPLETION_TOKENS = new Set([
    jsoniqParser.ArgumentPlaceholder,
    jsoniqParser.Kplus,
    jsoniqParser.Kminus,
    jsoniqParser.Kasterisk,
    jsoniqParser.Kdiv,
    jsoniqParser.Klparen,
    jsoniqParser.Krparen,
    jsoniqParser.Klbrace,
    jsoniqParser.Krbrace,
    jsoniqParser.Kobject_start,
    jsoniqParser.Kobject_end,
    jsoniqParser.Klbracket,
    jsoniqParser.Krbracket,
    jsoniqParser.Kannotation,
    jsoniqParser.Kdot,
    jsoniqParser.Kbang,
    jsoniqParser.Kequal,
    jsoniqParser.Kor,
    jsoniqParser.Knot,
    jsoniqParser.Kless,
    jsoniqParser.Kless_or_equal,
    jsoniqParser.Kgreater,
    jsoniqParser.Kgreater_or_equal,
    jsoniqParser.Kcomma,
]);
