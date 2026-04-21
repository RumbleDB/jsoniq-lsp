import { describe, expect, it } from "vitest";

import { collectTypeDiagnostics } from "../src/server/type-diagnostics.js";
import { testDocument } from "./test-utils.js";

describe("JSONiq type diagnostics", () => {
    it("reports wrapper type errors as diagnostics", async () => {
        const document = testDocument("type-error", [
            "declare function local:f($a, $b as xs:integer) as integer {",
            "    \"a\"",
            "};",
            "local:f(1, 2)",
        ]);

        const diagnostics = await collectTypeDiagnostics(document);
        expect(diagnostics.length).toBeGreaterThan(0);
        const mismatchDiagnostic = diagnostics.find((diagnostic) => String(diagnostic.code).startsWith("XPTY"));
        expect(mismatchDiagnostic).toBeDefined();
        expect(mismatchDiagnostic?.range.start.line).toBe(0);
        expect(mismatchDiagnostic?.range.end.line).toBe(1);
        expect(mismatchDiagnostic?.range.end.character).toBe(0);
    }, 60_000);

    it("uses wrapper start position for variable declaration type mismatch", async () => {
        const document = testDocument("type-error-let-annotation", [
            "let $a as integer := \"test\"",
            "return $a",
        ]);

        const diagnostics = await collectTypeDiagnostics(document);
        const mismatchDiagnostic = diagnostics.find((diagnostic) => String(diagnostic.code).startsWith("XPTY"));

        expect(mismatchDiagnostic).toBeDefined();
        expect(mismatchDiagnostic?.range.start.line).toBe(0);
        expect(mismatchDiagnostic?.range.start.character).toBe(4);
        expect(mismatchDiagnostic?.range.end.line).toBe(1);
        expect(mismatchDiagnostic?.range.end.character).toBe(0);
    }, 60_000);

    it("uses line-spanning fallback range for operation type mismatch", async () => {
        const document = testDocument("type-error-additive-op", [
            "declare function local:f() {",
            "    \"test\"",
            "};",
            "",
            "local:f() + 1",
        ]);

        const diagnostics = await collectTypeDiagnostics(document);
        const mismatchDiagnostic = diagnostics.find((diagnostic) => String(diagnostic.code).startsWith("XPTY"));

        expect(mismatchDiagnostic).toBeDefined();
        expect(mismatchDiagnostic?.range.start.line).toBe(4);
        expect(mismatchDiagnostic?.range.start.character).toBe(0);
        expect(mismatchDiagnostic?.range.end.line).toBe(5);
        expect(mismatchDiagnostic?.range.end.character).toBe(0);
    }, 60_000);

    it("uses line-spanning fallback range for incompatible comparable types", async () => {
        const document = testDocument("type-error-compare-op", [
            "declare variable $dt := \"2015-05-03T13:20:00\" cast as dateTime;",
            "declare variable $time := \"13:20:00\" cast as time;",
            "$dt eq $time",
        ]);

        const diagnostics = await collectTypeDiagnostics(document);
        const mismatchDiagnostic = diagnostics.find((diagnostic) => String(diagnostic.code).startsWith("XPTY"));

        expect(mismatchDiagnostic).toBeDefined();
        expect(mismatchDiagnostic?.range.start.line).toBe(2);
        expect(mismatchDiagnostic?.range.start.character).toBe(0);
        expect(mismatchDiagnostic?.range.end.line).toBe(3);
        expect(mismatchDiagnostic?.range.end.character).toBe(0);
    }, 60_000);
});
