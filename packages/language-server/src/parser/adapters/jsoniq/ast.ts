import type { ParseTree } from "antlr4ng";
import {
    attachParents,
    type AstNode,
    type CatchClauseAstNode,
    type FunctionCallAstNode,
    type FunctionDeclarationAstNode,
    type JsoniqAst,
    type NamedFunctionReferenceAstNode,
} from "server/parser/types/ast.js";
import type {
    AnyAstDeclaration,
    AstDeclaration,
    AstParameterDeclaration,
    VariableKind,
} from "server/parser/types/declaration.js";
import { rangeFromNode } from "server/utils/range.js";
import { TextDocument } from "vscode-languageserver-textdocument";

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
import { jsoniqVisitor } from "./grammar/jsoniqVisitor.js";
import { parseFunctionName, parseQname, parseVarName } from "./name.js";

type AstVisitResult = AstNode | AstNode[] | undefined;

const CATCH_VARIABLES = [
    { qname: { prefix: "err", localName: "code" } },
    { qname: { prefix: "err", localName: "description" } },
    { qname: { prefix: "err", localName: "value" } },
    { qname: { prefix: "err", localName: "module" } },
    { qname: { prefix: "err", localName: "line-number" } },
    { qname: { prefix: "err", localName: "column-number" } },
    { qname: { prefix: "err", localName: "additional" } },
] as const;

class JsoniqAstBuilder extends jsoniqVisitor<AstVisitResult> {
    public constructor(private readonly document: TextDocument) {
        super();
    }

    protected override defaultResult(): AstVisitResult {
        return undefined;
    }

    protected override aggregateResult(
        aggregate: AstVisitResult | null,
        nextResult: AstVisitResult | null,
    ): AstVisitResult {
        return [...asNodes(aggregate), ...asNodes(nextResult)];
    }

    public override visitModuleAndThisIsIt = (node: ModuleAndThisIsItContext): AstVisitResult => ({
        kind: "module",
        range: rangeFromNode(node, this.document),
        children: this.visitChildrenAsNodes(node),
    });

    public override visitNamespaceDecl = (node: NamespaceDeclContext): AstVisitResult => {
        const nameNode = node.NCName();
        if (nameNode === null) {
            return undefined;
        }

        const prefix = nameNode.getText().trim();
        if (prefix === "") {
            return undefined;
        }

        const namespaceUriNode = node.uriLiteral();
        if (namespaceUriNode === null) {
            return undefined;
        }

        return this.declaration({
            name: { prefix },
            kind: "namespace",
            extra: { namespaceUri: namespaceUriNode.getText() },
            range: rangeFromNode(node, this.document),
            selectionRange: rangeFromNode(nameNode, this.document),
        });
    };

    public override visitContextItemDecl = (node: ContextItemDeclContext): AstVisitResult =>
        this.declaration({
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

    public override visitContextItemExpr = (node: ContextItemExprContext): AstVisitResult => ({
        kind: "contextItemExpression",
        name: { qname: { localName: "$" } },
        range: rangeFromNode(node, this.document),
        children: [],
    });

    public override visitTypeDecl = (node: TypeDeclContext): AstVisitResult => {
        const nameNode = node.declaredQName().qname();
        const name = { qname: parseQname(nameNode) };
        return this.declaration(this.createDeclaration(name, "type", node, nameNode));
    };

    public override visitFunctionDecl = (node: FunctionDeclContext): AstVisitResult =>
        ({
            kind: "functionDeclaration",
            range: rangeFromNode(node, this.document),
            declaration: this.createDeclaration(
                parseFunctionName(node),
                "function",
                node,
                node.declaredQName(),
                {
                    extra: { parameters: this.parameterDeclarations(node) },
                },
            ),
            children: this.visitChildrenAsNodes(node),
        }) satisfies FunctionDeclarationAstNode;

    public override visitVarDecl = (node: VarDeclContext): AstVisitResult => {
        const declaration = this.variableDeclaration(
            "declare-variable",
            node,
            node.declaredVarRef(),
        );
        if (declaration !== null) {
            const semicolon = node.Ksemicolon();
            declaration.completed = semicolon !== null && semicolon.symbol.start >= 0;
        }

        return [...asNodes(this.declaration(declaration)), ...this.visitChildrenAsNodes(node)];
    };

    public override visitForVar = (node: ForVarContext): AstVisitResult => [
        ...node
            .declaredVarRef()
            .flatMap((declaredVarRef, index) =>
                asNodes(
                    this.declaration(
                        this.variableDeclaration(
                            index === 0 ? "for" : "for-position",
                            node,
                            declaredVarRef,
                        ),
                    ),
                ),
            ),
        ...this.visitChildrenAsNodes(node),
    ];

    public override visitLetVar = (node: LetVarContext): AstVisitResult => [
        ...asNodes(this.declaration(this.variableDeclaration("let", node, node.declaredVarRef()))),
        ...this.visitChildrenAsNodes(node),
    ];

    public override visitGroupByVar = (node: GroupByVarContext): AstVisitResult => [
        ...asNodes(
            this.declaration(this.variableDeclaration("group-by", node, node.declaredVarRef())),
        ),
        ...this.visitChildrenAsNodes(node),
    ];

    public override visitCountClause = (node: CountClauseContext): AstVisitResult => [
        ...asNodes(
            this.declaration(this.variableDeclaration("count", node, node.declaredVarRef())),
        ),
        ...this.visitChildrenAsNodes(node),
    ];

    public override visitFlowrExpr = (node: FlowrExprContext): AstVisitResult => ({
        kind: "flowrExpression",
        range: rangeFromNode(node, this.document),
        children: this.visitChildrenAsNodes(node),
    });

    public override visitFlowrStatement = (node: FlowrStatementContext): AstVisitResult => ({
        kind: "flowrExpression",
        range: rangeFromNode(node, this.document),
        children: this.visitChildrenAsNodes(node),
    });

    public override visitVarRef = (node: VarRefContext): AstVisitResult => {
        if (node.parent instanceof DeclaredVarRefContext) {
            return undefined;
        }

        const name = parseVarName(node);
        return name === null
            ? undefined
            : {
                  kind: "variableReference",
                  name,
                  range: rangeFromNode(node, this.document),
                  children: [],
              };
    };

    public override visitFunctionCall = (node: FunctionCallContext): AstVisitResult =>
        this.functionCall(node);

    public override visitNamedFunctionRef = (node: NamedFunctionRefContext): AstVisitResult =>
        this.namedFunctionReference(node);

    public override visitCatchCaseStatement = (node: CatchCaseStatementContext): AstVisitResult =>
        this.catchClause(node);

    public override visitCatchClause = (node: CatchClauseContext): AstVisitResult =>
        this.catchClause(node);

    private visitChildrenAsNodes(node: ParseTree): AstNode[] {
        return asNodes(this.visitChildren(node));
    }

    private createDeclaration<K extends AnyAstDeclaration["kind"]>(
        name: AstDeclaration<K>["name"],
        kind: K,
        node: ParseTree,
        selectNode: ParseTree = node,
        extra: Partial<AstDeclaration<K>> = {},
    ): AstDeclaration<K> {
        return {
            name,
            kind,
            range: rangeFromNode(node, this.document),
            selectionRange: rangeFromNode(selectNode, this.document),
            ...extra,
        } as AstDeclaration<K>;
    }

    private declaration(declaration: AnyAstDeclaration | null): AstVisitResult {
        return declaration === null
            ? undefined
            : {
                  kind: "declaration",
                  declaration,
                  range: declaration.range,
                  children: [],
              };
    }

    private variableDeclaration(
        kind: VariableKind,
        declarationNode: ParseTree,
        declaredVarRef: DeclaredVarRefContext,
    ): AstDeclaration<VariableKind> | null {
        const name = parseVarName(declaredVarRef.varRef());
        return name === null
            ? null
            : this.createDeclaration(name, kind, declarationNode, declaredVarRef.varRef());
    }

    private parameterDeclarations(node: FunctionDeclContext): AstParameterDeclaration[] {
        const declarations: AstParameterDeclaration[] = [];

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

    private functionCall(node: FunctionCallContext): AstVisitResult {
        const nameNode = node.qname();
        const name = parseFunctionName(node);
        return name !== null && nameNode !== null
            ? ({
                  kind: "functionCall",
                  name,
                  nameRange: rangeFromNode(nameNode, this.document),
                  range: rangeFromNode(node, this.document),
                  children: this.visitChildrenAsNodes(node),
              } satisfies FunctionCallAstNode)
            : undefined;
    }

    private namedFunctionReference(node: NamedFunctionRefContext): AstVisitResult {
        const nameNode = node.qname();
        const name = parseFunctionName(node);
        return name !== null && nameNode !== null
            ? ({
                  kind: "namedFunctionReference",
                  name,
                  nameRange: rangeFromNode(nameNode, this.document),
                  range: rangeFromNode(node, this.document),
                  children: [],
              } satisfies NamedFunctionReferenceAstNode)
            : undefined;
    }

    private catchClause(node: CatchCaseStatementContext | CatchClauseContext): CatchClauseAstNode {
        return {
            kind: "catchClause",
            range: rangeFromNode(node, this.document),
            declarations: this.catchDeclarations(node),
            children: this.visitChildrenAsNodes(node),
        };
    }

    private catchDeclarations(
        node: CatchCaseStatementContext | CatchClauseContext,
    ): Extract<AnyAstDeclaration, { kind: "catch-variable" }>[] {
        const catchNode = node.Kcatch();

        return CATCH_VARIABLES.map((name) => ({
            name,
            kind: "catch-variable",
            range: rangeFromNode(catchNode, this.document),
            selectionRange: rangeFromNode(catchNode, this.document),
        }));
    }
}

function asNodes(result: AstVisitResult | null): AstNode[] {
    if (result === null || result === undefined) {
        return [];
    }

    return Array.isArray(result) ? result : [result];
}

export function buildJsoniqAst(tree: ModuleAndThisIsItContext, document: TextDocument): JsoniqAst {
    const ast = new JsoniqAstBuilder(document).visit(tree);
    const module = asNodes(ast)[0];

    if (module?.kind !== "module") {
        return attachParents({
            kind: "module",
            range: rangeFromNode(tree, document),
            children: asNodes(ast),
        });
    }

    return attachParents(module);
}
