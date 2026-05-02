import type { DocumentUri } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type {
    CompletionIntent,
    ParseResult,
    ParserAdapter,
    ParserSyntaxContext,
} from "./types.js";
import { getParserAdapterForDocument } from "./registry.js";

interface CachedParsedDocument {
    version: number;
    adapterId: string;
    adapter: ParserAdapter;
    parsed: ParseResult;
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

export function parseDocument(document: TextDocument): ParseResult {
    const cached = getCachedParsedDocument(document);
    return cached.parsed;
}

export function collectCompletionContext(document: TextDocument, cursorOffset: number): ParserSyntaxContext | null {
    const cached = getCachedParsedDocument(document);
    return cached.adapter.collectCompletionContext(cached.parsed, cursorOffset);
}

export function collectCompletionIntent(document: TextDocument, cursorOffset: number): CompletionIntent | null {
    const cached = getCachedParsedDocument(document);
    const context = cached.adapter.collectCompletionContext(cached.parsed, cursorOffset);
    if (context === null) {
        return null;
    }

    return cached.adapter.getCompletionIntent(context);
}
