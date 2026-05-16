package org.jsoniq.lsp.wrapper.messages;

public record Request(long id, String requestType, String body, String documentUri) {

}
