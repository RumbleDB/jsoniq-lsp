import { TextDocument } from "vscode-languageserver-textdocument";

import { jsoniqParserAdapter } from "./adapters/jsoniq/index.js";
import type { ParserAdapter } from "./types/adapter.js";

const adapters: ParserAdapter[] = [jsoniqParserAdapter];

export function getParserAdapterForDocument(document: TextDocument): ParserAdapter {
    const adapter = adapters.find((candidate) => candidate.supports(document));

    if (adapter === undefined) {
        throw new Error(`No parser adapter found for document '${document.uri}'.`);
    }

    return adapter;
}
