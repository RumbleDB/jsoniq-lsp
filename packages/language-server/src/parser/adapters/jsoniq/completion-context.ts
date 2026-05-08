import { CodeCompletionCore } from "antlr4-c3";
import { Token } from "antlr4ng";
import type { CompletionIntent, ParserKeywordCompletion } from "server/parser/types/completion.js";
import { findCaretToken } from "server/parser/utils.js";
import { createLogger } from "server/utils/logger.js";

import {
    IGNORED_COMPLETION_TOKENS,
    KEYWORD_COMPLETIONS,
    PREFERRED_COMPLETION_RULES,
} from "./completion-data.js";
import { jsoniqParser } from "./grammar/jsoniqParser.js";
import type { JsoniqParsedDocument } from "./parse.js";

export function getCompletionIntent(
    parsed: JsoniqParsedDocument,
    cursorOffset: number,
): CompletionIntent | null {
    return toCompletionIntent(collectCompletionCandidates(parsed, cursorOffset));
}

const logger = createLogger("completion-context");

interface JSONiqCompletionCandidates {
    tokenTypes: Set<number>;
    ruleIndices: Set<number>;
}

function collectCompletionCandidates(
    parsed: JsoniqParsedDocument,
    cursorOffset: number,
): JSONiqCompletionCandidates {
    const caret = findCaretToken(parsed.tokens, cursorOffset);
    const candidates = getCompletionCandidates(parsed.parser, caret.tokenIndex);

    return {
        tokenTypes: new Set(
            [...candidates.tokens.keys()].filter((tokenType) => tokenType !== Token.EOF),
        ),
        ruleIndices: new Set(candidates.rules.keys()),
    };
}

function toCompletionIntent(candidates: JSONiqCompletionCandidates): CompletionIntent {
    const allowFunctions = isFunctionReferenceContext(candidates);
    const allowVariables = isVariableReferenceContext(candidates);
    const allowVariableDeclarations = isVariableDeclarationContext(candidates);
    const keywords = keywordCompletions(candidates);

    const expectedTokens = [...candidates.tokenTypes].map(
        (tokenType) => jsoniqParser.symbolicNames[tokenType] ?? tokenType,
    );
    const expectedRules = [...candidates.ruleIndices].map(
        (ruleIndex) => jsoniqParser.ruleNames[ruleIndex] ?? ruleIndex,
    );

    logger.debug("Completion candidates:", {
        allowFunctions,
        allowVariables,
        allowVariableDeclarations,
        keywords,
        expectedTokens,
        expectedRules,
    });

    return {
        allowVariableReferences: allowVariables,
        allowVariableDeclarations,
        allowFunctions,
        keywords,
    };
}

function hasCandidateRule(candidates: JSONiqCompletionCandidates, ruleIndex: number): boolean {
    return candidates.ruleIndices.has(ruleIndex);
}

function hasCandidateToken(candidates: JSONiqCompletionCandidates, tokenType: number): boolean {
    return candidates.tokenTypes.has(tokenType);
}

function getCompletionCandidates(parser: jsoniqParser, caretTokenIndex: number) {
    const core = new CodeCompletionCore(parser);
    core.ignoredTokens = IGNORED_COMPLETION_TOKENS;
    core.preferredRules = PREFERRED_COMPLETION_RULES;

    return core.collectCandidates(caretTokenIndex);
}

function isFunctionReferenceContext(candidates: JSONiqCompletionCandidates): boolean {
    return (
        hasCandidateRule(candidates, jsoniqParser.RULE_functionCall) &&
        !hasCandidateRule(candidates, jsoniqParser.RULE_declaredVarRef)
    );
}

function isVariableReferenceContext(candidates: JSONiqCompletionCandidates): boolean {
    return (
        hasCandidateRule(candidates, jsoniqParser.RULE_varRef) &&
        !hasCandidateRule(candidates, jsoniqParser.RULE_declaredVarRef)
    );
}

function isVariableDeclarationContext(candidates: JSONiqCompletionCandidates): boolean {
    return hasCandidateRule(candidates, jsoniqParser.RULE_declaredVarRef);
}

function keywordCompletions(candidates: JSONiqCompletionCandidates): ParserKeywordCompletion[] {
    return KEYWORD_COMPLETIONS.filter((completion) =>
        hasCandidateToken(candidates, completion.tokenType),
    ).map(({ label, insertText }) => ({
        label,
        ...(insertText === undefined ? {} : { insertText }),
    }));
}
