package org.jsoniq.lsp.rumble;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Objects;

public class RumbleTypeInferencerMain {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final RumbleTypeInferencer INFERENCER = new RumbleTypeInferencer();

    private record WrapperResponse(
            List<RumbleTypeInferencer.VariableType> variableTypes,
            List<RumbleTypeInferencer.FunctionType> functionTypes,
            String error) {
    }

    private record WrapperRequest(long id, String queryBase64) {
    }

    private record WrapperDaemonResponse(
            long id,
            List<RumbleTypeInferencer.VariableType> variableTypes,
            List<RumbleTypeInferencer.FunctionType> functionTypes,
            String error) {
    }

    public static void main(String[] args) {
        if (isDaemonMode(args)) {
            runDaemon();
            return;
        }

        try {
            String query = readAllStdin();
            RumbleTypeInferencer.InferenceResult result = INFERENCER.infer(query);
            writeAndExit(new WrapperResponse(result.variableTypes(), result.functionTypes(), result.error()), 0);
        } catch (Throwable throwable) {
            String errorMessage = Objects.toString(throwable.getMessage(), throwable.getClass().getName());
            writeAndExit(new WrapperResponse(List.of(), List.of(), errorMessage), 1);
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
                WrapperDaemonResponse response = processDaemonRequest(line);
                writer.println(OBJECT_MAPPER.writeValueAsString(response));
                writer.flush();
            }
            System.exit(0);
        } catch (Throwable throwable) {
            System.exit(1);
        }
    }

    private static WrapperDaemonResponse processDaemonRequest(String requestLine) {
        long requestId = -1L;
        try {
            WrapperRequest request = OBJECT_MAPPER.readValue(requestLine, WrapperRequest.class);
            requestId = request.id();
            if (request.queryBase64() == null) {
                return new WrapperDaemonResponse(requestId, List.of(), List.of(), "Missing queryBase64 field.");
            }
            byte[] decodedBytes = Base64.getDecoder().decode(request.queryBase64());
            String query = new String(decodedBytes, StandardCharsets.UTF_8);
            RumbleTypeInferencer.InferenceResult result = INFERENCER.infer(query);
            return new WrapperDaemonResponse(requestId, result.variableTypes(), result.functionTypes(), result.error());
        } catch (Throwable throwable) {
            String errorMessage = Objects.toString(throwable.getMessage(), throwable.getClass().getName());
            return new WrapperDaemonResponse(requestId, List.of(), List.of(), errorMessage);
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
                            "{\"variableTypes\":[],\"functionTypes\":[],\"error\":\"Failed to serialize wrapper response.\"}");
        }
        System.exit(exitCode);
    }
}
