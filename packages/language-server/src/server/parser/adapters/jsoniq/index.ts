import type { ParserAdapter } from "server/parser/types.js";
import {
    collectCompletionContext,
    getCompletionIntent,
} from "./completion-context.js";
import {
    parseJsoniq,
    type JsoniqParsedDocument,
} from "./parse.js";

export type {
    JsoniqParsedDocument,
} from "./parse.js";

export const jsoniqParserAdapter: ParserAdapter = {
    id: "jsoniq",
    supports: () => true,
    parse: parseJsoniq,
    collectCompletionContext: (parsed, cursorOffset) => collectCompletionContext(parsed as JsoniqParsedDocument, cursorOffset),
    getCompletionIntent,
};
