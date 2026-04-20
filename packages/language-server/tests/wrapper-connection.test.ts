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
        expect(response.responseType).toBe("inferTypes");
        expect("builtinFunctions" in response.body).toBe(false);
        expect(response.body.typeErrors).toEqual([]);

        const letType = response.body.variableTypes.find(
            (type) => type.kind === "let" && type.name === "x",
        );
        expect(letType?.type).toBe("xs:integer");
        const parameterType = response.body.variableTypes.find(
            (type) => type.kind === "parameter" && type.name === "a",
        );
        expect(parameterType?.type).toBe("xs:integer");

        const functionType = response.body.functionTypes.find((type) => type.name === "local:f");
        expect(functionType).toBeDefined();
        expect(functionType?.parameterTypes["$a"]).toBe("xs:integer");
        expect(functionType?.parameterTypes["$b"]).toBe("item*");
        expect(functionType?.returnType).toBe("item*");
    }, 60_000);

    it("returns declared variable types from prolog declarations", async () => {
        connection = new RumbleWrapperConnection();

        const query = [
            "declare variable $a := (1, 2);",
            "$a",
        ].join("\n");

        const response = await connection.inferTypes(query);

        console.log("Received response:", JSON.stringify(response, null, 2));

        expect(response.error).toBeNull();
        const declaredVariable = response.body.variableTypes.find(
            (type) => type.kind === "declare-variable" && type.name === "a",
        );

        expect(declaredVariable).toBeDefined();
        expect(declaredVariable!.type.includes("xs:integer")).toBe(true);
    }, 60_000);

    it("returns parse error for invalid query", async () => {
        connection = new RumbleWrapperConnection();

        const response = await connection.inferTypes("let $x := return");
        expect(response.responseType).toBe("inferTypes");
        expect(response.body.variableTypes).toEqual([]);
        expect(response.body.functionTypes).toEqual([]);
        expect(response.error).not.toBeNull();
    }, 60_000);

    it("returns builtin function signatures", async () => {
        connection = new RumbleWrapperConnection();

        const response = await connection.listBuiltinFunctions();

        expect(response.responseType).toBe("builtinFunctions");
        expect(response.error).toBeNull();
        expect("variableTypes" in response.body).toBe(false);
        expect("functionTypes" in response.body).toBe(false);
        const entries = Object.entries(response.body.builtinFunctions);
        expect(entries.length).toBeGreaterThan(0);

        const count = response.body.builtinFunctions["fn:count#1"] ?? response.body.builtinFunctions["count#1"];

        expect(count).toBeDefined();
        expect(count.parameterTypes).toHaveLength(1);
    }, 60_000);
});
