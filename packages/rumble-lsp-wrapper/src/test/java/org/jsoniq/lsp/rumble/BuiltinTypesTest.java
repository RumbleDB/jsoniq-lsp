package org.jsoniq.lsp.rumble;

import org.jsoniq.lsp.rumble.handlers.BuiltinTypes;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

class BuiltinTypesTest {

    private final BuiltinTypes builtinTypes = new BuiltinTypes();

    @Test
    void listBuiltinTypesContainsCoreJsoniqAndXmlSchemaTypes() {
        List<String> types = this.builtinTypes.listBuiltinTypes();

        assertTrue(types.contains("item"));
        assertTrue(types.contains("js:object"));
        assertTrue(types.contains("js:array"));
        assertTrue(types.contains("js:null"));
        assertTrue(types.contains("xs:string"));
        assertTrue(types.contains("xs:integer"));
        assertTrue(types.contains("xs:boolean"));
    }
}
