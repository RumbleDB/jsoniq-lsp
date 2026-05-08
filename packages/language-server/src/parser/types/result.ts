import type { Diagnostic } from "vscode-languageserver";

import type { SemanticEvent } from "./semantic-events.js";

export interface ParseResult {
    diagnostics: Diagnostic[];
    semanticEvents: readonly SemanticEvent[];
}
