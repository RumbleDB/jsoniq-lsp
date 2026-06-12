import { TextDocument } from "vscode-languageserver-textdocument";

import { jsoniqParserAdapter } from "./adapters/jsoniq/index.js";
import { xqueryParserAdapter } from "./adapters/xquery/index.js";
import type { ParserAdapter } from "./types/adapter.js";

const adapters: ParserAdapter[] = [xqueryParserAdapter, jsoniqParserAdapter];

export function getParserAdapterForDocument(document: TextDocument): ParserAdapter | undefined {
    return adapters.find((candidate) => candidate.supports(document));
}

export function supportsDocument(document: TextDocument): boolean {
    return getParserAdapterForDocument(document) !== undefined;
}
