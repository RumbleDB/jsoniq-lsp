import { ParseTreeWalker, type ParseTree } from "antlr4ng";
import type { VariableKind } from "server/parser/types/declaration.js";
import type { ReferenceNameByKind } from "server/parser/types/name.js";
import type {
    AnySemanticDeclaration,
    SemanticDeclaration,
    SemanticEvent,
    SemanticParameterDeclaration,
    ScopeKind,
} from "server/parser/types/semantic-events.js";
import { rangeFromNode } from "server/utils/range.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import { jsoniqListener } from "./grammar/jsoniqListener.js";
import {
    CatchCaseStatementContext,
    CatchClauseContext,
    ContextItemDeclContext,
    ContextItemExprContext,
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
    TypeDeclContext,
    VarDeclContext,
    VarRefContext,
    type ModuleAndThisIsItContext,
} from "./grammar/jsoniqParser.js";
import { parseFunctionName, parseQname, parseVarName } from "./name.js";

const CATCH_VARIABLES = [
    { qname: { prefix: "err", localName: "code" } },
    { qname: { prefix: "err", localName: "description" } },
    { qname: { prefix: "err", localName: "value" } },
    { qname: { prefix: "err", localName: "module" } },
    { qname: { prefix: "err", localName: "line-number" } },
    { qname: { prefix: "err", localName: "column-number" } },
    { qname: { prefix: "err", localName: "additional" } },
] as const;

class SemanticEventCollector {
    private events: SemanticEvent[] = [];

    constructor(private readonly document: TextDocument) {}

    get collectedEvents(): readonly SemanticEvent[] {
        return this.events;
    }

    public declaration(declaration: AnySemanticDeclaration): void {
        this.events.push({ type: "declaration", declaration });
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

        this.declare(declaration);
    };

    public override enterContextItemDecl = (node: ContextItemDeclContext): void => {
        this.declare({
            name: {
                qname: {
                    localName: "$",
                },
            },
            kind: "declare-variable",
            range: rangeFromNode(node, this.document),
            selectionRange: {
                start: rangeFromNode(node.Kcontext(), this.document).start,
                end: rangeFromNode(node.Kitem(), this.document).end,
            },
        });
    };

    public override enterContextItemExpr = (node: ContextItemExprContext): void => {
        this.events.reference({ qname: { localName: "$" } }, "variable", node);
    };

    public override enterTypeDecl = (node: TypeDeclContext): void => {
        const nameNode = node.declaredQName().qname();
        const name = { qname: parseQname(nameNode) };
        this.declare(this.createDeclaration(name, "type", node, nameNode));
    };

    public override enterFunctionDecl = (node: FunctionDeclContext): void => {
        const parameters = this.parameterDeclarations(node);
        this.declare(
            this.createDeclaration(
                parseFunctionName(node),
                "function",
                node,
                node.declaredQName(),
                {
                    extra: { parameters },
                },
            ),
        );
        this.events.scope(node, true, "function");
    };

    public override exitFunctionDecl = (node: FunctionDeclContext): void => {
        this.events.scope(node, false, "function");
    };

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

        this.declare(declaration);
    };

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

        this.declareAll(declarations);
    };

    public override enterLetVar = (node: LetVarContext): void => {
        this.declare(this.variableDeclaration("let", node, node.declaredVarRef()));
    };

    public override enterGroupByVar = (node: GroupByVarContext): void => {
        this.declare(this.variableDeclaration("group-by", node, node.declaredVarRef()));
    };

    public override enterCountClause = (node: CountClauseContext): void => {
        this.declare(this.variableDeclaration("count", node, node.declaredVarRef()));
    };

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

    public override enterCatchCaseStatement = (node: CatchCaseStatementContext): void => {
        this.events.scope(node, true, "catch");
        this.declareAll(this.catchDeclarations(node));
    };

    public override exitCatchCaseStatement = (node: CatchCaseStatementContext): void => {
        this.events.scope(node, false, "catch");
    };

    public override enterCatchClause = (node: CatchClauseContext): void => {
        this.events.scope(node, true, "catch");
        this.declareAll(this.catchDeclarations(node));
    };

    public override exitCatchClause = (node: CatchClauseContext): void => {
        this.events.scope(node, false, "catch");
    };

    private declare(declaration: AnySemanticDeclaration | null): void {
        this.declareAll(declaration === null ? [] : [declaration]);
    }

    private declareAll(declarations: AnySemanticDeclaration[]): void {
        for (const declaration of declarations) {
            this.events.declaration(declaration);
        }
    }

    private variableDeclaration(
        kind: VariableKind,
        declarationNode: ParseTree,
        declaredVarRef: DeclaredVarRefContext,
    ): SemanticDeclaration<VariableKind> | null {
        const name = parseVarName(declaredVarRef.varRef());
        return name === null
            ? null
            : this.createDeclaration(name, kind, declarationNode, declaredVarRef.varRef());
    }

    private parameterDeclarations(node: FunctionDeclContext): SemanticParameterDeclaration[] {
        const declarations: SemanticParameterDeclaration[] = [];

        for (const param of node.paramList()?.param() ?? []) {
            const paramName = parseVarName(param.declaredVarRef().varRef());
            if (paramName === null) {
                continue;
            }

            declarations.push(
                this.createDeclaration(paramName, "parameter", param, param.declaredVarRef()),
            );
        }

        return declarations;
    }

    private functionReference(node: FunctionCallContext | NamedFunctionRefContext): void {
        const nameNode = node.qname();
        const name = parseFunctionName(node);
        if (name !== null && nameNode !== null) {
            this.events.reference(name, "function", nameNode);
        }
    }

    private catchDeclarations(
        node: CatchCaseStatementContext | CatchClauseContext,
    ): AnySemanticDeclaration[] {
        const catchNode = node.Kcatch();

        return CATCH_VARIABLES.map((name) => ({
            name,
            kind: "catch-variable",
            range: rangeFromNode(catchNode, this.document),
            selectionRange: rangeFromNode(catchNode, this.document),
        }));
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
