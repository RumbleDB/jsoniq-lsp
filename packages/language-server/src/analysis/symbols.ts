import { parseDocument } from "server/parser/index.js";
import type { SemanticDeclarationKind } from "server/parser/types/declaration.js";
import { functionNameToString, qnameToString, varNameToString } from "server/parser/types/name.js";
import type { AnySemanticDeclaration } from "server/parser/types/semantic-events.js";
import { sameRange } from "server/utils/range.js";
import { DocumentSymbol, SymbolKind } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

interface DocumentSymbolOwner {
    declaration: AnySemanticDeclaration;
    symbol: DocumentSymbol;
}

export class DocumentSymbolsBuilder {
    private readonly symbols: DocumentSymbol[] = [];
    private readonly owners: DocumentSymbolOwner[] = [];

    public constructor(private readonly document: TextDocument) {}

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

    private enterDeclaration(declaration: AnySemanticDeclaration): void {
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

    private exitDeclaration(declaration: AnySemanticDeclaration): void {
        const currentOwner = this.owners[this.owners.length - 1];
        if (currentOwner !== undefined && sameDeclaration(currentOwner.declaration, declaration)) {
            this.owners.pop();
        }
    }

    private currentOwner(): DocumentSymbolOwner | undefined {
        return this.owners[this.owners.length - 1];
    }
}

function sameDeclaration(left: AnySemanticDeclaration, right: AnySemanticDeclaration): boolean {
    return (
        left.name === right.name && left.kind === right.kind && sameRange(left.range, right.range)
    );
}

function toDocumentSymbol(declaration: AnySemanticDeclaration): DocumentSymbol | undefined {
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

function declarationCanContainChildSymbols(kind: SemanticDeclarationKind): boolean {
    return (
        kind === "function" || kind === "declare-variable" || kind === "let" || kind === "group-by"
    );
}

function toSymbolName(declaration: AnySemanticDeclaration): string {
    switch (declaration.kind) {
        case "context-item":
            return declaration.name.label;
        case "count":
        case "declare-variable":
        case "let":
        case "for":
        case "for-position":
        case "group-by":
        case "parameter":
            return varNameToString(declaration.name);
        case "namespace":
            return declaration.name.prefix;
        case "function":
            return functionNameToString(declaration.name);
        case "type":
            return qnameToString(declaration.name.qname);
        default:
            throw declaration satisfies never;
    }
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
