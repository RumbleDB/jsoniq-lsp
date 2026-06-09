import { parseDocument } from "server/parser/index.js";
import type { ArgumentAstNode, AstNode, FunctionCallAstNode } from "server/parser/types/ast.js";
import { InlayHintKind, type InlayHint, type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type JsoniqAnalysis } from "./analysis/model.js";
import { getAnalysis } from "./analysis/service.js";
import {
    chooseBestSignatureIndex,
    findResolvedSourceFunction,
    getFunctionCallArgumentNodes,
    getFunctionCatalogEntry,
} from "./utils/function-calls.js";
import { rangesIntersect } from "./utils/range.js";

export async function collectInlayHints(
    document: TextDocument,
    range: Range,
): Promise<InlayHint[]> {
    const parsed = parseDocument(document);
    const analysis = await getAnalysis(document);
    return collectFunctionCallInlayHints(parsed.ast, range, analysis);
}

function collectFunctionCallInlayHints(
    node: AstNode,
    range: Range,
    analysis: JsoniqAnalysis,
): InlayHint[] {
    if (!rangesIntersect(node.range, range)) {
        return [];
    }

    return [
        ...(node.kind === "function-call" ? createFunctionCallHints(node, analysis) : []),
        ...node.children.flatMap((child) => collectFunctionCallInlayHints(child, range, analysis)),
    ];
}

function createFunctionCallHints(call: FunctionCallAstNode, analysis: JsoniqAnalysis): InlayHint[] {
    return getFunctionCallArgumentNodes(call)
        .map((argument) =>
            createParameterHint(argument, getParameterName(call, argument, analysis)),
        )
        .filter((hint): hint is InlayHint => hint !== null);
}

function createParameterHint(
    argument: ArgumentAstNode,
    parameterName: string | undefined,
): InlayHint | null {
    if (parameterName === undefined) {
        return null;
    }

    return {
        position: argument.range.start,
        kind: InlayHintKind.Parameter,
        label: `${parameterName}: `,
        paddingRight: true,
    };
}

function getParameterName(
    call: FunctionCallAstNode,
    argument: ArgumentAstNode,
    analysis: JsoniqAnalysis,
): string | undefined {
    const sourceDefinition = findResolvedSourceFunction(call, analysis);
    if (sourceDefinition) {
        const parameter = sourceDefinition.parameters[argument.index];
        return parameter === undefined ? undefined : `$${parameter.name.qname.localName}`;
    }

    return getBuiltinParameterName(call, argument.index);
}

function getBuiltinParameterName(
    call: FunctionCallAstNode,
    argumentIndex: number,
): string | undefined {
    const catalogEntry = getFunctionCatalogEntry(call);

    if (!catalogEntry || catalogEntry.signatures.length === 0) {
        return undefined;
    }

    const signature =
        catalogEntry.signatures[
            chooseBestSignatureIndex(
                catalogEntry.signatures.map((candidate) => candidate.params.length),
                getFunctionCallArgumentNodes(call).length,
            )
        ]!;

    const parameter = signature.params[argumentIndex];
    return parameter === undefined ? undefined : `$${parameter.name}`;
}
