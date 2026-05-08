import { ParseTree } from "antlr4ng";
import { ScopeKind } from "server/parser/types/semantic-events.js";

import {
    FlowrExprContext,
    FlowrStatementContext,
    FunctionDeclContext,
} from "./grammar/jsoniqParser.js";

/**
 * A new variable scope is introduced by:
 * - Function declarations (introducing a new function scope)
 * - FLWOR expressions and statements (introducing a new FLWOR scope)
 * Each of these scopes can contain variable declarations that should not be visible outside of that scope,
 *  so we push a new scope frame onto the stack when we enter these nodes, and pop it when we exit.
 */
export function getScopeKind(node: ParseTree): ScopeKind | null {
    if (node instanceof FunctionDeclContext) {
        return "function";
    }

    if (node instanceof FlowrExprContext || node instanceof FlowrStatementContext) {
        return "flowr";
    }

    return null;
}
