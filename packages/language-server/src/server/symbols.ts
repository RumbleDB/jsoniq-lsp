import { ParserRuleContext, type ParseTree } from "antlr4ng";
import {
    DocumentSymbol,
    SymbolKind,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    CountClauseContext,
    ContextItemDeclContext,
    ForVarContext,
    FunctionDeclContext,
    GroupByVarContext,
    LetVarContext,
    NamespaceDeclContext,
    ParamContext,
    TypeDeclContext,
    VarDeclContext,
} from "../grammar/jsoniqParser.js";
import { parseJsoniqDocument } from "./parser.js";
import { rangeFromNode } from "./utils/range.js";

export function collectDocumentSymbols(document: TextDocument): DocumentSymbol[] {
    const parseResult = parseJsoniqDocument(document);
    const symbols: DocumentSymbol[] = [];

    visit(parseResult.tree, (node) => {
        symbols.push(...(symbolsFromNode(node, document).filter((symbol): symbol is DocumentSymbol => symbol !== undefined)));
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

/**
 * Collect DocumentSymbols from the given ParseTree node
 * @param node The ParseTree node to collect symbols from
 * @param document The TextDocument representing the JSONiq source code, used to convert node positions to document positions when creating DocumentSymbols
 * @returns An array of DocumentSymbols, which may be empty if the node does not represent a symbol declaration or if the symbol name is invalid (e.g. empty or just "$")
 */
function symbolsFromNode(node: ParseTree, document: TextDocument): Array<DocumentSymbol | undefined> {
    if (node instanceof FunctionDeclContext) {
        return [
            createSymbol(node._fn_name?.getText() ?? node.qname().getText(), SymbolKind.Function, node, node._fn_name ?? node.qname(), document),
        ];
    }

    if (node instanceof VarDeclContext) {
        const variableName = `$${node.varRef().qname().getText()}`;
        return [createSymbol(variableName, SymbolKind.Variable, node, node.varRef(), document)];
    }

    if (node instanceof LetVarContext) {
        const variableName = `$${node.varRef().qname().getText()}`;
        return [createSymbol(variableName, SymbolKind.Variable, node, node.varRef(), document)];
    }

    if (node instanceof ForVarContext) {
        return node.varRef().map((varRef) => createSymbol(`$${varRef.qname().getText()}`, SymbolKind.Variable, node, varRef, document));
    }

    if (node instanceof GroupByVarContext) {
        const variableName = `$${node.varRef().qname().getText()}`;
        return [createSymbol(variableName, SymbolKind.Variable, node, node.varRef(), document)];
    }

    if (node instanceof CountClauseContext) {
        const variableName = `$${node.varRef().qname().getText()}`;
        return [createSymbol(variableName, SymbolKind.Variable, node, node.varRef(), document)];
    }

    if (node instanceof ParamContext) {
        const variableName = `$${node.qname().getText()}`;
        return [createSymbol(variableName, SymbolKind.Variable, node, node.qname(), document)];
    }

    if (node instanceof TypeDeclContext) {
        return [
            createSymbol(node._type_name?.getText() ?? node.qname().getText(), SymbolKind.Struct, node, node._type_name ?? node.qname(), document),
        ];
    }

    if (node instanceof ContextItemDeclContext) {
        return [createSymbol("context item", SymbolKind.Variable, node, node, document)];
    }

    if (node instanceof NamespaceDeclContext) {
        return [createSymbol(node.NCName().getText(), SymbolKind.Namespace, node, node.NCName(), document)];
    }

    return [];
}

/**
 * Creates a DocumentSymbol for the given symbol information, or returns undefined if the symbol name is invalid (e.g. empty or just "$").
 * @param name The original symbol name to sanitize and use for the DocumentSymbol
 * @param kind The SymbolKind to assign to the DocumentSymbol
 * @param declarationNode The ParserRuleContext node representing the declaration of the symbol, used to determine the range of the symbol
 * @param selectionNode The ParserRuleContext or ParseTree node representing the part of the declaration to use for the selectionRange of the DocumentSymbol (e.g. just the name of the variable), or null to use the entire declarationNode range
 * @param document The TextDocument representing the JSONiq source code, used to convert node positions to document positions
 * @returns A DocumentSymbol object representing the symbol, or undefined if the symbol name is invalid
 */
function createSymbol(
    name: string,
    kind: SymbolKind,
    declarationNode: ParserRuleContext,
    selectionNode: ParserRuleContext | ParseTree,
    document: TextDocument,
): DocumentSymbol | undefined {
    const sanitizedName = sanitizeSymbolName(name);
    if (sanitizedName === null) {
        // This could happen if the variable name is just "$" or whitespace, for example, when user is still typing the variable name.
        // In that case, to avoid error, we skip this symbol
        return undefined;
    }

    const range = rangeFromNode(declarationNode, document);

    return {
        name: sanitizedName,
        kind,
        range,
        selectionRange: rangeFromNode(selectionNode, document) ?? range,
    };
}

/**
 * Sanitizes the given symbol name by trimming whitespace and validating that it is not empty or just a "$" character.
 * In VSCode, falsy strings are not allowed as symbol names
 * 
 * @param name The original symbol name to sanitize
 * @returns The sanitized symbol name, or null if the name is invalid (e.g. empty or just "$")
 */
function sanitizeSymbolName(name: string): string | null {
    const trimmed = name.trim();
    const isValid = trimmed !== "" && trimmed !== "$";
    return name !== "" && name !== "$" ? trimmed : null;
}
