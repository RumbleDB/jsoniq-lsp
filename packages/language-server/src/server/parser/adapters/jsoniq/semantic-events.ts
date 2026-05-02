import { type ParseTree } from "antlr4ng";
import { type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    CountClauseContext,
    ForVarContext,
    FlowrExprContext,
    FlowrStatementContext,
    FunctionDeclContext,
    FunctionCallContext,
    GroupByVarContext,
    LetVarContext,
    NamedFunctionRefContext,
    ParamContext,
    VarDeclContext,
    VarRefContext,
    type ModuleAndThisIsItContext,
} from "grammar/jsoniqParser.js";
import type {
    SemanticDeclarationEvent,
    SemanticEvent,
    SemanticReferenceEvent,
    ScopeKind,
} from "server/parser/semantic-events.js";
import { functionNameWithArityOrNull, varRefNameOrNull } from "server/utils/name.js";
import { rangeFromNode } from "server/utils/range.js";

class SemanticEventCollector {
    private events: SemanticEvent[] = [];
    private document: TextDocument;

    constructor(document: TextDocument) {
        this.document = document;
    }

    get collectedEvents(): readonly SemanticEvent[] {
        return this.events;
    }

    private emit(event: SemanticEvent): void {
        this.events.push(event);
    }

    public declaration(event: Omit<SemanticDeclarationEvent, "type">): void {
        this.emit({
            type: "declaration",
            ...event,
        });
    }

    public reference(name: string, kind: SemanticReferenceEvent["kind"], range: Range): void {
        this.emit({
            type: "reference",
            name,
            kind,
            range,
        });
    }

    public variable(
        kind: SemanticDeclarationEvent["kind"],
        declarationNode: ParseTree,
        selectionNode: VarRefContext,
    ): void {
        const name = varRefNameOrNull(selectionNode);
        if (name === null) {
            return;
        }

        this.declaration({
            name,
            kind,
            range: rangeFromNode(declarationNode, this.document),
            selectionRange: rangeFromNode(selectionNode, this.document),
            availability: "afterChildren",
        });
    };

    public scope(range: Range, enter: boolean, scopeKind: ScopeKind): void {
        this.emit({
            type: enter ? "enterScope" : "exitScope",
            range,
            scopeKind,
        });
    }
}

export function collectSemanticEvents(tree: ModuleAndThisIsItContext, document: TextDocument): readonly SemanticEvent[] {
    const events = new SemanticEventCollector(document);

    const collectDefinitionsBeforeScope = (node: ParseTree): void => {
        if (node instanceof FunctionDeclContext) {
            const name = functionNameWithArityOrNull(node);
            const selectionNode = node._fn_name ?? node.qname();
            if (name !== null && selectionNode !== null) {
                events.declaration({
                    name,
                    kind: "function",
                    range: rangeFromNode(node, document),
                    selectionRange: rangeFromNode(selectionNode, document),
                    availability: "beforeChildren",
                });
            }
        }
    };

    const collectDefinitionsBeforeChildren = (node: ParseTree): void => {
        if (node instanceof ParamContext) {
            const qname = node.qname();
            const name = qname?.getText().trim();
            if (qname !== null && name !== undefined && name !== "") {
                const dollarRange = rangeFromNode(node.Kdollar(), document);
                const qnameRange = rangeFromNode(qname, document);
                events.declaration({
                    name: `$${name}`,
                    kind: "parameter",
                    range: rangeFromNode(node, document),
                    selectionRange: {
                        start: dollarRange.start,
                        end: qnameRange.end,
                    },
                    availability: "beforeChildren",
                });
            }
        }
    };

    const collectReferencesBeforeChildren = (node: ParseTree): void => {
        if (node instanceof VarRefContext && !isDeclarationVarRef(node)) {
            const name = varRefNameOrNull(node);
            if (name !== null) {
                events.reference(name, "variable", rangeFromNode(node, document));
            }
        }

        if (node instanceof FunctionCallContext || node instanceof NamedFunctionRefContext) {
            const nameNode = node._fn_name ?? node.qname();
            const name = functionNameWithArityOrNull(node);
            if (name !== null && nameNode !== null) {
                events.reference(name, "function", rangeFromNode(nameNode, document));
            }
        }
    };

    const collectDefinitionsAfterChildren = (node: ParseTree): void => {
        if (node instanceof VarDeclContext) {
            events.variable("declare-variable", node, node.varRef());
        } else if (node instanceof ForVarContext) {
            const variableRefs = node.varRef();
            const boundVariable = variableRefs[0];
            if (boundVariable !== undefined) {
                events.variable("for", node, boundVariable);
            }
            const positionVariable = variableRefs[1];
            if (positionVariable !== undefined) {
                events.variable("for-position", node, positionVariable);
            }
        } else if (node instanceof LetVarContext) {
            events.variable("let", node, node.varRef());
        } else if (node instanceof GroupByVarContext) {
            events.variable("group-by", node, node.varRef());
        } else if (node instanceof CountClauseContext) {
            events.variable("count", node, node.varRef());
        }
    };

    const visit = (node: ParseTree): void => {
        collectDefinitionsBeforeScope(node);

        const scopeKind = getScopeKind(node);
        if (scopeKind !== null) {
            events.scope(rangeFromNode(node, document), true, scopeKind);
        }

        collectDefinitionsBeforeChildren(node);
        collectReferencesBeforeChildren(node);

        for (let index = 0; index < node.getChildCount(); index += 1) {
            const child = node.getChild(index);
            if (child !== null) {
                visit(child);
            }
        }

        collectDefinitionsAfterChildren(node);

        if (scopeKind !== null) {
            events.scope(rangeFromNode(node, document), false, scopeKind);
        }
    };

    visit(tree);

    return events.collectedEvents;
}

function getScopeKind(node: ParseTree): ScopeKind | null {
    if (node instanceof FunctionDeclContext) {
        return "function";
    }

    if (node instanceof FlowrExprContext || node instanceof FlowrStatementContext) {
        return "flowr";
    }

    return null;
}

/**
 * Check if given VarRefContext is part of a variable declaration
 * 
 * Because in the grammar file, varRef is used both for variable declarations and variable references
 * We distinguish them by checking the parent node
 * @param node The VarRefContext to check
 * @returns true if the node is part of a variable declaration, false otherwise
 */
function isDeclarationVarRef(node: VarRefContext): boolean {
    const parent = node.parent;

    if (parent instanceof VarDeclContext || parent instanceof LetVarContext || parent instanceof GroupByVarContext || parent instanceof CountClauseContext) {
        return parent.varRef() === node;
    }

    if (parent instanceof ForVarContext) {
        return parent.varRef().some((entry) => entry === node);
    }

    return false;
}
