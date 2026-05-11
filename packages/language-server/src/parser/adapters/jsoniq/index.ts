import type { ParserAdapter } from "server/parser/types/adapter.js";
import { hasJsoniqCellMagic } from "server/parser/utils.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getCompletionIntent } from "./completion-context.js";
import { parseJsoniq, type JsoniqParsedDocument } from "./parse.js";

export type { JsoniqParsedDocument } from "./parse.js";

const JSONIQ_LANGUAGE_ID = "jsoniq";

export const jsoniqParserAdapter: ParserAdapter = {
    id: "jsoniq",
    supports: (document: TextDocument) =>
        document.languageId === JSONIQ_LANGUAGE_ID || hasJsoniqCellMagic(document),
    parse: parseJsoniq,
    getCompletionIntent: (parsed, cursorOffset) =>
        getCompletionIntent(parsed as JsoniqParsedDocument, cursorOffset),
};
