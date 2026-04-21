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

public class Main {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final TypeInferencer INFERENCER = new TypeInferencer();
    private static final BuiltinFunctions BUILTIN_FUNCTIONS = new BuiltinFunctions();
    private static final String REQUEST_TYPE_INFER_TYPES = "inferTypes";
    private static final String REQUEST_TYPE_BUILTIN_FUNCTIONS = "builtinFunctions";

    private static final Map<String, RequestHandler> DAEMON_HANDLERS = Map.of(
            REQUEST_TYPE_INFER_TYPES, INFERENCER,
            REQUEST_TYPE_BUILTIN_FUNCTIONS, BUILTIN_FUNCTIONS);

    private record WrapperResponse(
            long id,
            String responseType,
            ResponseBody body,
            String error) {
    }

    private static long requestIdCounter = 0;

    public static void main(String[] args) {
        if (isDaemonMode(args)) {
            runDaemon();
            return;
        }

        try {
            String query = readAllStdin();
            TypeInferencer.Result result = INFERENCER.infer(query);
            writeAndExit(new WrapperResponse(
                    requestIdCounter++,
                    REQUEST_TYPE_INFER_TYPES,
                    result,
                    null),
                    0);
        } catch (Throwable throwable) {
            String errorMessage = Objects.toString(throwable.getMessage(), throwable.getClass().getName());
            writeAndExit(new WrapperResponse(
                    requestIdCounter++,
                    REQUEST_TYPE_INFER_TYPES,
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
                WrapperResponse response = processDaemonRequest(line);
                writer.println(OBJECT_MAPPER.writeValueAsString(response));
                writer.flush();
            }
            System.exit(0);
        } catch (Throwable throwable) {
            System.exit(1);
        }
    }

    private static WrapperResponse processDaemonRequest(String requestLine) {
        long requestId = -1L;
        String requestType = REQUEST_TYPE_INFER_TYPES;

        RequestHandler handler = DAEMON_HANDLERS.get(requestType);
        if (handler == null) {
            return new WrapperResponse(requestId, requestType, null,
                    "Unsupported requestType '" + requestType + "'.");
        }

        try {
            Request request = OBJECT_MAPPER.readValue(requestLine, Request.class);
            requestId = request.id();
            requestType = request.requestType();

            return new WrapperResponse(requestId, requestType,
                    handler.handle(new Request(requestId, requestType, request.body())), null);
        } catch (Throwable throwable) {
            String errorMessage = Objects.toString(throwable.getMessage(), throwable.getClass().getName());
            return new WrapperResponse(requestId, requestType, handler.createEmptyResponse(), errorMessage);
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

    private static void writeAndExit(WrapperResponse response, int exitCode) {
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
