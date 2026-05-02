import { parseDocument } from "server/parser/index.js";
import { DocumentSymbol, SymbolKind } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SourceDefinitionKind } from "./model.js";

export class SymbolsBuilder {
    private symbols: DocumentSymbol[] = [];

    constructor(
        private readonly document: TextDocument,
    ) { }

    public build(): DocumentSymbol[] {
        const events = parseDocument(this.document).semanticEvents;
        const stack: Array<DocumentSymbol[]> = [this.symbols];

        const pushSymbol = (symbol: DocumentSymbol): void => {
            const current = stack[stack.length - 1];
            current!.push(symbol);
        }

        const getLastSymbol = (): DocumentSymbol | undefined => {
            const current = stack[stack.length - 1];
            const last = current?.[current?.length - 1];

            return last;
        }

        for (const event of events) {
            switch (event.type) {
                case "declaration":
                    pushSymbol({
                        name: event.name,
                        kind: definitionKindToSymbolKind(event.kind),
                        range: event.range,
                        selectionRange: event.selectionRange,
                        children: [],
                    });
                    break;
                case "enterScope":
                    const lastSymbol = getLastSymbol();
                    if (lastSymbol) {
                        stack.push(lastSymbol.children!);
                    }
                    break;
                case "exitScope":
                    stack.pop();
                    break;
                case "reference":
                    break;
                default:
                    throw event satisfies never;
            }
        }

        return this.symbols;
    }
}

function definitionKindToSymbolKind(kind: SourceDefinitionKind): SymbolKind {
    switch (kind) {
        case "declare-variable":
        case "let":
        case "for":
        case "for-position":
        case "group-by":
        case "count":
        case "parameter":
            return SymbolKind.Variable;
        case "function":
            return SymbolKind.Function;
        default:
            throw kind satisfies never;
    }
}