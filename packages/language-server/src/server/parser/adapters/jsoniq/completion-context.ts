import { CodeCompletionCore } from "antlr4-c3";
import {
    IntervalSet,
    Token,
} from "antlr4ng";

import { jsoniqParser } from "grammar/jsoniqParser.js";
import { lowerBound } from "server/utils/binary-search.js";
import type {
    JsoniqParsedDocument,
} from "./parse.js";
import { ParserSyntaxContext } from "server/parser/types.js";

export function collectCompletionContext(parsed: JsoniqParsedDocument, cursorOffset: number): ParserSyntaxContext | null {
    const caret = findCaretToken(parsed.tokens, cursorOffset);
    const tokenTypes = getCompletionTokenTypes(parsed.parser, caret.tokenIndex);
    const context = closestCompletionContext(parsed.completionContexts, cursorOffset);
    const ruleStack = context?.ruleStack ?? [];

    if (tokenTypes.length === 0) {
        if (context === null) {
            return null;
        }

        return {
            expectedTokenSet: context.expectedTokenSet,
            ruleStack: context.ruleStack,
            offset: context.offset,
        };
    }

    return {
        expectedTokenSet: new IntervalSet([...tokenTypes]),
        ruleStack,
        offset: context?.offset ?? cursorOffset,
    };
}

function closestCompletionContext(
    contexts: ParserSyntaxContext[],
    cursorOffset: number,
): ParserSyntaxContext | null {
    if (contexts.length === 0) {
        return null;
    }

    const insertionPoint = lowerBound(contexts, cursorOffset, (context, target) => context.offset - target);
    const before = contexts[insertionPoint - 1];
    const after = contexts[insertionPoint];

    if (before === undefined) {
        return after!;
    }
    if (after === undefined) {
        return before;
    }

    return Math.abs(before.offset - cursorOffset) <= Math.abs(after.offset - cursorOffset)
        ? before
        : after;
}

function getCompletionTokenTypes(parser: jsoniqParser, caretTokenIndex: number): number[] {
    const core = new CodeCompletionCore(parser);
    core.ignoredTokens = IGNORED_COMPLETION_TOKENS;

    const candidates = core.collectCandidates(caretTokenIndex);
    return [...candidates.tokens.keys()].filter((tokenType) => tokenType !== Token.EOF);
}

function findCaretToken(tokens: Token[], cursorOffset: number): { tokenIndex: number; offset: number } {
    if (tokens.length === 0) {
        return { tokenIndex: 0, offset: cursorOffset };
    }

    const insertionPoint = lowerBound(tokens, cursorOffset, (token, target) => token.start - target);
    let tokenIndex = tokens[tokens.length - 1]!.tokenIndex;

    if (insertionPoint > 0) {
        const token = tokens[insertionPoint - 1]!;
        if (token.type !== Token.EOF && token.start <= cursorOffset && cursorOffset <= token.stop + 1) {
            tokenIndex = token.tokenIndex;
        } else if (insertionPoint < tokens.length) {
            tokenIndex = tokens[insertionPoint]!.tokenIndex;
        }
    } else if (insertionPoint < tokens.length) {
        tokenIndex = tokens[insertionPoint]!.tokenIndex;
    }

    for (let index = tokenIndex; index >= 0; index -= 1) {
        const token = tokens[index]!;
        if (token.type !== Token.EOF && (token.channel ?? Token.DEFAULT_CHANNEL) === Token.DEFAULT_CHANNEL) {
            return {
                tokenIndex,
                offset: Math.min(cursorOffset, token.stop + 1),
            };
        }
    }

    return { tokenIndex, offset: cursorOffset };
}

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
