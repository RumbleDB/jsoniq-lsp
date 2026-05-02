import type { DocumentUri } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { ParsedDocument, ParserAdapter } from "./types.js";
import type { JsoniqParseResult, JsoniqSyntaxContext } from "./adapters/jsoniq/index.js";
import { getParserAdapterForDocument } from "./registry.js";

export type { JsoniqParseResult, JsoniqSyntaxContext };

interface CachedParsedDocument {
    version: number;
    adapterId: string;
    adapter: ParserAdapter;
    parsed: ParsedDocument;
}

const parseCache = new Map<DocumentUri, CachedParsedDocument>();

function getCachedParsedDocument(document: TextDocument): CachedParsedDocument {
    const adapter = getParserAdapterForDocument(document);
    const cached = parseCache.get(document.uri);

    if (cached !== undefined && cached.version === document.version && cached.adapterId === adapter.id) {
        return cached;
    }

    const parsed = adapter.parse(document);
    const next = {
        version: document.version,
        adapterId: adapter.id,
        adapter,
        parsed,
    } satisfies CachedParsedDocument;

    parseCache.set(document.uri, next);
    
    return next;
}

export function parseJsoniqDocument(document: TextDocument): JsoniqParseResult {
    const cached = getCachedParsedDocument(document);
    return cached.parsed.result as JsoniqParseResult;
}

export function collectCompletionContext(document: TextDocument, cursorOffset: number): JsoniqSyntaxContext | null {
    const cached = getCachedParsedDocument(document);
    return cached.adapter.collectCompletionContext(cached.parsed, cursorOffset) as JsoniqSyntaxContext | null;
}
