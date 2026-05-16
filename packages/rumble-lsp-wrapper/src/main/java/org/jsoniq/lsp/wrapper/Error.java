package org.jsoniq.lsp.wrapper;

import org.rumbledb.exceptions.RumbleException;

public record Error(
        String code,
        String message,
        Position position) {

    static Error fromRumbleException(RumbleException exception) {
        return new Error(
                exception.getErrorCode().toString(),
                exception.getJSONiqErrorMessage(),
                Position.fromExceptionMetadata(exception.getMetadata()));
    }
}