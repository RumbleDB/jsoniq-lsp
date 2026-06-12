import { Parser, Token } from "antlr4ng";
import type { Diagnostic } from "vscode-languageserver";

import type { JsoniqAst } from "./ast.js";

export interface ParseResult {
    diagnostics: Diagnostic[];
    ast: JsoniqAst;
    parser: Parser;
    tokens: Token[];
}
