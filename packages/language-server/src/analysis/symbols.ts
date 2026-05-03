import { parseDocument } from "server/parser/index.js";
import type { SemanticDeclarationKind } from "server/parser/types/declaration.js";
import type { SemanticDeclaration } from "server/parser/types/semantic-events.js";
import { DocumentSymbol, SymbolKind } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { sameRange } from "server/utils/range.js";

interface SymbolOwner {
    declaration: SemanticDeclaration;
    symbol: DocumentSymbol;
}

export class SymbolsBuilder {
    private readonly symbols: DocumentSymbol[] = [];
    private readonly owners: SymbolOwner[] = [];

    public constructor(private readonly document: TextDocument) { }

    public build(): DocumentSymbol[] {
        const events = parseDocument(this.document).semanticEvents;

        for (const event of events) {
            switch (event.type) {
                case "enterDeclaration":
                    this.enterDeclaration(event.declaration);
                    break;
                case "exitDeclaration":
                    this.exitDeclaration(event.declaration);
                    break;
                case "enterScope":
                case "exitScope":
                case "reference":
                    break;
                default:
                    throw event satisfies never;
            }
        }

        return this.symbols;
    }

    private enterDeclaration(declaration: SemanticDeclaration): void {
        const symbol = toDocumentSymbol(declaration);
        if (symbol === undefined) {
            return;
        }

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
    }

    private exitDeclaration(declaration: SemanticDeclaration): void {
        const currentOwner = this.owners[this.owners.length - 1];
        if (currentOwner !== undefined && sameDeclaration(currentOwner.declaration, declaration)) {
            this.owners.pop();
        }
    }

    private currentOwner(): SymbolOwner | undefined {
        return this.owners[this.owners.length - 1];
    }
}

function sameDeclaration(left: SemanticDeclaration, right: SemanticDeclaration): boolean {
    return left.name === right.name
        && left.kind === right.kind
        && sameRange(left.range, right.range);
}

function toDocumentSymbol(declaration: SemanticDeclaration): DocumentSymbol | undefined {
    const name = sanitizeSymbolName(declaration.kind === "function" ? splitFunctionName(declaration.name) : declaration.name);
    if (name === null) {
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

function declarationCanContainChildSymbols(kind: SemanticDeclarationKind): boolean {
    return kind === "function"
        || kind === "declare-variable"
        || kind === "let"
        || kind === "group-by";
}

function splitFunctionName(name: string): string {
    return name.split("#", 1)[0] ?? name;
}

function sanitizeSymbolName(name: string): string | null {
    const trimmed = name.trim();
    return trimmed !== "" && trimmed !== "$" ? trimmed : null;
}

function definitionKindToSymbolKind(kind: SemanticDeclarationKind): SymbolKind {
    switch (kind) {
        case "namespace":
            return SymbolKind.Namespace;
        case "context-item":
            return SymbolKind.Variable;
        case "declare-variable":
        case "let":
        case "for":
        case "for-position":
        case "group-by":
        case "count":
        case "parameter":
            return SymbolKind.Variable;
        case "type":
            return SymbolKind.Struct;
        case "function":
            return SymbolKind.Function;
        default:
            throw kind satisfies never;
    }
}
