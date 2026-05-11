import { ParseTreeWalker, type ParseTree } from "antlr4ng";
import type { SemanticDeclarationKind } from "server/parser/types/declaration.js";
import type {
    SemanticDeclaration,
    SemanticEvent,
    SemanticNamespaceDeclaration,
    SemanticReferenceEvent,
    ScopeKind,
} from "server/parser/types/semantic-events.js";
import { rangeFromNode } from "server/utils/range.js";
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
import { functionNameWithArityOrNull, varRefNameOrNull } from "./name.js";

class SemanticEventCollector {
    private events: SemanticEvent[] = [];

    constructor(private readonly document: TextDocument) {}

    get collectedEvents(): readonly SemanticEvent[] {
        return this.events;
    }

    public enterDeclaration(declaration: SemanticDeclaration): void {
        this.events.push({ type: "enterDeclaration", declaration });
    }

    public exitDeclaration(declaration: SemanticDeclaration): void {
        this.events.push({ type: "exitDeclaration", declaration });
    }

    public reference(name: string, kind: SemanticReferenceEvent["kind"], node: ParseTree): void {
        this.events.push({
            type: "reference",
            name,
            kind,
            range: rangeFromNode(node, this.document),
        });
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
        const prefix = nameNode.getText().trim();
        if (prefix === "") {
            this.enter([]);
            return;
        }

        const declaration = {
            name: prefix,
            kind: "namespace",
            prefix: prefix,
            namespaceUri: node.uriLiteral().getText(),
            range: rangeFromNode(node, this.document),
            selectionRange: rangeFromNode(nameNode, this.document),
        } satisfies SemanticNamespaceDeclaration;

        this.enter([declaration]);
    };

    public override exitNamespaceDecl = this.exit;

    public override enterContextItemDecl = (node: ContextItemDeclContext): void => {
        this.enter([this.contextItemDeclaration(node)]);
    };

    public override exitContextItemDecl = this.exit;

    public override enterTypeDecl = (node: TypeDeclContext): void => {
        const nameNode = node.declaredQName();
        this.enter(this.declaration("type", nameNode.getText(), node, nameNode));
    };

    public override exitTypeDecl = this.exit;

    public override enterFunctionDecl = (node: FunctionDeclContext): void => {
        this.enter(
            this.declaration(
                "function",
                functionNameWithArityOrNull(node),
                node,
                node.declaredQName(),
            ),
        );
        this.events.scope(node, true, "function");
    };

    public override exitFunctionDecl = (node: FunctionDeclContext): void => {
        this.events.scope(node, false, "function");
        this.exit();
    };

    public override enterParam = (node: ParamContext): void => {
        this.enter(this.variableDeclaration("parameter", node, node.declaredVarRef()));
    };

    public override exitParam = this.exit;

    public override enterVarDecl = (node: VarDeclContext): void => {
        const declarations = this.variableDeclaration(
            "declare-variable",
            node,
            node.declaredVarRef(),
        );
        const semicolon = node.Ksemicolon();
        if (semicolon === null || semicolon.symbol.start < 0) {
            for (const declaration of declarations) {
                declaration.completed = false;
            }
        }
        this.enter(declarations);
    };

    public override exitVarDecl = this.exit;

    public override enterForVar = (node: ForVarContext): void =>
        this.enter(this.forVarDeclarations(node));

    public override exitForVar = this.exit;

    public override enterLetVar = (node: LetVarContext): void => {
        this.enter(this.variableDeclaration("let", node, node.declaredVarRef()));
    };

    public override exitLetVar = this.exit;

    public override enterGroupByVar = (node: GroupByVarContext): void => {
        this.enter(this.variableDeclaration("group-by", node, node.declaredVarRef()));
    };

    public override exitGroupByVar = this.exit;

    public override enterCountClause = (node: CountClauseContext): void => {
        this.enter(this.variableDeclaration("count", node, node.declaredVarRef()));
    };

    public override exitCountClause = this.exit;

    public override enterFlowrExpr = (node: FlowrExprContext): void =>
        this.events.scope(node, true, "flowr");

    public override exitFlowrExpr = (node: FlowrExprContext): void =>
        this.events.scope(node, false, "flowr");

    public override enterFlowrStatement = (node: FlowrStatementContext): void =>
        this.events.scope(node, true, "flowr");

    public override exitFlowrStatement = (node: FlowrStatementContext): void =>
        this.events.scope(node, false, "flowr");

    public override enterVarRef = (node: VarRefContext): void => {
        if (node.parent instanceof DeclaredVarRefContext) {
            return;
        }

        const name = varRefNameOrNull(node);
        if (name !== null) {
            this.events.reference(name, "variable", node);
        }
    };

    public override enterFunctionCall = (node: FunctionCallContext): void =>
        this.functionReference(node);

    public override enterNamedFunctionRef = (node: NamedFunctionRefContext): void =>
        this.functionReference(node);

    private enter(declarations: SemanticDeclaration[]): void {
        this.declarationStack.push(declarations);
        for (const declaration of declarations) {
            this.events.enterDeclaration(declaration);
        }
    }

    private exit(): void {
        const declarations = this.declarationStack.pop() ?? [];
        let declaration = declarations.pop();
        while (declaration !== undefined) {
            this.events.exitDeclaration(declaration);
            declaration = declarations.pop();
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

    private declaration(
        kind: SemanticDeclarationKind,
        name: string | null,
        declarationNode: ParseTree,
        selectionNode: ParseTree | null,
    ): SemanticDeclaration[] {
        const trimmedName = name?.trim();
        if (trimmedName === undefined || trimmedName === "" || selectionNode === null) {
            return [];
        }

        return [
            {
                name: trimmedName,
                kind,
                range: rangeFromNode(declarationNode, this.document),
                selectionRange: rangeFromNode(selectionNode, this.document),
            },
        ];
    }

    private variableDeclaration(
        kind: SemanticDeclarationKind,
        declarationNode: ParseTree,
        declaredVarRef: DeclaredVarRefContext,
    ): SemanticDeclaration[] {
        return this.declaration(
            kind,
            varRefNameOrNull(declaredVarRef.varRef()),
            declarationNode,
            declaredVarRef,
        );
    }

    private forVarDeclarations(node: ForVarContext): SemanticDeclaration[] {
        const declarations: SemanticDeclaration[] = [];
        for (const [index, declaredVarRef] of node.declaredVarRef().entries()) {
            declarations.push(
                ...this.variableDeclaration(
                    index === 0 ? "for" : "for-position",
                    node,
                    declaredVarRef,
                ),
            );
        }
        return declarations;
    }

    private functionReference(node: FunctionCallContext | NamedFunctionRefContext): void {
        const nameNode = node._fn_name ?? node.qname();
        const name = functionNameWithArityOrNull(node);
        if (name !== null && nameNode !== null) {
            this.events.reference(name, "function", nameNode);
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
