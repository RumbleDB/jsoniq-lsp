package org.jsoniq.lsp.rumble.messages;

import org.jsoniq.lsp.rumble.Error;

public record Response(
        long id,
        String responseType,
        ResponseBody body,
        Error error) {
}