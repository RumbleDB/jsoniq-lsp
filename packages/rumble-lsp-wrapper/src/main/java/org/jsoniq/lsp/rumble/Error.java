package org.jsoniq.lsp.rumble;

import org.rumbledb.exceptions.RumbleException;

public record Error(
        String code,
        String message,
        Position position) {

    static Error fromRumbleException(RumbleException exception) {
        return new Error(
                exception.getErrorCode().toString(),
                exception.getMessage(),
                new Position(exception.getMetadata().getTokenLineNumber(),
                        exception.getMetadata().getTokenColumnNumber()));
    }
}