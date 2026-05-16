package org.jsoniq.lsp.wrapper.handlers;

import java.lang.reflect.Field;
import java.util.List;

import org.jsoniq.lsp.wrapper.messages.Request;
import org.jsoniq.lsp.wrapper.messages.ResponseBody;
import org.rumbledb.types.BuiltinTypesCatalogue;
import org.rumbledb.types.ItemType;

public class BuiltinTypes implements RequestHandler {
    public record Result(List<String> builtinTypes) implements ResponseBody {
    }

    public static final Result EMPTY_RESPONSE_BODY = new Result(List.of());

    public List<String> listBuiltinTypes() {
        return readCatalogue()
                .stream()
                .map(ItemType::toString)
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static List<ItemType> readCatalogue() {
        try {
            Field builtinsField = BuiltinTypesCatalogue.class.getDeclaredField("builtInItemTypes");
            builtinsField.setAccessible(true);
            Object value = builtinsField.get(null);
            if (!(value instanceof List<?> list)) {
                throw new IllegalStateException("Builtin types catalogue has an unexpected data type.");
            }
            return (List<ItemType>) list;
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException("Unable to read builtin types catalogue.", exception);
        }
    }

    @Override
    public String getRequestType() {
        return "builtinTypes";
    }

    @Override
    public ResponseBody handle(Request request) {
        return new Result(listBuiltinTypes());
    }

    @Override
    public ResponseBody createEmptyResponse() {
        return EMPTY_RESPONSE_BODY;
    }
}
