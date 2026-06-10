import { parseDocument } from "server/parser/index.js";
import type {
    ArgumentAstNode,
    AstBinding,
    AstNode as ParserAstNode,
    AstParameter,
    CatchClauseAstNode,
    ContextItemDeclarationAstNode,
    ContextItemExpressionAstNode,
    CountClauseAstNode,
    FlowrExpressionAstNode,
    ForBindingAstNode,
    FunctionCallAstNode,
    FunctionDeclarationAstNode,
    GroupByBindingAstNode,
    LetBindingAstNode,
    NamespaceDeclarationAstNode,
    NamedFunctionReferenceAstNode,
    ReferenceAstNode,
    TypeDeclarationAstNode,
    UnknownAstNode,
    VariableDeclarationAstNode,
    VariableReferenceAstNode,
} from "server/parser/types/ast.js";
import {
    isPrefixedQName,
    type LexicalFunctionName,
    type LexicalQName,
    type LexicalReferenceNameByKind,
    type LexicalVarName,
} from "server/parser/types/name.js";
import { AstVisitor } from "server/parser/types/visitor.js";
import { BuiltinFunctions } from "server/wrapper/builtin-functions.js";
import { DiagnosticSeverity, Position, Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { ArgumentNode, AstNode, FunctionCallNode, ReferenceNode } from "./ast.js";
import { defaultNamespaces } from "./default-namespaces.js";
import {
    createFunctionDefinition,
    createNamespaceDefinition,
    createParameterDefinition,
    createTypeDefinition,
    createVariableDefinition,
} from "./definitions.js";
import {
    resolvedReferenceNameToString,
    type ResolvedFunctionName,
    type ResolvedQName,
    type ResolvedReferenceNameByKind,
    type ResolvedVarName,
} from "./names.js";
import { Scope } from "./scope.js";
import {
    type AnyReference,
    type Definition,
    type JsoniqAnalysis,
    type ResolvedReference,
    type SourceDefinition,
    type SourceFunctionDefinition,
    type SourceNamespaceDefinition,
    type VariableKind,
    isSourceDefinition,
} from "./types.js";

type LexicalReference<
    K extends keyof LexicalReferenceNameByKind = keyof LexicalReferenceNameByKind,
> = K extends keyof LexicalReferenceNameByKind
    ? {
          kind: K;
          name: LexicalReferenceNameByKind[K];
          range: AnyReference["range"];
      }
    : never;

const CATCH_VARIABLES = [
    { qname: { kind: "prefixed-qname", prefix: "err", localName: "code" } },
    { qname: { kind: "prefixed-qname", prefix: "err", localName: "description" } },
    { qname: { kind: "prefixed-qname", prefix: "err", localName: "value" } },
    { qname: { kind: "prefixed-qname", prefix: "err", localName: "module" } },
    { qname: { kind: "prefixed-qname", prefix: "err", localName: "line-number" } },
    { qname: { kind: "prefixed-qname", prefix: "err", localName: "column-number" } },
    { qname: { kind: "prefixed-qname", prefix: "err", localName: "additional" } },
] as const;

class AnalysisBuilder extends AstVisitor {
    private static readonly NEVER_VISIBLE_OFFSET = Number.POSITIVE_INFINITY;

    private readonly analysis: JsoniqAnalysis;

    private currentScope: Scope;

    private readonly document: TextDocument;

    private readonly builtinFunctions: BuiltinFunctions;

    private readonly parserAst: ParserAstNode;

    private currentNodeRef: AstNode | undefined;

    public constructor(document: TextDocument, builtinFunctions: BuiltinFunctions) {
        super();
        this.document = document;
        this.builtinFunctions = builtinFunctions;

        this.parserAst = parseDocument(document).ast;
        const namespaces = new Map<string, SourceNamespaceDefinition>(
            defaultNamespaces.entries().map((ns) => {
                const definition = createNamespaceDefinition(
                    document,
                    ns[0],
                    ns[1],
                    Range.create(Position.create(0, 0), Position.create(0, 0)),
                    Range.create(Position.create(0, 0), Position.create(0, 0)),
                );
                return [ns[0], definition] as const;
            }),
        );
        const moduleScope = Scope.module(document, namespaces);

        this.analysis = {
            ast: {
                kind: "module",
                range: this.parserAst.range,
                children: [],
                scope: moduleScope,
            },
            namespaces,
            diagnostics: [],
        };

        this.currentScope = moduleScope;
    }

    public build(): JsoniqAnalysis {
        this.visit(this.parserAst);
        return this.analysis;
    }

    protected override visitModule(node: ParserAstNode): void {
        this.withNode(this.analysis.ast, () => this.visitChildren(node));
    }

    protected override visitNamespaceDeclaration(node: NamespaceDeclarationAstNode): void {
        const definition = createNamespaceDefinition(
            this.document,
            node.prefix,
            node.namespaceUri,
            node.range,
            node.selectionRange,
        );
        this.withNode(this.appendDeclaration(definition), () => {
            this.declareDefinition(definition);
            this.analysis.namespaces.set(definition.name.prefix, definition);
        });
    }

    protected override visitContextItemDeclaration(node: ContextItemDeclarationAstNode): void {
        const definition = createVariableDefinition(
            this.document,
            "declare-variable",
            this.normalizeVarName(node.name, node.selectionRange),
            node.range,
            node.selectionRange,
        );
        this.withNode(this.appendDeclaration(definition), () => this.declareDefinition(definition));
    }

    protected override visitTypeDeclaration(node: TypeDeclarationAstNode): void {
        const definition = createTypeDefinition(
            this.document,
            { qname: this.normalizeQName(node.name.qname, node.selectionRange) },
            node.range,
            node.selectionRange,
        );
        this.withNode(this.appendDeclaration(definition), () => this.declareDefinition(definition));
    }

    protected override visitFunctionDeclaration(node: FunctionDeclarationAstNode): void {
        const definition = createFunctionDefinition(
            this.document,
            this.normalizeFunctionName(node.name, node.nameRange),
            node.range,
            node.nameRange,
        );
        this.withNode(this.appendDeclaration(definition), () => {
            this.declareDefinition(definition);
            this.enterScope(node.range, () => {
                this.registerFunctionParameters(definition, node.parameters);
                this.visitChildren(node);
            });
        });
    }

    protected override visitVariableDeclaration(node: VariableDeclarationAstNode): void {
        const definition = createVariableDefinition(
            this.document,
            "declare-variable",
            this.normalizeVarName(node.binding.name, node.binding.selectionRange),
            node.binding.range,
            node.binding.selectionRange,
            node.completed
                ? this.document.offsetAt(node.range.end)
                : AnalysisBuilder.NEVER_VISIBLE_OFFSET,
        );
        this.withNode(this.appendDeclaration(definition), () => {
            this.visitChildren(node);
            this.declareDefinition(definition);
        });
    }

    protected override visitLetBinding(node: LetBindingAstNode): void {
        this.visitBindingDeclaration("let", node.binding, () => this.visitChildren(node));
    }

    protected override visitGroupByBinding(node: GroupByBindingAstNode): void {
        this.visitBindingDeclaration("group-by", node.binding, () => this.visitChildren(node));
    }

    protected override visitCountClause(node: CountClauseAstNode): void {
        this.visitBindingDeclaration("count", node.binding, () => this.visitChildren(node));
    }

    protected override visitForBinding(node: ForBindingAstNode): void {
        this.visitChildren(node);
        for (const binding of node.bindings) {
            const definition = this.variableDefinition(binding.bindingKind, binding);
            this.withNode(this.appendDeclaration(definition), () =>
                this.declareDefinition(definition),
            );
        }
    }

    protected override visitFlowrExpression(node: FlowrExpressionAstNode): void {
        this.enterScope(node.range, () => this.visitChildren(node));
    }

    protected override visitCatchClause(node: CatchClauseAstNode): void {
        this.enterScope(node.range, () => {
            for (const name of CATCH_VARIABLES) {
                const definition = createVariableDefinition(
                    this.document,
                    "catch-variable",
                    this.normalizeVarName(name, node.range),
                    node.range,
                    node.range,
                    this.document.offsetAt(node.range.start),
                );
                this.withNode(this.appendDeclaration(definition), () =>
                    this.declareDefinition(definition),
                );
            }
            this.visitChildren(node);
        });
    }

    protected override visitVariableReference(node: VariableReferenceAstNode): void {
        this.recordReference({
            kind: "variable",
            name: node.name,
            range: node.range,
        });
    }

    protected override visitContextItemExpression(node: ContextItemExpressionAstNode): void {
        this.recordReference({
            kind: "variable",
            name: node.name,
            range: node.range,
        });
    }

    protected override visitFunctionCall(node: FunctionCallAstNode): void {
        this.visitCallableReference(node);
    }

    protected override visitNamedFunctionReference(node: NamedFunctionReferenceAstNode): void {
        this.visitCallableReference(node);
    }

    protected override visitReference(node: ReferenceAstNode): void {
        this.recordReference({
            kind: node.referenceKind,
            name: node.name,
            range: node.range,
        });
    }

    protected override visitArgument(node: ArgumentAstNode): void {
        const parent = this.currentNode();
        const argument = this.appendNode<ArgumentNode>({
            kind: "argument",
            range: node.range,
            children: [],
            index: node.index,
        });

        if (parent.kind === "function-call") {
            parent.arguments.push(argument);
        }

        this.withNode(argument, () => this.visitChildren(node));
    }

    protected override visitUnknown(node: UnknownAstNode): void {
        const semanticNode = this.appendNode({
            kind: "unknown",
            range: node.range,
            children: [],
        });
        this.withNode(semanticNode, () => this.visitChildren(node));
    }

    private visitBindingDeclaration(
        kind: VariableKind,
        binding: AstBinding,
        visitValue: () => void,
    ): void {
        const definition = this.variableDefinition(kind, binding);
        this.withNode(this.appendDeclaration(definition), () => {
            visitValue();
            this.declareDefinition(definition);
        });
    }

    private visitCallableReference(
        node: FunctionCallAstNode | NamedFunctionReferenceAstNode,
    ): void {
        const name = this.normalizeFunctionName(node.name, node.nameRange);
        const callNode = this.appendNode<FunctionCallNode>({
            kind: "function-call",
            range: node.range,
            children: [],
            name,
            nameRange: node.nameRange,
            arguments: [],
        });

        this.withNode(callNode, () => {
            callNode.reference = this.recordNormalizedReference("function", name, node.nameRange);
            this.visitChildren(node);
        });
    }

    private appendDeclaration(declaration: SourceDefinition): AstNode {
        return this.appendNode({
            kind: "declaration",
            range: declaration.range,
            children: [],
            declaration,
        });
    }

    private appendNode<T extends AstNode>(node: T): T {
        const parent = this.currentNode();
        node.parent = parent;
        parent.children.push(node);
        return node;
    }

    private withNode(node: AstNode, callback: () => void): void {
        const previousNode = this.currentNodeOrUndefined();
        this.currentNodeRef = node;
        try {
            callback();
        } finally {
            this.currentNodeRef = previousNode;
        }
    }

    private currentNode(): AstNode {
        const node = this.currentNodeOrUndefined();
        if (node === undefined) {
            throw new Error("Expected current analysis AST node.");
        }
        return node;
    }

    private currentNodeOrUndefined(): AstNode | undefined {
        return this.currentNodeRef;
    }

    private enterScope(range: Range, callback: () => void): void {
        const previousScope = this.currentScope;
        this.currentScope = this.currentScope.enter(
            this.document.offsetAt(range.start),
            this.document.offsetAt(range.end),
        );
        try {
            callback();
        } finally {
            this.currentScope = previousScope;
        }
    }

    private declareDefinition(definition: SourceDefinition): void {
        this.currentScope.declare(definition);
    }

    private resolve<K extends keyof ResolvedReferenceNameByKind>(
        kind: K,
        name: ResolvedReferenceNameByKind[K],
    ): Definition | undefined {
        if (kind === "function") {
            const builtinDefinition = this.builtinFunctions.find(name);
            if (builtinDefinition !== undefined) {
                return builtinDefinition;
            }
        }

        return this.currentScope.resolve(kind, name);
    }

    private recordReference(reference: LexicalReference): ReferenceNode {
        const name =
            reference.kind === "function"
                ? this.normalizeFunctionName(reference.name as LexicalFunctionName, reference.range)
                : this.normalizeVarName(reference.name as LexicalVarName, reference.range);
        return this.recordNormalizedReference(
            reference.kind,
            name as ResolvedReferenceNameByKind[typeof reference.kind],
            reference.range,
        );
    }

    private recordNormalizedReference<K extends keyof ResolvedReferenceNameByKind>(
        kind: K,
        name: ResolvedReferenceNameByKind[K],
        range: Range,
    ): ReferenceNode<K> {
        const lookupName = resolvedReferenceNameToString(name, kind);
        const declaration = this.resolve(kind, name);
        const resolvedReference =
            declaration === undefined
                ? undefined
                : ({
                      kind,
                      name,
                      range,
                      declaration,
                  } as unknown as ResolvedReference<K>);

        if (declaration === undefined) {
            this.analysis.diagnostics.push({
                severity: DiagnosticSeverity.Error,
                message: `Reference to undefined ${kind} '${lookupName}'`,
                range,
                code: `unresolved-${kind}`,
            });
        } else if (isSourceDefinition(declaration) && resolvedReference !== undefined) {
            declaration.references.push(resolvedReference);
        }

        return this.appendNode<ReferenceNode<K>>({
            kind: "reference",
            range,
            children: [],
            referenceKind: kind,
            name,
            resolution: resolvedReference,
        });
    }

    private registerFunctionParameters(
        definition: SourceFunctionDefinition,
        parameters: AstParameter[],
    ): void {
        for (const parameter of parameters) {
            const parameterDefinition = createParameterDefinition(
                this.document,
                this.normalizeVarName(parameter.name, parameter.selectionRange),
                parameter.range,
                parameter.selectionRange,
                definition,
            );
            this.withNode(this.appendDeclaration(parameterDefinition), () => {
                this.declareDefinition(parameterDefinition);
                definition.parameters.push(parameterDefinition);
            });
        }
    }

    private variableDefinition(kind: VariableKind, binding: AstBinding): SourceDefinition {
        return createVariableDefinition(
            this.document,
            kind,
            this.normalizeVarName(binding.name, binding.selectionRange),
            binding.range,
            binding.selectionRange,
            this.document.offsetAt(binding.range.end),
        );
    }

    private normalizeFunctionName(name: LexicalFunctionName, range: Range): ResolvedFunctionName {
        return {
            ...name,
            qname: this.normalizeQName(name.qname, range),
        };
    }

    private normalizeVarName(name: LexicalVarName, range: Range): ResolvedVarName {
        return {
            ...name,
            qname: this.normalizeQName(name.qname, range),
        };
    }

    private normalizeQName(qname: LexicalQName, range: Range): ResolvedQName {
        const namespaceUri = isPrefixedQName(qname)
            ? this.analysis.namespaces.get(qname.prefix)?.namespaceUri
            : undefined;

        if (namespaceUri === undefined && isPrefixedQName(qname)) {
            this.analysis.diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                message: `Undefined namespace prefix '${qname.prefix}'`,
                range,
                code: "undefined-namespace-prefix",
            });
        }

        return {
            localName: qname.localName,
            ...(namespaceUri === undefined ? {} : { namespaceUri }),
            ...(isPrefixedQName(qname) ? { prefix: qname.prefix } : {}),
        };
    }
}

export function buildAnalysis(
    document: TextDocument,
    builtinFunctions: BuiltinFunctions = { all: [], find: () => undefined },
): JsoniqAnalysis {
    return new AnalysisBuilder(document, builtinFunctions).build();
}
