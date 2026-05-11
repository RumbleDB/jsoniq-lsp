import { TextDocument } from "vscode-languageserver-textdocument";

import { jsoniqParserAdapter } from "./adapters/jsoniq/index.js";
import type { ParserAdapter } from "./types/adapter.js";

const adapters: ParserAdapter[] = [jsoniqParserAdapter];

export function getParserAdapterForDocument(document: TextDocument): ParserAdapter | undefined {
    return adapters.find((candidate) => candidate.supports(document));
}

export function supportsDocument(document: TextDocument): boolean {
    return getParserAdapterForDocument(document) !== undefined;
}
