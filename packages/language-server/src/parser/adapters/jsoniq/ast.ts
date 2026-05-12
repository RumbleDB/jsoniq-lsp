import type { ParseTree } from "antlr4ng";
import {
    attachParents,
    type AstNode,
    type CountClauseAstNode,
    type ForBindingAstNode,
    type FunctionCallAstNode,
    type FunctionDeclarationAstNode,
    type GroupByBindingAstNode,
    type JsoniqAst,
    type LetBindingAstNode,
    type NamedFunctionReferenceAstNode,
    type VariableDeclarationAstNode,
} from "server/parser/types/ast.js";
import type {
    AnyAstDeclaration,
    AstDeclaration,
    AstParameterDeclaration,
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

type AstVisitResult = AstNode[];

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
        return [];
    }

    protected override aggregateResult(
        aggregate: AstVisitResult,
        nextResult: AstVisitResult,
    ): AstVisitResult {
        return aggregate.concat(nextResult);
    }

    public override visitModuleAndThisIsIt = (node: ModuleAndThisIsItContext): AstVisitResult => [
        {
            kind: "module",
            range: rangeFromNode(node, this.document),
            children: this.visitChildrenAsNodes(node),
        },
    ];

    public override visitNamespaceDecl = (node: NamespaceDeclContext): AstVisitResult => {
        const nameNode = node.NCName();
        if (nameNode === null) {
            return [];
        }

        const prefix = nameNode.getText().trim();
        if (prefix === "") {
            return [];
        }

        const namespaceUriNode = node.uriLiteral();
        if (namespaceUriNode === null) {
            return [];
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

    public override visitContextItemExpr = (node: ContextItemExprContext): AstVisitResult => [
        {
            kind: "contextItemExpression",
            name: { qname: { localName: "$" } },
            range: rangeFromNode(node, this.document),
            children: [],
        },
    ];

    public override visitTypeDecl = (node: TypeDeclContext): AstVisitResult => {
        const nameNode = node.declaredQName().qname();
        const name = { qname: parseQname(nameNode) };
        return this.declaration(this.createDeclaration(name, "type", node, nameNode));
    };

    public override visitFunctionDecl = (node: FunctionDeclContext): AstVisitResult => [
        {
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
        } satisfies FunctionDeclarationAstNode,
    ];

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

        return declaration === null
            ? []
            : [
                  {
                      kind: "variableDeclaration",
                      declaration,
                      range: rangeFromNode(node, this.document),
                      children: this.visitChildrenAsNodes(node),
                  } satisfies VariableDeclarationAstNode,
              ];
    };

    public override visitForVar = (node: ForVarContext): AstVisitResult => {
        const declarations: ForBindingAstNode["declarations"] = [];
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

        return declarations.length === 0
            ? []
            : [
                  {
                      kind: "forBinding",
                      declarations,
                      range: rangeFromNode(node, this.document),
                      children: this.visitChildrenAsNodes(node),
                  } satisfies ForBindingAstNode,
              ];
    };

    public override visitLetVar = (node: LetVarContext): AstVisitResult => {
        const declaration = this.variableDeclaration("let", node, node.declaredVarRef());
        return declaration === null
            ? []
            : [
                  {
                      kind: "letBinding",
                      declaration,
                      range: rangeFromNode(node, this.document),
                      children: this.visitChildrenAsNodes(node),
                  } satisfies LetBindingAstNode,
              ];
    };

    public override visitGroupByVar = (node: GroupByVarContext): AstVisitResult => {
        const declaration = this.variableDeclaration("group-by", node, node.declaredVarRef());
        return declaration === null
            ? []
            : [
                  {
                      kind: "groupByBinding",
                      declaration,
                      range: rangeFromNode(node, this.document),
                      children: this.visitChildrenAsNodes(node),
                  } satisfies GroupByBindingAstNode,
              ];
    };

    public override visitCountClause = (node: CountClauseContext): AstVisitResult => {
        const declaration = this.variableDeclaration("count", node, node.declaredVarRef());
        return declaration === null
            ? []
            : [
                  {
                      kind: "countClause",
                      declaration,
                      range: rangeFromNode(node, this.document),
                      children: this.visitChildrenAsNodes(node),
                  } satisfies CountClauseAstNode,
              ];
    };

    public override visitFlowrExpr = (node: FlowrExprContext): AstVisitResult => [
        {
            kind: "flowrExpression",
            range: rangeFromNode(node, this.document),
            children: this.visitChildrenAsNodes(node),
        },
    ];

    public override visitFlowrStatement = (node: FlowrStatementContext): AstVisitResult => [
        {
            kind: "flowrExpression",
            range: rangeFromNode(node, this.document),
            children: this.visitChildrenAsNodes(node),
        },
    ];

    public override visitVarRef = (node: VarRefContext): AstVisitResult => {
        if (node.parent instanceof DeclaredVarRefContext) {
            return [];
        }

        const name = parseVarName(node);
        return name === null
            ? []
            : [
                  {
                      kind: "variableReference",
                      name,
                      range: rangeFromNode(node, this.document),
                      children: [],
                  },
              ];
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
        return this.visitChildren(node) ?? [];
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
            ? []
            : [
                  {
                      kind: "declaration",
                      declaration,
                      range: declaration.range,
                      children: [],
                  },
              ];
    }

    private variableDeclaration<
        K extends "declare-variable" | "let" | "for" | "for-position" | "group-by" | "count",
    >(
        kind: K,
        declarationNode: ParseTree,
        declaredVarRef: DeclaredVarRefContext,
    ): AstDeclaration<K> | null {
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
            ? [
                  {
                      kind: "functionCall",
                      name,
                      nameRange: rangeFromNode(nameNode, this.document),
                      range: rangeFromNode(node, this.document),
                      children: this.visitChildrenAsNodes(node),
                  } satisfies FunctionCallAstNode,
              ]
            : [];
    }

    private namedFunctionReference(node: NamedFunctionRefContext): AstVisitResult {
        const nameNode = node.qname();
        const name = parseFunctionName(node);
        return name !== null && nameNode !== null
            ? [
                  {
                      kind: "namedFunctionReference",
                      name,
                      nameRange: rangeFromNode(nameNode, this.document),
                      range: rangeFromNode(node, this.document),
                      children: [],
                  } satisfies NamedFunctionReferenceAstNode,
              ]
            : [];
    }

    private catchClause(node: CatchCaseStatementContext | CatchClauseContext): AstVisitResult {
        return [
            {
                kind: "catchClause",
                range: rangeFromNode(node, this.document),
                declarations: this.catchDeclarations(node),
                children: this.visitChildrenAsNodes(node),
            },
        ];
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

export function buildJsoniqAst(tree: ModuleAndThisIsItContext, document: TextDocument): JsoniqAst {
    const ast = new JsoniqAstBuilder(document).visitModuleAndThisIsIt(tree)[0];
    if (ast === undefined || ast.kind !== "module") {
        throw new Error("Expected module AST root.");
    }
    return attachParents(ast);
}
