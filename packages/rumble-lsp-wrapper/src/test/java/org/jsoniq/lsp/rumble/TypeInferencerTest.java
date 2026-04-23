package org.jsoniq.lsp.rumble;

import org.jsoniq.lsp.rumble.handlers.TypeInferencer;
import org.jsoniq.lsp.rumble.handlers.TypeInferencer.VariableKind;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TypeInferencerTest {

    private final TypeInferencer inferencer = new TypeInferencer();

    private TypeInferencer.Result inferWithoutThrow(String query) {
        return assertDoesNotThrow(() -> this.inferencer.infer(query));
    }

    @Test
    void inferEmptyQueryReturnsNoErrorAndNoTypes() {
        TypeInferencer.Result result = inferWithoutThrow("");

        assertTrue(result.variableTypes().isEmpty());
        assertTrue(result.functionTypes().isEmpty());
        assertTrue(result.typeErrors().isEmpty());
    }

    @Test
    void inferSimpleLetCollectsVariableType() {
        String query = "let $x := 1 return $x";

        TypeInferencer.Result result = inferWithoutThrow(query);
        assertTrue(result.typeErrors().isEmpty());

        Optional<TypeInferencer.VariableType> letVariableType = result.variableTypes()
                .stream()
                .filter(type -> VariableKind.Let.equals(type.kind()))
                .filter(type -> "$x".equals(type.name()))
                .findFirst();

        assertTrue(letVariableType.isPresent());
        assertEquals("xs:integer", letVariableType.get().type());
    }

    @Test
    void inferDeclareVariableCollectsDeclaredVariableType() {
        String query = """
                declare variable $a := (1, 2);
                $a
                """;

        TypeInferencer.Result result = inferWithoutThrow(query);

        Optional<TypeInferencer.VariableType> declaredVariableType = result.variableTypes()
                .stream()
                .filter(type -> VariableKind.Declare.equals(type.kind()))
                .filter(type -> "$a".equals(type.name()))
                .findFirst();

        assertTrue(declaredVariableType.isPresent());
        assertTrue(declaredVariableType.get().type().contains("xs:integer"));
    }

    @Test
    void inferFunctionDeclarationCollectsFunctionTypeAndParameters() {
        String query = "declare function local:f($a as integer, $b) { $a + 1 };";

        TypeInferencer.Result result = inferWithoutThrow(query);
        assertFalse(result.functionTypes().isEmpty());
        assertTrue(result.typeErrors().isEmpty());

        Optional<TypeInferencer.FunctionType> functionType = result.functionTypes()
                .stream()
                .filter(type -> "local:f".equals(type.name()))
                .findFirst();

        assertTrue(functionType.isPresent());
        assertEquals("xs:integer", functionType.get().parameterTypes().get(0).type());
        assertEquals("item*", functionType.get().parameterTypes().get(1).type());
        assertEquals("item*", functionType.get().returnType());
    }

    @Test
    void inferInvalidQueryReturnsError() {
        assertThrows(Throwable.class, () -> this.inferencer.infer("let $x := return"));
    }

    @Test
    void inferLetShadowingCollectsBothVariableTypes() {
        String query = """
                let $x := 1
                return (
                  let $x := "shadow"
                  return $x
                )
                """;

        TypeInferencer.Result result = inferWithoutThrow(query);
        assertTrue(result.typeErrors().isEmpty());

        Set<String> xTypes = result.variableTypes()
                .stream()
                .filter(type -> VariableKind.Let.equals(type.kind()))
                .filter(type -> "$x".equals(type.name()))
                .map(TypeInferencer.VariableType::type)
                .collect(Collectors.toSet());

        assertTrue(xTypes.contains("xs:integer"));
        assertTrue(xTypes.contains("xs:string"));
    }

    @Test
    void inferFunctionReturnTypeMismatchReturnsRawMetadataRange() {
        String query = """
                declare function local:f() as integer {
                    "$g + $c"
                };
                local:f()
                """;

        TypeInferencer.Result result = inferWithoutThrow(query);
        assertFalse(result.typeErrors().isEmpty());
        assertFalse(result.functionTypes().isEmpty());

        TypeInferencer.TypeError error = result.typeErrors().get(0);
        assertEquals("XPTY0004", error.code());
        assertEquals(0, error.position().line());
        assertEquals(0, error.position().character());
    }

    @Test
    void inferAdditiveArityErrorReturnsRawMetadataRange() {
        String query = """
                declare function local:f($a, $b as integer) {
                    $a + $b
                };
                local:f((1, 2), 3)
                """;

        TypeInferencer.Result result = inferWithoutThrow(query);
        assertFalse(result.typeErrors().isEmpty());

        TypeInferencer.TypeError error = result.typeErrors().get(0);
        assertEquals("XPTY0004", error.code());
        assertTrue(error.message().contains("arities are not allowed for additive expressions"));
        assertEquals(1, error.position().line());
        assertEquals(4, error.position().character());
    }

}
