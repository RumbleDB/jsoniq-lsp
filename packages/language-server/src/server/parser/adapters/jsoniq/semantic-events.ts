import { type ParseTree } from "antlr4ng";
import { type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    ContextItemDeclContext,
    CountClauseContext,
    NamespaceDeclContext,
    ForVarContext,
    FunctionDeclContext,
    FunctionCallContext,
    GroupByVarContext,
    LetVarContext,
    NamedFunctionRefContext,
    ParamContext,
    TypeDeclContext,
    VarDeclContext,
    VarRefContext,
    type ModuleAndThisIsItContext,
} from "grammar/jsoniqParser.js";
import type {
    SemanticDeclaration,
    SemanticEvent,
    SemanticReferenceEvent,
    ScopeKind,
} from "server/parser/semantic-events.js";
import { functionNameWithArityOrNull, varRefNameOrNull } from "./name.js";
import { rangeFromNode } from "server/utils/range.js";
import { getScopeKind } from "./scope.js";

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

    public enterDeclaration(declaration: SemanticDeclaration): void {
        this.emit({
            type: "enterDeclaration",
            declaration,
        });
    }

    public exitDeclaration(declaration: SemanticDeclaration): void {
        this.emit({
            type: "exitDeclaration",
            declaration,
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
        kind: SemanticDeclaration["kind"],
        declarationNode: ParseTree,
        selectionNode: VarRefContext,
    ): SemanticDeclaration | undefined {
        const name = varRefNameOrNull(selectionNode);
        if (name === null) {
            return undefined;
        }

        return {
            name,
            kind,
            range: rangeFromNode(declarationNode, this.document),
            selectionRange: rangeFromNode(selectionNode, this.document),
        };
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

    const collectDeclarations = (node: ParseTree): SemanticDeclaration[] => {
        if (node instanceof NamespaceDeclContext) {
            const nameNode = node.NCName();
            const name = nameNode.getText().trim();
            if (name !== "") {
                return [{
                    name,
                    kind: "namespace",
                    range: rangeFromNode(node, document),
                    selectionRange: rangeFromNode(nameNode, document),
                }];
            }
        }

        if (node instanceof ContextItemDeclContext) {
            return [{
                name: "context item",
                kind: "context-item",
                range: rangeFromNode(node, document),
                selectionRange: {
                    start: rangeFromNode(node.Kcontext(), document).start,
                    end: rangeFromNode(node.Kitem(), document).end,
                },
            }];
        }

        if (node instanceof TypeDeclContext) {
            const nameNode = node.qname();
            const name = nameNode.getText().trim();
            if (name !== "") {
                return [{
                    name,
                    kind: "type",
                    range: rangeFromNode(node, document),
                    selectionRange: rangeFromNode(nameNode, document),
                }];
            }
        }

        if (node instanceof FunctionDeclContext) {
            const name = functionNameWithArityOrNull(node);
            const selectionNode = node._fn_name ?? node.qname();
            if (name !== null && selectionNode !== null) {
                return [{
                    name,
                    kind: "function",
                    range: rangeFromNode(node, document),
                    selectionRange: rangeFromNode(selectionNode, document),
                }];
            }
        }

        if (node instanceof ParamContext) {
            const qname = node.qname();
            const name = qname?.getText().trim();
            if (qname !== null && name !== undefined && name !== "") {
                const dollarRange = rangeFromNode(node.Kdollar(), document);
                const qnameRange = rangeFromNode(qname, document);
                return [{
                    name: `$${name}`,
                    kind: "parameter",
                    range: rangeFromNode(node, document),
                    selectionRange: {
                        start: dollarRange.start,
                        end: qnameRange.end,
                    },
                }];
            }
        }

        if (node instanceof VarDeclContext) {
            const declaration = events.variable("declare-variable", node, node.varRef());
            return declaration === undefined ? [] : [declaration];
        }

        if (node instanceof ForVarContext) {
            return node.varRef()
                .map((varRef, index) => events.variable(index === 0 ? "for" : "for-position", node, varRef))
                .filter((declaration): declaration is SemanticDeclaration => declaration !== undefined);
        }

        if (node instanceof LetVarContext) {
            const declaration = events.variable("let", node, node.varRef());
            return declaration === undefined ? [] : [declaration];
        }

        if (node instanceof GroupByVarContext) {
            const declaration = events.variable("group-by", node, node.varRef());
            return declaration === undefined ? [] : [declaration];
        }

        if (node instanceof CountClauseContext) {
            const declaration = events.variable("count", node, node.varRef());
            return declaration === undefined ? [] : [declaration];
        }

        return [];
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

    const visit = (node: ParseTree): void => {
        const declarations = collectDeclarations(node);
        for (const declaration of declarations) {
            events.enterDeclaration(declaration);
        }

        const scopeKind = getScopeKind(node);
        if (scopeKind !== null) {
            events.scope(rangeFromNode(node, document), true, scopeKind);
        }

        collectReferencesBeforeChildren(node);

        for (let index = 0; index < node.getChildCount(); index += 1) {
            const child = node.getChild(index);
            if (child !== null) {
                visit(child);
            }
        }

        if (scopeKind !== null) {
            events.scope(rangeFromNode(node, document), false, scopeKind);
        }

        for (let index = declarations.length - 1; index >= 0; index -= 1) {
            events.exitDeclaration(declarations[index]!);
        }
    };

    visit(tree);

    return events.collectedEvents;
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
