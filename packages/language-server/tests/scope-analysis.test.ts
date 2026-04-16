import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";

import { analyzeVariableScopes, findVariableOccurrenceAtOffset } from "../src/server/analysis.js";

describe("JSONiq variable scope analysis", () => {
    it("collects variable declarations from function params and FLWOR clauses", () => {
        const document = TextDocument.create(
            "file:///scope-declarations.jq",
            "jsoniq",
            1,
            [
                "declare function local:f($a, $b as integer) {",
                "  for $x at $pos in (1, 2, 3)",
                "  let $y := $x + $a",
                "  group by $g := $y mod 2",
                "  count $c",
                "  return $g + $c + $b",
                "};",
            ].join("\n"),
        );

        const analysis = analyzeVariableScopes(document);
        const declarationNames = analysis.definitions.map((declaration) => declaration.name);

        expect(declarationNames).toEqual([
            "$a",
            "$b",
            "$x",
            "$pos",
            "$y",
            "$g",
            "$c",
        ]);
    });

    it("resolves references to the nearest declaration", () => {
        const document = TextDocument.create(
            "file:///scope-resolution.jq",
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

        const analysis = analyzeVariableScopes(document);
        const references = analysis.references.map((reference) => ({
            name: reference.name,
            line: reference.range.start.line,
            resolvedTo: reference.declaration?.name,
            resolvedKind: reference.declaration?.kind,
        }));

        expect(references).toEqual([
            { name: "$x", line: 2, resolvedTo: "$x", resolvedKind: "parameter" },
            { name: "$y", line: 3, resolvedTo: "$y", resolvedKind: "let" },
            { name: "$x", line: 3, resolvedTo: "$x", resolvedKind: "parameter" },
            { name: "$x", line: 5, resolvedTo: "$x", resolvedKind: "declare-variable" },
        ]);
    });

    it("supports multiple for variables in the same clause", () => {
        const document = TextDocument.create(
            "file:///scope-multi-for.jq",
            "jsoniq",
            1,
            [
                "for $x in (1, 2, 3), $y in ($x, 4)",
                "return 10 * $x + $y",
            ].join("\n"),
        );

        const analysis = analyzeVariableScopes(document);

        expect(analysis.definitions.map((declaration) => declaration.name)).toEqual([
            "$x",
            "$y",
        ]);
        expect(analysis.references.map((reference) => ({
            name: reference.name,
            line: reference.range.start.line,
            resolvedTo: reference.declaration?.name,
        }))).toEqual([
            { name: "$x", line: 0, resolvedTo: "$x" },
            { name: "$x", line: 1, resolvedTo: "$x" },
            { name: "$y", line: 1, resolvedTo: "$y" },
        ]);
    });

    it("supports multiple for bindings that each define an at-position variable", () => {
        const document = TextDocument.create(
            "file:///scope-multi-for-at.jq",
            "jsoniq",
            1,
            [
                "for $x at $ix in (1, 2), $y at $iy in ($x, 3)",
                "return $x + $ix + $y + $iy",
            ].join("\n"),
        );

        const analysis = analyzeVariableScopes(document);

        expect(analysis.definitions.map((declaration) => ({
            name: declaration.name,
            kind: declaration.kind,
        }))).toEqual([
            { name: "$x", kind: "for" },
            { name: "$ix", kind: "for-position" },
            { name: "$y", kind: "for" },
            { name: "$iy", kind: "for-position" },
        ]);

        expect(analysis.references.map((reference) => ({
            name: reference.name,
            line: reference.range.start.line,
            resolvedTo: reference.declaration?.name,
            resolvedKind: reference.declaration?.kind,
        }))).toEqual([
            { name: "$x", line: 0, resolvedTo: "$x", resolvedKind: "for" },
            { name: "$x", line: 1, resolvedTo: "$x", resolvedKind: "for" },
            { name: "$ix", line: 1, resolvedTo: "$ix", resolvedKind: "for-position" },
            { name: "$y", line: 1, resolvedTo: "$y", resolvedKind: "for" },
            { name: "$iy", line: 1, resolvedTo: "$iy", resolvedKind: "for-position" },
        ]);
    });

    it("stores references per declaration and supports binary-search occurrence lookup", () => {
        const document = TextDocument.create(
            "file:///scope-index.jq",
            "jsoniq",
            1,
            [
                "declare function local:f($x) {",
                "  let $y := $x + 1",
                "  return $y + $x",
                "};",
            ].join("\n"),
        );

        const analysis = analyzeVariableScopes(document);
        const parameter = analysis.definitions.find((declaration) => declaration.name === "$x" && declaration.kind === "parameter");

        expect(parameter).toBeDefined();

        if (parameter === undefined) {
            return;
        }

        const parameterReferences = analysis.referencesByDeclaration.get(parameter);
        expect(parameterReferences?.map((reference) => reference.range.start.line)).toEqual([1, 2]);

        const offsetOnReturnX = document.offsetAt({ line: 2, character: 14 });
        const occurrence = findVariableOccurrenceAtOffset(analysis, offsetOnReturnX);

        expect(occurrence?.reference).toBeDefined();
        expect(occurrence?.declaration.name).toBe("$x");
        expect(occurrence?.declaration.kind).toBe("parameter");
    });

    it("returns correct declaration for reference on the same line as declaration", () => {
        const document = TextDocument.create(
            "file:///scope-same-line.jq",
            "jsoniq",
            1,
            [
                "declare function local:f($x) {",
                "  let $y := $x + 1 return $y + $x",
                "};",
            ].join("\n"),
        );

        const analysis = analyzeVariableScopes(document);
        const parameter = analysis.definitions.find((declaration) => declaration.name === "$x" && declaration.kind === "parameter");

        expect(parameter).toBeDefined();

        if (parameter === undefined) {
            return;
        }

        const parameterReferences = analysis.referencesByDeclaration.get(parameter);
        expect(parameterReferences?.map((reference) => reference.range.start.line)).toEqual([1, 1]);

        const offsetOnReturnX = document.offsetAt({ line: 1, character: 13 });
        const occurrence = findVariableOccurrenceAtOffset(analysis, offsetOnReturnX);

        expect(occurrence?.reference).toBeDefined();
        expect(occurrence?.declaration.name).toBe("$x");
        expect(occurrence?.declaration.kind).toBe("parameter");
    });

    it("resolves shadowed variables with the same name to the nearest declaration", () => {
        const document = TextDocument.create(
            "file:///scope-shadowing-same-name.jq",
            "jsoniq",
            1,
            [
                "let $x := 1",
                "let $x := $x + 1",
                "return $x",
            ].join("\n"),
        );

        const analysis = analyzeVariableScopes(document);
        const xDeclarations = analysis.definitions.filter((declaration) => declaration.name === "$x" && declaration.kind === "let");

        expect(xDeclarations).toHaveLength(2);

        const references = analysis.references
            .filter((reference) => reference.name === "$x")
            .map((reference) => ({
                line: reference.range.start.line,
                declarationLine: reference.declaration?.selectionRange.start.line,
            }));

        expect(references).toEqual([
            { line: 1, declarationLine: 0 },        /// The $x in the second line refers to the first declaration of $x
            { line: 2, declarationLine: 1 },        /// The $x in the third line refers to the second declaration of $x, which shadows the first one
        ]);
    });
});
