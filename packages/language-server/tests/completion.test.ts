import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";

import { findVariableCompletions } from "../src/server/completion.js";
import { positionAtNth } from "./test-utils.js";

describe("JSONiq completion", () => {
    it("returns in-scope variables at cursor position", () => {
        const source = [
            "declare variable $global := 10;",
            "declare function local:f($x) {",
            "  let $y := $x + 1",
            "  return $y + $x + $global",
            "};",
        ].join("\n");
        const document = TextDocument.create("file:///completion-scope.jq", "jsoniq", 1, source);

        const items = findVariableCompletions(document, positionAtNth(document, "$y", 1));
        const labels = items.map((item) => item.label);

        expect(labels).toEqual([
            "$global",
            "$x",
            "$y",
        ]);
    });

    it("keeps only nearest declaration for shadowed names", () => {
        const source = [
            "declare variable $x := 1;",
            "declare function local:f($x) {",
            "  return $x",
            "};",
        ].join("\n");
        const document = TextDocument.create("file:///completion-shadow.jq", "jsoniq", 1, source);

        const items = findVariableCompletions(document, positionAtNth(document, "$x", 2));
        const xItems = items.filter((item) => item.label === "$x");

        expect(xItems).toHaveLength(1);
    });

    it("returns empty completion list outside variable scopes", () => {
        const source = "1 + 2";
        const document = TextDocument.create("file:///completion-empty.jq", "jsoniq", 1, source);

        const items = findVariableCompletions(document, { line: 0, character: 1 });

        expect(items).toEqual([]);
    });

    it("does not leak function-local symbols outside function scope", () => {
        const source = [
            "declare variable $global := 1;",
            "declare function local:f($x) {",
            "  let $y := $x + 1",
            "  return $y",
            "};",
            "$global + 1",
        ].join("\n");
        const document = TextDocument.create("file:///completion-function-scope.jq", "jsoniq", 1, source);

        const items = findVariableCompletions(document, positionAtNth(document, "$global", 1));
        const labels = items.map((item) => item.label);

        expect(labels).toEqual(["$global"]);
    });

    it("includes FLWOR clause variables in return completion", () => {
        const source = [
            "declare function local:f($a, $b as integer) {",
            "    for $x at $pos in (1, 2, 3)",
            "    let $y := $x + $a",
            "    group by $g := $y mod 2",
            "    count $c",
            "    return $g + $c + $b",
            "};",
        ].join("\n");
        const document = TextDocument.create("file:///completion-flwor-return.jq", "jsoniq", 1, source);

        const items = findVariableCompletions(document, positionAtNth(document, "$g", 1));
        const labels = items.map((item) => item.label);

        expect(labels).toEqual([
            "$a",
            "$b",
            "$c",
            "$g",
            "$pos",
            "$x",
            "$y",
        ]);
    });

    it("includes FLWOR clause variables in return completion while document is incomplete", () => {
        const source = [
            "declare function local:f($a, $b as integer) {",
            "    for $x at $pos in (1, 2, 3)",
            "    let $y := $x + $a",
            "    group by $g := $y mod 2",
            "    count $c",
            "    return $g + $c + $b",
        ].join("\n");
        const document = TextDocument.create("file:///completion-flwor-return-incomplete.jq", "jsoniq", 1, source);

        const items = findVariableCompletions(document, positionAtNth(document, "$g", 1));
        const labels = items.map((item) => item.label);

        expect(labels).toEqual([
            "$a",
            "$b",
            "$c",
            "$g",
            "$pos",
            "$x",
            "$y",
        ]);
    });
    it("includes for and at-position variables while typing top-level return variable", () => {
        const source = [
            "for $x at $pos in (1, 2, 3)",
            "return $",
        ].join("\n");
        const document = TextDocument.create("file:///completion-top-level-flwor-incomplete.jq", "jsoniq", 1, source);

        const items = findVariableCompletions(document, positionAtNth(document, "$", 2));
        const labels = items.map((item) => item.label);

        expect(labels).toEqual([
            "$pos",
            "$x",
        ]);
    });

    it("keeps FLWOR variables visible at scope-end boundary position", () => {
        const source = [
            "for $x at $pos in (1, 2, 3)",
            "return $x",
        ].join("\n");
        const document = TextDocument.create("file:///completion-top-level-flwor-boundary.jq", "jsoniq", 1, source);

        // Cursor right after "$x" in the return clause, which can coincide with the scope-end position.
        const items = findVariableCompletions(document, {
            line: 1,
            character: "return $x".length,
        });
        const labels = items.map((item) => item.label);

        expect(labels).toEqual([
            "$pos",
            "$x",
        ]);
    });

    it("does not include let-bound variable inside its own initializer", () => {
        const source = [
            "let $a := $a",
            "return $a",
        ].join("\n");
        const document = TextDocument.create("file:///completion-let-self-init.jq", "jsoniq", 1, source);

        const initializerItems = findVariableCompletions(document, positionAtNth(document, "$a", 1));

        expect(initializerItems.map((item) => item.label)).toEqual([]);
    });
});
