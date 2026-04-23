package org.jsoniq.lsp.rumble.handlers;

import org.jsoniq.lsp.rumble.messages.Request;
import org.jsoniq.lsp.rumble.messages.ResponseBody;
import org.rumbledb.context.BuiltinFunction;
import org.rumbledb.context.BuiltinFunctionCatalogue;
import org.rumbledb.context.FunctionIdentifier;
import org.rumbledb.types.FunctionSignature;
import org.rumbledb.types.SequenceType;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

public class BuiltinFunctions implements RequestHandler{
    public record Signature(
            List<String> parameterTypes,
            String returnType) {
    }

    public record Result(
            Map<String, Signature> builtinFunctions) implements ResponseBody {
    }

    public static final Result EMPTY_RESPONSE_BODY = new Result(Map.of());

    public Map<String, Signature> byNameWithArity() {
        Map<FunctionIdentifier, BuiltinFunction> functions = readCatalogue();
        Map<String, Signature> signatures = new TreeMap<>();

        for (Map.Entry<FunctionIdentifier, BuiltinFunction> entry : functions.entrySet()) {
            BuiltinFunction function = entry.getValue();
            String key = function.getIdentifier().toString();
            signatures.put(key, toSignature(function));
        }
        return signatures;
    }

    @SuppressWarnings("unchecked")
    private static Map<FunctionIdentifier, BuiltinFunction> readCatalogue() {
        try {
            Field builtinsField = BuiltinFunctionCatalogue.class.getDeclaredField("builtinFunctions");
            builtinsField.setAccessible(true);
            Object value = builtinsField.get(null);
            if (!(value instanceof Map<?, ?> map)) {
                throw new IllegalStateException("Builtin function catalogue has an unexpected data type.");
            }
            return (Map<FunctionIdentifier, BuiltinFunction>) map;
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException("Unable to read builtin function catalogue.", exception);
        }
    }

    private static Signature toSignature(BuiltinFunction function) {
        FunctionSignature signature = function.getSignature();

        List<String> parameterTypes = signature
                .getParameterTypes()
                .stream()
                .map(SequenceType::toString)
                .toList();

        String returnType = signature.getReturnType() == null ? "item*" : signature.getReturnType().toString();

        return new Signature(
                parameterTypes,
                returnType);
    }

    @Override
    public ResponseBody handle(Request request) {
        return new Result(byNameWithArity());
    }

    @Override
    public ResponseBody createEmptyResponse() {
        return EMPTY_RESPONSE_BODY;
    }

    @Override
    public String getRequestType() {
        return "builtinFunctions";
    }
}
