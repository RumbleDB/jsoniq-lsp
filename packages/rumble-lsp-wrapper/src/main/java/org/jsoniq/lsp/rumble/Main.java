package org.jsoniq.lsp.rumble;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Objects;

import org.jsoniq.lsp.rumble.handlers.BuiltinFunctions;
import org.jsoniq.lsp.rumble.handlers.RequestHandler;
import org.jsoniq.lsp.rumble.handlers.TypeInferencer;
import org.jsoniq.lsp.rumble.messages.Request;
import org.jsoniq.lsp.rumble.messages.Response;
import org.jsoniq.lsp.rumble.messages.ResponseBody;

public class Main {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final TypeInferencer INFERENCER = new TypeInferencer();
    private static final BuiltinFunctions BUILTIN_FUNCTIONS = new BuiltinFunctions();

    private static final Map<String, RequestHandler> DAEMON_HANDLERS = Map.of(
            INFERENCER.getRequestType(), INFERENCER,
            BUILTIN_FUNCTIONS.getRequestType(), BUILTIN_FUNCTIONS);

    private static long requestIdCounter = 0;

    public static void main(String[] args) {
        if (isDaemonMode(args)) {
            runDaemon();
            return;
        }

        /// For now, the non-daemon mode only supports type inference
        /// I might remove this one, or improve it using arg parser in the future
        try {
            String query = readAllStdin();
            TypeInferencer.Result result = INFERENCER.infer(query);
            writeAndExit(new Response(
                    requestIdCounter++,
                    INFERENCER.getRequestType(),
                    result,
                    null),
                    0);
        } catch (Throwable throwable) {
            String errorMessage = Objects.toString(throwable.getMessage(), throwable.getClass().getName());
            writeAndExit(new Response(
                    requestIdCounter++,
                    INFERENCER.getRequestType(),
                    null,
                    errorMessage), 1);
        }
    }

    private static boolean isDaemonMode(String[] args) {
        for (String argument : args) {
            if ("--daemon".equals(argument)) {
                return true;
            }
        }
        return false;
    }

    private static void runDaemon() {
        try (
                BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
                PrintWriter writer = new PrintWriter(System.out, true, StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
                Response response = processDaemonRequest(line);
                writer.println(OBJECT_MAPPER.writeValueAsString(response));
                writer.flush();
            }
            System.exit(0);
        } catch (Throwable throwable) {
            System.exit(1);
        }
    }

    private static Response processDaemonRequest(String requestLine) {
        long requestId = -1L;
        String requestType = null;

        try {
            Request request = OBJECT_MAPPER.readValue(requestLine, Request.class);
            requestId = request.id();
            requestType = request.requestType();
            RequestHandler handler = DAEMON_HANDLERS.get(requestType);
            if (handler == null) {
                return new Response(requestId, requestType, null,
                        "Unsupported requestType '" + requestType + "'.");
            }

            return new Response(requestId, requestType,
                    handler.handle(new Request(requestId, requestType, request.body())), null);
        } catch (Throwable throwable) {
            String errorMessage = Objects.toString(throwable.getMessage(), throwable.getClass().getName());
            RequestHandler handler = DAEMON_HANDLERS.get(requestType);
            ResponseBody emptyResponse = handler == null ? null : handler.createEmptyResponse();
            return new Response(requestId, requestType, emptyResponse, errorMessage);
        }
    }

    private static String readAllStdin() throws IOException {
        StringBuilder content = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            boolean firstLine = true;
            while ((line = reader.readLine()) != null) {
                if (!firstLine) {
                    content.append('\n');
                }
                content.append(line);
                firstLine = false;
            }
        }
        return content.toString();
    }

    private static void writeAndExit(Response response, int exitCode) {
        try {
            System.out.println(OBJECT_MAPPER.writeValueAsString(response));
        } catch (JsonProcessingException exception) {
            System.out
                    .println(
                            "{\"variableTypes\":[],\"functionTypes\":[],\"builtinFunctions\":{},\"error\":\"Failed to serialize wrapper response.\"}");
        }
        System.exit(exitCode);
    }
}
