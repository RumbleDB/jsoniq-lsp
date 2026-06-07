package org.jsoniq.lsp.wrapper.handlers;

import org.jsoniq.lsp.wrapper.messages.Request;
import org.jsoniq.lsp.wrapper.messages.ResponseBody;
import org.jsoniq.lsp.wrapper.types.FunctionDefinition;
import org.jsoniq.lsp.wrapper.types.ResolvedQName;
import org.rumbledb.context.BuiltinFunction;
import org.rumbledb.context.BuiltinFunctionCatalogue;
import org.rumbledb.context.FunctionIdentifier;
import org.rumbledb.context.Name;
import org.rumbledb.types.FunctionSignature;
import org.rumbledb.types.SequenceType;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;

public class BuiltinFunctions implements RequestHandler {
    public record Result(
            List<FunctionDefinition> builtinFunctions) implements ResponseBody {
    }

    public static final Result EMPTY_RESPONSE_BODY = new Result(List.of());

    public List<FunctionDefinition> listBuiltinFunctions() {
        Map<FunctionIdentifier, BuiltinFunction> functions = readCatalogue();
        return functions.values()
                .stream()
                .map(BuiltinFunctions::toDefinition)
                .toList();
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

    private static FunctionDefinition.Signature toSignature(BuiltinFunction function) {
        FunctionSignature signature = function.getSignature();

        List<String> parameterTypes = signature
                .getParameterTypes()
                .stream()
                .map(SequenceType::toString)
                .toList();

        String returnType = signature.getReturnType() == null ? "item*" : signature.getReturnType().toString();

        return new FunctionDefinition.Signature(
                parameterTypes,
                returnType);
    }

    private static FunctionDefinition toDefinition(BuiltinFunction function) {
        FunctionIdentifier identifier = function.getIdentifier();
        return new FunctionDefinition(
                toFunctionName(identifier),
                toSignature(function));
    }

    private static FunctionDefinition.Name toFunctionName(FunctionIdentifier identifier) {
        return new FunctionDefinition.Name(
                toResolvedQName(identifier.getName()),
                identifier.getArity());
    }

    private static ResolvedQName toResolvedQName(Name name) {
        return new ResolvedQName(
                name.getLocalName(),
                blankToNull(name.getNamespace()),
                blankToNull(name.getPrefix()));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    @Override
    public ResponseBody handle(Request request) {
        return new Result(listBuiltinFunctions());
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
