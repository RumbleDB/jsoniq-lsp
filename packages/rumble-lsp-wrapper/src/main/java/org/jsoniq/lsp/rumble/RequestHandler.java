package org.jsoniq.lsp.rumble;

public interface RequestHandler {
    ResponseBody handle(Request request);
    ResponseBody createEmptyResponse();
}