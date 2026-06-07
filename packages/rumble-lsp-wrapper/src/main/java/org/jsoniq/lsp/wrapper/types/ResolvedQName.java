package org.jsoniq.lsp.wrapper.types;

public record ResolvedQName(
        String localName,
        String namespaceUri,
        String lexicalPrefix) {
}
