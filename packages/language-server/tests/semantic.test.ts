import { describe, expect, it } from "vitest";

import { collectSemanticDiagnostics } from "server/semantic.js";
import { testDocument } from "./test-utils.js";

describe("JSONiq semantic diagnostics", () => {
    it("reports unresolved variable references", async () => {
        const document = testDocument("semantic-unresolved", [
            "declare function local:f($x) {",
            "  $x + $missing",
            "};",
        ]);

        const diagnostics = await collectSemanticDiagnostics(document);

        expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
            "Unresolved variable reference '$missing'.",
        ]);
    });

    it("allows duplicate declarations", async () => {
        const document = testDocument("semantic-duplicate", [
            "declare variable $x := 1;",
            "declare variable $x := 2;",
            "$x",
        ]);

        const diagnostics = await collectSemanticDiagnostics(document);

        expect(diagnostics).toEqual([]);
    });
});
