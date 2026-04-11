import { describe, expect, it } from "vitest";
import { SymbolKind } from "vscode-languageserver";
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

        const symbols = collectDocumentSymbols(document);

        expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual([
            ["app", SymbolKind.Namespace],
            ["$app:value", SymbolKind.Variable],
            ["context item", SymbolKind.Variable],
            ["app:Item", SymbolKind.Struct],
            ["app:double", SymbolKind.Function],
        ]);
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

        const symbols = collectDocumentSymbols(document);

        expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual([
            ["$x", SymbolKind.Variable],
        ]);
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

        const symbols = collectDocumentSymbols(document);

        expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual([
            ["for $x", SymbolKind.Variable],
        ]);
    });
});
