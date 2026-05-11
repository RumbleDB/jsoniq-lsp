import { parseDocument } from "server/parser/index.js";
import type { SemanticDeclarationKind } from "server/parser/types/declaration.js";
import { qnameToString, varNameToString } from "server/parser/types/name.js";
import type { AnySemanticDeclaration } from "server/parser/types/semantic-events.js";
import { comparePositions } from "server/utils/position.js";
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
                case "declaration":
                    this.addDeclaration(event.declaration);
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

    private addDeclaration(declaration: AnySemanticDeclaration): void {
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

    private leaveCompletedOwners(declaration: AnySemanticDeclaration): void {
        while (!this.currentOwnerContains(declaration)) {
            this.owners.pop();
        }
    }

    private currentOwner(): DocumentSymbolOwner | undefined {
        return this.owners[this.owners.length - 1];
    }

    private currentOwnerContains(declaration: AnySemanticDeclaration): boolean {
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
