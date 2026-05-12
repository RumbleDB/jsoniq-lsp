import { parseDocument } from "server/parser/index.js";
import type { AstNode } from "server/parser/types/ast.js";
import type { AnyAstDeclaration, DeclarationKind } from "server/parser/types/declaration.js";
import { qnameToString, varNameToString } from "server/parser/types/name.js";
import { comparePositions } from "server/utils/position.js";
import { DocumentSymbol, SymbolKind } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

interface DocumentSymbolOwner {
    declaration: AnyAstDeclaration;
    symbol: DocumentSymbol;
}

export class DocumentSymbolsBuilder {
    private readonly symbols: DocumentSymbol[] = [];
    private readonly owners: DocumentSymbolOwner[] = [];

    public constructor(private readonly document: TextDocument) {}

    public build(): DocumentSymbol[] {
        this.visitNode(parseDocument(this.document).ast);
        return this.symbols;
    }

    private visitNode(node: AstNode): void {
        switch (node.kind) {
            case "module":
            case "flowrExpression":
            case "unknown":
                this.visitChildren(node);
                break;
            case "functionDeclaration":
            case "variableDeclaration":
            case "letBinding":
            case "groupByBinding":
            case "countClause":
                this.addDeclaration(node.declaration);
                this.visitChildren(node);
                break;
            case "forBinding":
                for (const declaration of node.declarations) {
                    this.addDeclaration(declaration);
                }
                this.visitChildren(node);
                break;
            case "catchClause":
                for (const declaration of node.declarations) {
                    this.addDeclaration(declaration);
                }
                this.visitChildren(node);
                break;
            case "declaration":
                this.addDeclaration(node.declaration);
                break;
            case "functionCall":
            case "namedFunctionReference":
            case "variableReference":
            case "contextItemExpression":
            case "reference":
                break;
            default:
                throw node satisfies never;
        }
    }

    private visitChildren(node: AstNode): void {
        for (const child of node.children) {
            this.visitNode(child);
        }
    }

    private addDeclaration(declaration: AnyAstDeclaration): void {
        const symbol = toDocumentSymbol(declaration);
        if (symbol === undefined) {
            return;
        }

        this.leaveCompletedOwners(declaration);

        const parent = this.currentOwner()?.symbol;
        if (parent === undefined) {
            this.symbols.push(symbol);
        } else {
            parent.children ??= [];
            parent.children.push(symbol);
        }

        if (declarationCanContainChildSymbols(declaration.kind)) {
            this.owners.push({ declaration, symbol });
        }

        if (declaration.kind === "function") {
            for (const parameter of declaration.extra.parameters) {
                this.addDeclaration(parameter);
            }
        }
    }

    private leaveCompletedOwners(declaration: AnyAstDeclaration): void {
        while (!this.currentOwnerContains(declaration)) {
            this.owners.pop();
        }
    }

    private currentOwner(): DocumentSymbolOwner | undefined {
        return this.owners[this.owners.length - 1];
    }

    private currentOwnerContains(declaration: AnyAstDeclaration): boolean {
        const owner = this.currentOwner();
        if (owner === undefined) {
            return true;
        }

        return (
            comparePositions(owner.declaration.range.start, declaration.range.start) <= 0 &&
            comparePositions(declaration.range.end, owner.declaration.range.end) <= 0
        );
    }
}

function toDocumentSymbol(declaration: AnyAstDeclaration): DocumentSymbol | undefined {
    const name = toSymbolName(declaration);

    if (name === null || name.trim() === "") {
        return undefined;
    }

    return {
        name,
        kind: definitionKindToSymbolKind(declaration.kind),
        range: declaration.range,
        selectionRange: declaration.selectionRange,
        children: [],
    };
}

function declarationCanContainChildSymbols(kind: DeclarationKind): boolean {
    return (
        kind === "function" || kind === "declare-variable" || kind === "let" || kind === "group-by"
    );
}

function toSymbolName(declaration: AnyAstDeclaration): string {
    switch (declaration.kind) {
        case "count":
        case "declare-variable":
        case "let":
        case "for":
        case "for-position":
        case "group-by":
        case "parameter":
        case "catch-variable":
            return varNameToString(declaration.name);
        case "namespace":
            return declaration.name.prefix;
        case "function":
            return qnameToString(declaration.name.qname);
        case "type":
            return qnameToString(declaration.name.qname);
        default:
            throw declaration satisfies never;
    }
}

function definitionKindToSymbolKind(kind: DeclarationKind): SymbolKind {
    switch (kind) {
        case "namespace":
            return SymbolKind.Namespace;
        case "declare-variable":
        case "let":
        case "for":
        case "for-position":
        case "group-by":
        case "count":
        case "parameter":
        case "catch-variable":
            return SymbolKind.Variable;
        case "type":
            return SymbolKind.Struct;
        case "function":
            return SymbolKind.Function;
        default:
            throw kind satisfies never;
    }
}
