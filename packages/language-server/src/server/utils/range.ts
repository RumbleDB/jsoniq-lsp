import {
    ParserRuleContext,
    TerminalNode,
    type ParseTree,
} from "antlr4ng";
import { type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

export function rangeFromNode(node: ParserRuleContext | ParseTree, document: TextDocument): Range {
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
