import { getCompletionIntent } from "server/parser/completion.js";
import type { ParserAdapter } from "server/parser/types/adapter.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    IGNORED_COMPLETION_TOKENS,
    KEYWORD_COMPLETIONS,
    PREFERRED_COMPLETION_RULES,
} from "./completion-data.js";
import { XQueryTokenContextAnalyzer } from "./completion-token-context.js";
import { XQueryParser } from "./grammar/XQueryParser.js";
import { parseXQuery } from "./parse.js";

const XQUERY_LANGUAGE_ID = "xquery";

export const xqueryParserAdapter: ParserAdapter = {
    id: "xquery",
    supports: (document: TextDocument) => {
        if (document.languageId === XQUERY_LANGUAGE_ID) {
            return true;
        }
        const text = document.getText();
        if (text.includes("xquery version")) {
            return true;
        }
        if (text.includes("jsoniq version")) {
            return false;
        }
        const uri = document.uri.toLowerCase();
        if (uri.endsWith(".xq") || uri.endsWith(".xqy") || uri.endsWith(".xquery")) {
            return true;
        }
        return false;
    },
    parse: parseXQuery,
    getCompletionIntent: (parsed, cursorOffset) =>
        getCompletionIntent(parsed, cursorOffset, {
            tokenContextAnalyzer: XQueryTokenContextAnalyzer,
            ignoredTokens: IGNORED_COMPLETION_TOKENS,
            preferredRules: PREFERRED_COMPLETION_RULES,
            languageKeywords: KEYWORD_COMPLETIONS,
            isFunctionCallRule: (ruleIndex) => ruleIndex === XQueryParser.RULE_functionCall,
            isVariableReferenceRule: (ruleIndex) => ruleIndex === XQueryParser.RULE_varRef,
            tokenName: (tokenType) => XQueryParser.symbolicNames[tokenType] ?? tokenType,
            ruleName: (ruleIndex) => XQueryParser.ruleNames[ruleIndex] ?? ruleIndex,
        }),
};
