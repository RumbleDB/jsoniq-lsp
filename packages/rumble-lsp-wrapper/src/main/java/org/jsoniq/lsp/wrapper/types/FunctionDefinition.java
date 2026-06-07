package org.jsoniq.lsp.wrapper.types;

import java.util.List;

public record FunctionDefinition(
        Name name,
        Signature signature) {

    public record Name(
            ResolvedQName qname,
            Integer arity) {
    }

    public record Signature(
            List<String> parameterTypes,
            String returnType) {
    }
}
