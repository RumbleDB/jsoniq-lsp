import type { Diagnostic } from "vscode-languageserver";

import type { JsoniqAst } from "./ast.js";

export interface ParseResult {
    diagnostics: Diagnostic[];
    ast: JsoniqAst;
}
