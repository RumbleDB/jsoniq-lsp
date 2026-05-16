package org.jsoniq.lsp.wrapper;

import org.jsoniq.lsp.wrapper.handlers.BuiltinFunctions;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BuiltinFunctionsTest {

    private final BuiltinFunctions builtinFunctions = new BuiltinFunctions();

    @Test
    void listBuiltinFunctionsReturnsNonEmptyResult() {
        assertFalse(this.builtinFunctions.byNameWithArity().isEmpty());
    }

    @Test
    void listBuiltinFunctionsContainsCountArityOneSignature() {
        Optional<BuiltinFunctions.Signature> count = Optional
                .ofNullable(this.builtinFunctions.byNameWithArity().get("fn:count#1"));

        assertTrue(count.isPresent());
        assertTrue("xs:integer".equals(count.get().returnType()));
        assertFalse(count.get().parameterTypes().isEmpty());
    }
}
