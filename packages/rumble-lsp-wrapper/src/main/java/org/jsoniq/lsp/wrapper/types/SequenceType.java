package org.jsoniq.lsp.wrapper.types;

import com.fasterxml.jackson.annotation.JsonValue;

public record SequenceType(
        org.rumbledb.types.SequenceType type) {

    @Override
    @JsonValue
    public String toString() {
        /// Avoid infinite recursion when serializing SequenceType as part of
        /// FunctionDefinition, since SequenceType contains FunctionSignature which
        /// contains SequenceType again
        return type.toString();
    }
}
