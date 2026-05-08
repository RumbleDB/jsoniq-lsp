import type { ParserAdapter } from "server/parser/types/adapter.js";

import { getCompletionIntent } from "./completion-context.js";
import { parseJsoniq, type JsoniqParsedDocument } from "./parse.js";

export type { JsoniqParsedDocument } from "./parse.js";

export const jsoniqParserAdapter: ParserAdapter = {
    id: "jsoniq",
    supports: () => true,
    parse: parseJsoniq,
    getCompletionIntent: (parsed, cursorOffset) =>
        getCompletionIntent(parsed as JsoniqParsedDocument, cursorOffset),
};
