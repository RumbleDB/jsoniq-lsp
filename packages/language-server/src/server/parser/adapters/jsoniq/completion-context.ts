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
import type {
    CompletionIntent,
    ParserKeywordCompletion,
    ParserSyntaxContext,
} from "server/parser/types.js";
import {
    EXPRESSION_KEYWORD_TOKENS,
    EXPRESSION_RULES,
    FLOWR_CONTINUATION_TOKENS,
    KEYWORD_COMPLETIONS,
    NON_DOLLAR_EXPRESSION_START_TOKENS,
    VARIABLE_DECLARATION_NAME_RULES,
    VARIABLE_DECLARATION_RULES,
} from "./completion-data.js";

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

export function getCompletionIntent(context: ParserSyntaxContext): CompletionIntent {
    // Determine whether we are in a context where a variable is being declared (e.g. the "$x" in "let $x := ..."),
    // which affects whether we offer variable completions and whether to include the "$" declaration starter.
    const insideVariableBindingHeader = isInsideVariableBindingHeader(context);

    // In declaration contexts, we want to offer keyword completions (e.g. "declare function") as well as a "$" completion for variable declarations, but not variable reference completions.
    const declaringVariableName = insideVariableBindingHeader && (
        context.expectedTokenSet.contains(jsoniqParser.Kdollar)
        || VARIABLE_DECLARATION_NAME_RULES.has(context.ruleStack[0] ?? -1)
    );

    // We are expecting a name if we are declaring a variable and the expected tokens include "$",
    // or if the syntax context is explicitly a qname (e.g. in a function declaration or prolog declaration).
    const expectingName = declaringVariableName || context.ruleStack[0] === jsoniqParser.RULE_qname;

    // Do we expect an expression here?
    const expressionReferenceContext = isExpressionReferenceContext(context);
    const topLevelModuleStartContext = context.ruleStack.length === 0
        && context.expectedTokenSet.contains(jsoniqParser.Kmodule);

    return {
        allowVariableReferences: !insideVariableBindingHeader && expressionReferenceContext,
        allowBuiltinFunctions: !declaringVariableName && expressionReferenceContext,
        allowKeywords: !expectingName,
        allowVariableDeclarationStarter: declaringVariableName,
        keywords: keywordCompletions(context, expressionReferenceContext && !topLevelModuleStartContext),
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

/**
 * Determines whether we are in a context where a variable name is being declared, based on the syntax context.
 */
function isInsideVariableBindingHeader(context: ParserSyntaxContext): boolean {
    const declarationDepth = firstIndexOfRule(context.ruleStack, VARIABLE_DECLARATION_RULES);

    if (declarationDepth === -1) {
        return context.ruleStack.length === 0
            && context.expectedTokenSet.contains(jsoniqParser.Kdollar)
            && !hasExpectedToken(context, NON_DOLLAR_EXPRESSION_START_TOKENS);
    }

    // If we are already inside an expression nested in a declaration construct
    // (e.g. let $x := <expr>), this is no longer a declaration-name site.
    const expressionDepth = firstIndexOfRule(context.ruleStack, EXPRESSION_RULES);
    if (expressionDepth !== -1 && expressionDepth < declarationDepth) {
        return false;
    }

    return true;
}

/**
 * Check if we are in a context where an expression can be expected.
 * @param context current syntax context at the cursor position
 * @returns true if we are in an expression context, false otherwise
 */
function isExpressionReferenceContext(context: ParserSyntaxContext): boolean {
    if (context.ruleStack[0] === jsoniqParser.RULE_qname) {
        // We are expecting a name, not an expression.
        return false;
    }

    // With an empty rule stack, we can still distinguish the start of a module
    // from expression-capable locations by checking whether `module` is expected.
    if (context.ruleStack.length === 0) {
        if (hasExpectedToken(context, NON_DOLLAR_EXPRESSION_START_TOKENS)) {
            return true;
        }

        return !context.expectedTokenSet.contains(jsoniqParser.Kmodule);
    }

    const insideFlowrExpression = context.ruleStack.includes(jsoniqParser.RULE_flowrExpr);
    if (insideFlowrExpression
        && hasExpectedToken(context, FLOWR_CONTINUATION_TOKENS)
        && !context.expectedTokenSet.contains(jsoniqParser.Kdollar)) {
        // If we are in a continuation clause of a FLWOR expression (e.g. after a "where" or "group by")
        // For example:
        //      for $x in items
        //      let $y := $x
        //      | <- here we expect a "where", "group by", "order by" or "count" continuation, but not an expression starting with "$"
        return false;
    }

    // In all other cases, we are in an expression context if either the grammar explicitly allows an expression to start here (e.g. after an "=" or "return")
    // or if we are already inside an expression (e.g. in the "then" branch of an if expression)
    return firstIndexOfRule(context.ruleStack, EXPRESSION_RULES) !== -1
        || hasExpectedToken(context, NON_DOLLAR_EXPRESSION_START_TOKENS);
}

function keywordCompletions(context: ParserSyntaxContext, expressionReferenceContext: boolean): ParserKeywordCompletion[] {
    return KEYWORD_COMPLETIONS
        .filter((completion) => context.expectedTokenSet.contains(completion.tokenType))
        .filter((completion) => !expressionReferenceContext || EXPRESSION_KEYWORD_TOKENS.has(completion.tokenType))
        .map(({ label, insertText }) => ({
            label,
            ...(insertText === undefined ? {} : { insertText }),
        }));
}

/**
 * Finds the index of the first occurrence of any of the candidate rules in the rule stack.
 * @param ruleStack the current syntax context's rule stack
 * @param candidates the set of candidate rules to look for
 * @returns the index of the first occurrence of any candidate rule, or -1 if none are found
 */
function firstIndexOfRule(ruleStack: number[], candidates: Set<number>): number {
    return ruleStack.findIndex((rule) => candidates.has(rule));
}

function hasExpectedToken(context: ParserSyntaxContext, tokenTypes: Set<number>): boolean {
    return [...tokenTypes.values()]
        .some((tokenType) => context.expectedTokenSet.contains(tokenType));
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
