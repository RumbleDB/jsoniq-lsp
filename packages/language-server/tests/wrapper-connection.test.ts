import { afterEach, describe, expect, it } from "vitest";

import { RumbleWrapperConnection } from "../src/server/wrapper-connection.js";

let connection: RumbleWrapperConnection;

describe("RumbleWrapperConnection (integration)", () => {
    afterEach(() => {
        if (connection !== undefined) {
            connection.dispose();
        }
    });

    it("connects to Java wrapper and returns inferred variable and function types", async () => {
        connection = new RumbleWrapperConnection();

        const query = [
            "declare function local:f($a as integer, $b) {",
            "  let $x := $a + 1",
            "  return $x",
            "};",
        ].join("\n");

        const response = await connection.inferTypes(query);

        expect(response.error).toBeNull();

        const letType = response.variableTypes.find(
            (type) => type.nodeKind === "LetVariableDeclaration" && type.name === "x",
        );
        expect(letType?.type).toBe("xs:integer");

        const functionType = response.functionTypes.find((type) => type.name === "local:f");
        expect(functionType).toBeDefined();
        expect(functionType?.parameterTypes["$a"]).toBe("xs:integer");
        expect(functionType?.parameterTypes["$b"]).toBe("item*");
        expect(functionType?.returnType).toBe("item*");
    }, 60_000);

    it("returns parse error for invalid query", async () => {
        connection = new RumbleWrapperConnection();

        const response = await connection.inferTypes("let $x := return");

        expect(response.error).toBeTypeOf("string");
        expect(response.variableTypes).toEqual([]);
        expect(response.functionTypes).toEqual([]);
    }, 60_000);
});
