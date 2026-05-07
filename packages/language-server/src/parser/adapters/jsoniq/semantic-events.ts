import { ParseTreeWalker, type ParseTree } from "antlr4ng";
import { type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { jsoniqListener } from "./grammar/jsoniqListener.js";
import {
    ContextItemDeclContext,
    CountClauseContext,
    DeclaredVarRefContext,
    FlowrExprContext,
    FlowrStatementContext,
    ForVarContext,
    FunctionCallContext,
    FunctionDeclContext,
    GroupByVarContext,
    LetVarContext,
    NamedFunctionRefContext,
    NamespaceDeclContext,
    ParamContext,
    TypeDeclContext,
    VarDeclContext,
    VarRefContext,
    type ModuleAndThisIsItContext,
} from "./grammar/jsoniqParser.js";
import type {
    SemanticDeclaration,
    SemanticEvent,
    SemanticReferenceEvent,
    ScopeKind,
} from "server/parser/types/semantic-events.js";
import { functionNameWithArityOrNull, varRefNameOrNull } from "./name.js";
import { rangeFromNode } from "server/utils/range.js";

class SemanticEventCollector {
    private events: SemanticEvent[] = [];

    constructor(private readonly document: TextDocument) {}

    get collectedEvents(): readonly SemanticEvent[] {
        return this.events;
    }

    public enterDeclaration(declaration: SemanticDeclaration | undefined): void {
        if (declaration !== undefined) {
            this.events.push({ type: "enterDeclaration", declaration });
        }
    }

    public exitDeclaration(declaration: SemanticDeclaration | undefined): void {
        if (declaration !== undefined) {
            this.events.push({ type: "exitDeclaration", declaration });
        }
    }

    public reference(name: string, kind: SemanticReferenceEvent["kind"], range: Range): void {
        this.events.push({ type: "reference", name, kind, range });
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
    }

    public scope(node: ParseTree, enter: boolean, scopeKind: ScopeKind): void {
        this.events.push({
            type: enter ? "enterScope" : "exitScope",
            range: rangeFromNode(node, this.document),
            scopeKind,
        });
    }
}

class JsoniqSemanticEventListener extends jsoniqListener {
    private readonly declarationStack: SemanticDeclaration[][] = [];

    constructor(
        private readonly document: TextDocument,
        private readonly events: SemanticEventCollector,
    ) {
        super();
    }

    public override enterNamespaceDecl = (node: NamespaceDeclContext): void => {
        const nameNode = node.NCName();
        const name = nameNode.getText().trim();
        this.enter(
            name === ""
                ? []
                : [
                      {
                          name,
                          kind: "namespace",
                          range: rangeFromNode(node, this.document),
                          selectionRange: rangeFromNode(nameNode, this.document),
                      },
                  ],
        );
    };

    public override exitNamespaceDecl = this.exit;

    public override enterContextItemDecl = (node: ContextItemDeclContext): void => {
        this.enter([this.contextItemDeclaration(node)]);
    };

    public override exitContextItemDecl = this.exit;

    public override enterTypeDecl = (node: TypeDeclContext): void => {
        const nameNode = node._type_name ?? node.declaredQName();
        const name = nameNode.getText().trim();
        this.enter(
            name === ""
                ? []
                : [
                      {
                          name,
                          kind: "type",
                          range: rangeFromNode(node, this.document),
                          selectionRange: rangeFromNode(nameNode, this.document),
                      },
                  ],
        );
    };

    public override exitTypeDecl = this.exit;

    public override enterFunctionDecl = (node: FunctionDeclContext): void => {
        const name = functionNameWithArityOrNull(node);
        const selectionNode = node.declaredQName();
        this.enter(
            name === null || selectionNode === null
                ? []
                : [
                      {
                          name,
                          kind: "function",
                          range: rangeFromNode(node, this.document),
                          selectionRange: rangeFromNode(selectionNode, this.document),
                      },
                  ],
        );
        this.events.scope(node, true, "function");
    };

    public override exitFunctionDecl = (node: FunctionDeclContext): void => {
        this.events.scope(node, false, "function");
        this.exit();
    };

    public override enterParam = (node: ParamContext): void => {
        const declaration = this.parameterDeclaration(node);
        this.enter(declaration === undefined ? [] : [declaration]);
    };

    public override exitParam = this.exit;

    public override enterVarDecl = (node: VarDeclContext): void => {
        const declaration = this.events.variable(
            "declare-variable",
            node,
            node.declaredVarRef().varRef(),
        );
        if (declaration !== undefined && node.Ksemicolon().symbol.start < 0) {
            declaration.completed = false;
        }
        this.enter(declaration === undefined ? [] : [declaration]);
    };

    public override exitVarDecl = this.exit;

    public override enterForVar = (node: ForVarContext): void => {
        this.enter(this.forVarDeclarations(node));
    };

    public override exitForVar = this.exit;

    public override enterLetVar = (node: LetVarContext): void => {
        const declaration = this.events.variable("let", node, node.declaredVarRef().varRef());
        this.enter(declaration === undefined ? [] : [declaration]);
    };

    public override exitLetVar = this.exit;

    public override enterGroupByVar = (node: GroupByVarContext): void => {
        const declaration = this.events.variable("group-by", node, node.declaredVarRef().varRef());
        this.enter(declaration === undefined ? [] : [declaration]);
    };

    public override exitGroupByVar = this.exit;

    public override enterCountClause = (node: CountClauseContext): void => {
        const declaration = this.events.variable("count", node, node.declaredVarRef().varRef());
        this.enter(declaration === undefined ? [] : [declaration]);
    };

    public override exitCountClause = this.exit;

    public override enterFlowrExpr = (node: FlowrExprContext): void => {
        this.events.scope(node, true, "flowr");
    };

    public override exitFlowrExpr = (node: FlowrExprContext): void => {
        this.events.scope(node, false, "flowr");
    };

    public override enterFlowrStatement = (node: FlowrStatementContext): void => {
        this.events.scope(node, true, "flowr");
    };

    public override exitFlowrStatement = (node: FlowrStatementContext): void => {
        this.events.scope(node, false, "flowr");
    };

    public override enterVarRef = (node: VarRefContext): void => {
        if (node.parent instanceof DeclaredVarRefContext) {
            return;
        }

        const name = varRefNameOrNull(node);
        if (name !== null) {
            this.events.reference(name, "variable", rangeFromNode(node, this.document));
        }
    };

    public override enterFunctionCall = (node: FunctionCallContext): void => {
        this.functionReference(node);
    };

    public override enterNamedFunctionRef = (node: NamedFunctionRefContext): void => {
        this.functionReference(node);
    };

    private enter(declarations: SemanticDeclaration[]): void {
        this.declarationStack.push(declarations);
        for (const declaration of declarations) {
            this.events.enterDeclaration(declaration);
        }
    }

    private exit(): void {
        const declarations = this.declarationStack.pop() ?? [];
        for (let index = declarations.length - 1; index >= 0; index -= 1) {
            this.events.exitDeclaration(declarations[index]);
        }
    }

    private contextItemDeclaration(node: ContextItemDeclContext): SemanticDeclaration {
        return {
            name: "context item",
            kind: "context-item",
            range: rangeFromNode(node, this.document),
            selectionRange: {
                start: rangeFromNode(node.Kcontext(), this.document).start,
                end: rangeFromNode(node.Kitem(), this.document).end,
            },
        };
    }

    private parameterDeclaration(node: ParamContext): SemanticDeclaration | undefined {
        const declaredVarRef = node.declaredVarRef();
        const name = varRefNameOrNull(declaredVarRef.varRef());
        if (name === null) {
            return undefined;
        }

        return {
            name,
            kind: "parameter",
            range: rangeFromNode(node, this.document),
            selectionRange: rangeFromNode(declaredVarRef, this.document),
        };
    }

    private forVarDeclarations(node: ForVarContext): SemanticDeclaration[] {
        return node
            .declaredVarRef()
            .map((declaredVarRef, index) =>
                this.events.variable(
                    index === 0 ? "for" : "for-position",
                    node,
                    declaredVarRef.varRef(),
                ),
            )
            .filter((declaration): declaration is SemanticDeclaration => declaration !== undefined);
    }

    private functionReference(node: FunctionCallContext | NamedFunctionRefContext): void {
        const nameNode = node._fn_name ?? node.qname();
        const name = functionNameWithArityOrNull(node);
        if (name !== null && nameNode !== null) {
            this.events.reference(name, "function", rangeFromNode(nameNode, this.document));
        }
    }
}

export function collectSemanticEvents(
    tree: ModuleAndThisIsItContext,
    document: TextDocument,
): readonly SemanticEvent[] {
    const events = new SemanticEventCollector(document);
    ParseTreeWalker.DEFAULT.walk(new JsoniqSemanticEventListener(document, events), tree);
    return events.collectedEvents;
}
