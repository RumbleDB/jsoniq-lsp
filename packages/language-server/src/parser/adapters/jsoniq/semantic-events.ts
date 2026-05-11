import { ParseTreeWalker, type ParseTree } from "antlr4ng";
import type { VariableKind } from "server/parser/types/declaration.js";
import type { ReferenceNameByKind } from "server/parser/types/name.js";
import type {
    AnySemanticDeclaration,
    SemanticDeclaration,
    SemanticEvent,
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
import { parseFunctionName, parseQname, parseVarName } from "./name.js";

class SemanticEventCollector {
    private events: SemanticEvent[] = [];

    constructor(private readonly document: TextDocument) {}

    get collectedEvents(): readonly SemanticEvent[] {
        return this.events;
    }

    public enterDeclaration(declaration: AnySemanticDeclaration): void {
        this.events.push({ type: "enterDeclaration", declaration });
    }

    public exitDeclaration(declaration: AnySemanticDeclaration): void {
        this.events.push({ type: "exitDeclaration", declaration });
    }

    public reference<K extends keyof ReferenceNameByKind>(
        name: ReferenceNameByKind[K],
        kind: K,
        node: ParseTree,
    ): void {
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
    private readonly declarationStack: AnySemanticDeclaration[][] = [];

    constructor(
        private readonly document: TextDocument,
        private readonly events: SemanticEventCollector,
    ) {
        super();
    }

    private createDeclaration<K extends AnySemanticDeclaration["kind"]>(
        name: SemanticDeclaration<K>["name"],
        kind: K,
        node: ParseTree,
        selectNode: ParseTree = node,
        extra: Partial<SemanticDeclaration<K>> = {},
    ): SemanticDeclaration<K> {
        return {
            name,
            kind,
            range: rangeFromNode(node, this.document),
            selectionRange: rangeFromNode(selectNode, this.document),
            ...extra,
        } as SemanticDeclaration<K>;
    }

    public override enterNamespaceDecl = (node: NamespaceDeclContext): void => {
        const nameNode = node.NCName();
        if (nameNode === null) {
            return;
        }

        const prefix = nameNode.getText().trim();
        if (prefix === "") {
            return;
        }

        const namespaceUriNode = node.uriLiteral();
        if (namespaceUriNode === null) {
            return;
        }

        const declaration = {
            name: { prefix },
            kind: "namespace",
            extra: { namespaceUri: namespaceUriNode.getText() },
            range: rangeFromNode(node, this.document),
            selectionRange: rangeFromNode(nameNode, this.document),
        } satisfies SemanticDeclaration<"namespace">;

        this.enter(declaration);
    };

    public override exitNamespaceDecl = this.exit;

    public override enterContextItemDecl = (node: ContextItemDeclContext): void => {
        this.enter({
            name: { label: "context item" },
            kind: "context-item",
            range: rangeFromNode(node, this.document),
            selectionRange: {
                start: rangeFromNode(node.Kcontext(), this.document).start,
                end: rangeFromNode(node.Kitem(), this.document).end,
            },
        });
    };

    public override exitContextItemDecl = this.exit;

    public override enterTypeDecl = (node: TypeDeclContext): void => {
        const nameNode = node.declaredQName().qname();
        const name = { qname: parseQname(nameNode) };
        this.enter(this.createDeclaration(name, "type", node, nameNode));
    };

    public override exitTypeDecl = this.exit;

    public override enterFunctionDecl = (node: FunctionDeclContext): void => {
        this.enter(
            this.createDeclaration(parseFunctionName(node), "function", node, node.declaredQName()),
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
        const semicolon = node.Ksemicolon();

        const declaration = this.variableDeclaration(
            "declare-variable",
            node,
            node.declaredVarRef(),
        );
        if (declaration !== null) {
            declaration.completed = semicolon !== null && semicolon.symbol.start >= 0;
        }

        this.enter(declaration);
    };

    public override exitVarDecl = this.exit;

    public override enterForVar = (node: ForVarContext): void => {
        const declarations: AnySemanticDeclaration[] = [];

        for (const [index, declaredVarRef] of node.declaredVarRef().entries()) {
            const declaration = this.variableDeclaration(
                index === 0 ? "for" : "for-position",
                node,
                declaredVarRef,
            );
            if (declaration !== null) {
                declarations.push(declaration);
            }
        }

        this.enterAll(declarations);
    };

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

        const name = parseVarName(node);
        if (name !== null) {
            this.events.reference(name, "variable", node);
        }
    };

    public override enterFunctionCall = (node: FunctionCallContext): void =>
        this.functionReference(node);

    public override enterNamedFunctionRef = (node: NamedFunctionRefContext): void =>
        this.functionReference(node);

    private enter(declaration: AnySemanticDeclaration | null): void {
        this.enterAll(declaration === null ? [] : [declaration]);
    }

    private enterAll(declarations: AnySemanticDeclaration[]): void {
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

    private variableDeclaration(
        kind: VariableKind | "parameter",
        declarationNode: ParseTree,
        declaredVarRef: DeclaredVarRefContext,
    ): SemanticDeclaration<VariableKind | "parameter"> | null {
        const name = parseVarName(declaredVarRef.varRef());
        return name === null
            ? null
            : this.createDeclaration(name, kind, declarationNode, declaredVarRef.varRef());
    }

    private functionReference(node: FunctionCallContext | NamedFunctionRefContext): void {
        const nameNode = node.qname();
        const name = parseFunctionName(node);
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
