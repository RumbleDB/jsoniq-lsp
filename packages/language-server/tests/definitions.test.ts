import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";

import { findDefinitionLocation } from "../src/server/definitions.js";

describe("JSONiq go-to-definition", () => {
    it("resolves variable reference to the nearest declaration", () => {
        const document = TextDocument.create(
            "file:///definitions-shadowing.jq",
            "jsoniq",
            1,
            [
                "declare variable $x := 10;",
                "declare function local:f($x) {",
                "  let $y := $x + 1",
                "  return $y + $x",
                "};",
                "local:f($x)",
            ].join("\n"),
        );

        const localReference = findDefinitionLocation(document, { line: 3, character: 15 });
        const globalReference = findDefinitionLocation(document, { line: 5, character: 9 });

        expect(localReference?.range.start.line).toBe(1);
        expect(globalReference?.range.start.line).toBe(0);
    });

    it("returns declaration location when cursor is already on declaration", () => {
        const firstLine = "declare function local:f($x) {";
        const document = TextDocument.create(
            "file:///definitions-on-declaration.jq",
            "jsoniq",
            1,
            [
                firstLine,
                "  return $x",
                "};",
            ].join("\n"),
        );

        const declarationCharacter = firstLine.indexOf("$x") + 1;
        const location = findDefinitionLocation(document, { line: 0, character: declarationCharacter });

        expect(location).toBeDefined();
        expect(location?.range.start.line).toBe(0);
    });

    it("resolves definition when cursor is on the dollar sign of a parameter", () => {
        const firstLine = "declare function local:f($x) {";
        const document = TextDocument.create(
            "file:///definitions-parameter-dollar.jq",
            "jsoniq",
            1,
            [
                firstLine,
                "  return $x",
                "};",
            ].join("\n"),
        );

        const location = findDefinitionLocation(document, { line: 0, character: firstLine.indexOf("$x") });

        expect(location).toBeDefined();
        expect(location?.range.start.line).toBe(0);
    });

    it("returns null when position is not on a resolvable variable", () => {
        const document = TextDocument.create(
            "file:///definitions-null.jq",
            "jsoniq",
            1,
            "1 + 2",
        );

        const location = findDefinitionLocation(document, { line: 0, character: 0 });

        expect(location).toBeNull();
    });
});
