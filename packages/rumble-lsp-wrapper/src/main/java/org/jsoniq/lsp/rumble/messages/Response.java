package org.jsoniq.lsp.rumble.messages;

public record Response(
        long id,
        String responseType,
        ResponseBody body,
        String error) {
}