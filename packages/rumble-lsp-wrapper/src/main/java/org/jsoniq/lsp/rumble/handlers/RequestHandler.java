package org.jsoniq.lsp.rumble.handlers;

import org.jsoniq.lsp.rumble.messages.Request;
import org.jsoniq.lsp.rumble.messages.ResponseBody;

public interface RequestHandler {
    String getRequestType();
    ResponseBody handle(Request request);
    ResponseBody createEmptyResponse();
}