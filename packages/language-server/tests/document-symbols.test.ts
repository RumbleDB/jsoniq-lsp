import { describe, expect, it } from "vitest";
import { DocumentSymbol, SymbolKind } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { collectDocumentSymbols } from "../src/server/symbols.js";

describe("JSONiq document symbols", () => {
    it("collects top-level declarations", () => {
        const document = TextDocument.create(
            "file:///symbols.jq",
            "jsoniq",
            1,
            [
                "declare namespace app = \"https://example.com/app\";",
                "declare variable $app:value := 1;",
                "declare context item := { \"kind\": \"context\" };",
                "declare type app:Item as object-node();",
                "declare function app:double($x) {",
                "  $x * 2",
                "};",
                "app:double($app:value)",
            ].join("\n"),
        );

        const symbols = flattenSymbols(collectDocumentSymbols(document));

        expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual(
            expect.arrayContaining([
                ["app", SymbolKind.Namespace],
                ["$app:value", SymbolKind.Variable],
                ["context item", SymbolKind.Variable],
                ["app:Item", SymbolKind.Struct],
                ["app:double", SymbolKind.Function],
                ["$x", SymbolKind.Variable],
            ]),
        );
    });

    it("collects let-variable bindings", () => {
        const document = TextDocument.create(
            "file:///let-symbols.jq",
            "jsoniq",
            1,
            [
                "let $x := 2",
                "return $x",
            ].join("\n"),
        );

        const symbols = flattenSymbols(collectDocumentSymbols(document));

        expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual([
            ["$x", SymbolKind.Variable],
        ]);
    });

    it("nests symbols from a declaration initializer under the declaration symbol", () => {
        const document = TextDocument.create(
            "file:///nested-let-symbols.jq",
            "jsoniq",
            1,
            [
                "let $a := 3",
                "let $b := (",
                "  let $a := 2",
                "  return true",
                ")",
                "return $a",
            ].join("\n"),
        );

        const symbols = collectDocumentSymbols(document);
        const bSymbol = symbols.find((symbol) => symbol.name === "$b");

        expect(symbols.map((symbol) => symbol.name)).toEqual(["$a", "$b"]);
        expect(bSymbol?.children?.map((symbol) => symbol.name)).toEqual(["$a"]);
    });

    it("collects for-variable bindings", () => {
        const document = TextDocument.create(
            "file:///for-symbols.jq",
            "jsoniq",
            1,
            [
                "for $x in ( 1, 2 )",
                "return $x",
            ].join("\n"),
        );

        const symbols = flattenSymbols(collectDocumentSymbols(document));

        expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual([
            ["$x", SymbolKind.Variable],
        ]);
    });

    it("collects multiple variables from a single for clause", () => {
        const document = TextDocument.create(
            "file:///for-multi-symbols.jq",
            "jsoniq",
            1,
            [
                "for $x in (1, 2, 3), $y in (1, 2, 3)",
                "return 10 * $x + $y",
            ].join("\n"),
        );

        const symbolNames = flattenSymbols(collectDocumentSymbols(document)).map((symbol) => symbol.name);

        expect(symbolNames).toEqual([
            "$x",
            "$y",
        ]);
    });

    it("collects function-parameter and FLWOR bindings", () => {
        const document = TextDocument.create(
            "file:///flowr-symbols.jq",
            "jsoniq",
            1,
            [
                "declare function local:aggregate($seed, $extra as integer) {",
                "  for $x at $pos in (1, 2, 3)",
                "  let $y := $x + $seed",
                "  group by $g := $y mod 2",
                "  count $c",
                "  return $g + $c + $extra",
                "};",
            ].join("\n"),
        );

        const symbolNames = flattenSymbols(collectDocumentSymbols(document)).map((symbol) => symbol.name);

        expect(symbolNames).toEqual(
            expect.arrayContaining([
                "local:aggregate",
                "$seed",
                "$extra",
                "$x",
                "$pos",
                "$y",
                "$g",
                "$c",
            ]),
        );
        expect(symbolNames).toHaveLength(8);
    });

    it("collects group-by and count bindings in flowr expressions", () => {
        const document = TextDocument.create(
            "file:///group-count-symbols.jq",
            "jsoniq",
            1,
            [
                "for $x in (1, 2, 3)",
                "group by $group := $x mod 2",
                "count $index",
                "return {\"k\": $group, \"i\": $index}",
            ].join("\n"),
        );

        const symbolNames = flattenSymbols(collectDocumentSymbols(document)).map((symbol) => symbol.name);

        expect(symbolNames).toEqual([
            "$x",
            "$group",
            "$index",
        ]);
    });

    it("never emits empty or invalid symbol names for malformed input", () => {
        const document = TextDocument.create(
            "file:///broken-symbols.jq",
            "jsoniq",
            1,
            [
                "declare function local:($x) {",
                "  for $ in (1, 2, 3)",
                "  return 1",
            ].join("\n"),
        );

        const symbols = flattenSymbols(collectDocumentSymbols(document));

        expect(symbols.every((symbol) => symbol.name.trim().length > 0 && symbol.name !== "$")).toBe(true);
    });

    it("handles incomplete trailing function parameters", () => {
        const document = TextDocument.create(
            "file:///trailing-parameter-symbols.jq",
            "jsoniq",
            1,
            [
                "declare function local:f($a, $b as integer, ) {",
                "}",
            ].join("\n"),
        );

        const symbols = flattenSymbols(collectDocumentSymbols(document));

        expect(symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining([
            "local:f",
            "$a",
            "$b",
        ]));
        expect(symbols.every((symbol) => symbol.name.trim().length > 0 && symbol.name !== "$")).toBe(true);
    });
});

function flattenSymbols(symbols: DocumentSymbol[]): DocumentSymbol[] {
    const result: DocumentSymbol[] = [];

    const visit = (items: DocumentSymbol[]): void => {
        for (const symbol of items) {
            result.push(symbol);
            if (symbol.children !== undefined && symbol.children.length > 0) {
                visit(symbol.children);
            }
        }
    };

    visit(symbols);
    return result;
}
