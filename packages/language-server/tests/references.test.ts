import { describe, expect, it } from "vitest";
import { type Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { findReferenceLocations } from "../src/server/references.js";

describe("JSONiq references", () => {
    it("finds references for a local variable without crossing shadowed scopes", () => {
        const source = [
            "declare variable $x := 10;",
            "declare function local:f($x) {",
            "  let $y := $x + 1",
            "  return $y + $x",
            "};",
            "local:f($x)",
        ].join("\n");
        const document = TextDocument.create("file:///references-shadowing.jq", "jsoniq", 1, source);

        const locations = findReferenceLocations(document, positionAtNth(document, "$x", 2), false);

        expect(locations.map((location) => location.range.start.line)).toEqual([
            2,
            3,
        ]);
    });

    it("includes declaration when requested", () => {
        const source = [
            "for $x at $pos in (1, 2, 3)",
            "let $y := $x + 1",
            "return $x + $y",
        ].join("\n");
        const document = TextDocument.create("file:///references-include-decl.jq", "jsoniq", 1, source);

        const withoutDeclaration = findReferenceLocations(document, positionAtNth(document, "$x", 2), false);
        const withDeclaration = findReferenceLocations(document, positionAtNth(document, "$x", 2), true);

        expect(withoutDeclaration.map((location) => location.range.start.line)).toEqual([
            1,
            2,
        ]);
        expect(withDeclaration.map((location) => location.range.start.line)).toEqual([
            0,
            1,
            2,
        ]);
    });

    it("returns empty result outside variable identifiers", () => {
        const source = "declare function local:f($x) { $x };";
        const document = TextDocument.create("file:///references-miss.jq", "jsoniq", 1, source);

        const locations = findReferenceLocations(document, positionAt(document, "local:f"), true);

        expect(locations).toEqual([]);
    });
});

function positionAt(document: TextDocument, needle: string): Position {
    const offset = document.getText().indexOf(needle);
    if (offset < 0) {
        throw new Error(`Could not find '${needle}' in document.`);
    }
    return document.positionAt(offset);
}

function positionAtNth(document: TextDocument, needle: string, occurrence: number): Position {
    const source = document.getText();
    let offset = -1;
    let fromIndex = 0;

    for (let index = 0; index <= occurrence; index += 1) {
        offset = source.indexOf(needle, fromIndex);
        if (offset < 0) {
            throw new Error(`Could not find occurrence #${occurrence} for '${needle}'.`);
        }
        fromIndex = offset + needle.length;
    }

    return document.positionAt(offset);
}
