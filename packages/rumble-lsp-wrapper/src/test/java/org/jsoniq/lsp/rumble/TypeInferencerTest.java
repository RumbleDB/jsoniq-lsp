package org.jsoniq.lsp.rumble;

import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TypeInferencerTest {

    private final TypeInferencer inferencer = new TypeInferencer();

    @Test
    void inferEmptyQueryReturnsNoErrorAndNoTypes() {
        TypeInferencer.InferenceResult result = this.inferencer.infer("");

        assertNull(result.error());
        assertTrue(result.variableTypes().isEmpty());
        assertTrue(result.functionTypes().isEmpty());
        assertTrue(result.typeErrors().isEmpty());
    }

    @Test
    void inferSimpleLetCollectsVariableType() {
        String query = "let $x := 1 return $x";

        TypeInferencer.InferenceResult result = this.inferencer.infer(query);

        assertNull(result.error());
        assertTrue(result.typeErrors().isEmpty());

        Optional<TypeInferencer.VariableType> letVariableType = result.variableTypes()
                .stream()
                .filter(type -> "LetVariableDeclaration".equals(type.nodeKind()))
                .filter(type -> "x".equals(type.name()))
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

        TypeInferencer.InferenceResult result = this.inferencer.infer(query);

        assertNull(result.error());

        Optional<TypeInferencer.VariableType> declaredVariableType = result.variableTypes()
                .stream()
                .filter(type -> "DeclareVariableDeclaration".equals(type.nodeKind()))
                .filter(type -> "a".equals(type.name()))
                .findFirst();

        assertTrue(declaredVariableType.isPresent());
        assertTrue(declaredVariableType.get().type().contains("xs:integer"));
    }

    @Test
    void inferFunctionDeclarationCollectsFunctionTypeAndParameters() {
        String query = "declare function local:f($a as integer, $b) { $a + 1 };";

        TypeInferencer.InferenceResult result = this.inferencer.infer(query);

        assertNull(result.error());
        assertFalse(result.functionTypes().isEmpty());
        assertTrue(result.typeErrors().isEmpty());

        Optional<TypeInferencer.FunctionType> functionType = result.functionTypes()
                .stream()
                .filter(type -> "local:f".equals(type.name()))
                .findFirst();

        assertTrue(functionType.isPresent());
        assertEquals("xs:integer", functionType.get().parameterTypes().get("$a"));
        assertEquals("item*", functionType.get().parameterTypes().get("$b"));
        assertEquals("item*", functionType.get().returnType());

        Optional<TypeInferencer.VariableType> parameterAType = result.variableTypes()
                .stream()
                .filter(type -> "FunctionParameterDeclaration".equals(type.nodeKind()))
                .filter(type -> "a".equals(type.name()))
                .findFirst();
        Optional<TypeInferencer.VariableType> parameterBType = result.variableTypes()
                .stream()
                .filter(type -> "FunctionParameterDeclaration".equals(type.nodeKind()))
                .filter(type -> "b".equals(type.name()))
                .findFirst();

        assertTrue(parameterAType.isPresent());
        assertTrue(parameterBType.isPresent());
        assertEquals("xs:integer", parameterAType.get().type());
        assertEquals("item*", parameterBType.get().type());
    }

    @Test
    void inferInvalidQueryReturnsError() {
        TypeInferencer.InferenceResult result = this.inferencer.infer("let $x := return");

        assertNotNull(result.error());
        assertTrue(result.variableTypes().isEmpty());
        assertTrue(result.functionTypes().isEmpty());
        assertTrue(result.typeErrors().isEmpty());      /// The parser error is not reported as a type error, but as a general error message in the result.error() field.
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

        TypeInferencer.InferenceResult result = this.inferencer.infer(query);

        assertNull(result.error());
        assertTrue(result.typeErrors().isEmpty());

        Set<String> xTypes = result.variableTypes()
                .stream()
                .filter(type -> "LetVariableDeclaration".equals(type.nodeKind()))
                .filter(type -> "x".equals(type.name()))
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

        TypeInferencer.InferenceResult result = this.inferencer.infer(query);

        assertNotNull(result.error());
        assertFalse(result.typeErrors().isEmpty());
        assertFalse(result.functionTypes().isEmpty());

        TypeInferencer.TypeError error = result.typeErrors().get(0);
        assertEquals("XPTY0004", error.code());
        assertEquals(1, error.range().start().line());
        assertEquals(0, error.range().start().character());
        assertEquals(1, error.range().end().line());
        assertEquals(1, error.range().end().character());
    }

    @Test
    void inferAdditiveArityErrorReturnsRawMetadataRange() {
        String query = """
                declare function local:f($a, $b as integer) {
                    $a + $b
                };
                local:f((1, 2), 3)
                """;

        TypeInferencer.InferenceResult result = this.inferencer.infer(query);

        assertNotNull(result.error());
        assertFalse(result.typeErrors().isEmpty());

        TypeInferencer.TypeError error = result.typeErrors().get(0);
        assertEquals("XPTY0004", error.code());
        assertTrue(error.message().contains("arities are not allowed for additive expressions"));
        assertEquals(2, error.range().start().line());
        assertEquals(4, error.range().start().character());
        assertEquals(2, error.range().end().line());
        assertEquals(5, error.range().end().character());
    }

}
