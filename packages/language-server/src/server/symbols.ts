import { ParserRuleContext, TerminalNode, type ParseTree } from "antlr4ng";
import {
    DocumentSymbol,
    SymbolKind,
    type Range,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    ContextItemDeclContext,
    ForVarContext,
    FunctionDeclContext,
    LetVarContext,
    NamespaceDeclContext,
    TypeDeclContext,
    VarDeclContext,
} from "../grammar/jsoniqParser.js";
import { parseJsoniqDocument } from "./parser.js";

export function collectDocumentSymbols(document: TextDocument): DocumentSymbol[] {
    const parseResult = parseJsoniqDocument(document);
    const symbols: DocumentSymbol[] = [];

    visit(parseResult.tree, (node) => {
        const symbol = symbolFromNode(node, document);

        if (symbol !== undefined) {
            symbols.push(symbol);
        }
    });

    return symbols;
}

function visit(node: ParseTree, callback: (node: ParseTree) => void): void {
    callback(node);

    for (let index = 0; index < node.getChildCount(); index += 1) {
        const child = node.getChild(index);

        if (child !== null) {
            visit(child, callback);
        }
    }
}

function symbolFromNode(node: ParseTree, document: TextDocument): DocumentSymbol | undefined {
    if (node instanceof FunctionDeclContext) {
        return createSymbol(node._fn_name?.getText() ?? node.qname().getText(), SymbolKind.Function, node, node._fn_name ?? node.qname(), document);
    }

    if (node instanceof VarDeclContext) {
        const variableName = `$${node.varRef().qname().getText()}`;
        return createSymbol(variableName, SymbolKind.Variable, node, node.varRef(), document);
    }

    if (node instanceof LetVarContext) {
        const variableName = `$${node.varRef().qname().getText()}`;
        return createSymbol(variableName, SymbolKind.Variable, node, node.varRef(), document);
    }

    if (node instanceof TypeDeclContext) {
        return createSymbol(node._type_name?.getText() ?? node.qname().getText(), SymbolKind.Struct, node, node._type_name ?? node.qname(), document);
    }

    if (node instanceof ContextItemDeclContext) {
        return createSymbol("context item", SymbolKind.Variable, node, node, document);
    }

    if (node instanceof NamespaceDeclContext) {
        return createSymbol(node.NCName().getText(), SymbolKind.Namespace, node, node.NCName(), document);
    }

    if (node instanceof ForVarContext) {
        for (const varName of node.varRef()) {
            return createSymbol(`for ${varName.getText()}`, SymbolKind.Variable, node, varName, document);
        }
    }

    return undefined;
}

function createSymbol(
    name: string,
    kind: SymbolKind,
    declarationNode: ParserRuleContext,
    selectionNode: ParserRuleContext | ParseTree,
    document: TextDocument,
): DocumentSymbol {
    const range = rangeFromNode(declarationNode, document);

    return {
        name,
        kind,
        range,
        selectionRange: rangeFromNode(selectionNode, document) ?? range,
    };
}

function rangeFromNode(node: ParserRuleContext | ParseTree, document: TextDocument): Range {
    if (node instanceof TerminalNode) {
        return {
            start: document.positionAt(Math.max(node.symbol.start, 0)),
            end: document.positionAt(Math.max(node.symbol.stop + 1, node.symbol.start)),
        };
    }

    if (node instanceof ParserRuleContext && node.start !== null) {
        const start = node.start.start;
        const stop = node.stop?.stop ?? node.start.stop;

        return {
            start: document.positionAt(Math.max(start, 0)),
            end: document.positionAt(Math.max(stop + 1, start)),
        };
    }

    const interval = node.getSourceInterval();
    const start = Math.max(interval.start, 0);
    const stop = Math.max(interval.stop, start);

    return {
        start: document.positionAt(start),
        end: document.positionAt(stop + 1),
    };
}
