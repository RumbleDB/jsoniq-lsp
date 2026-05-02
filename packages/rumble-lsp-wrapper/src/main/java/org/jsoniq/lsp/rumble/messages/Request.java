package org.jsoniq.lsp.rumble.messages;

public record Request(long id, String requestType, String body, String documentUri) {

}
