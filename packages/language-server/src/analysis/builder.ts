import { parseDocument } from "server/parser/index.js";
import type { AstNode, FunctionDeclarationAstNode } from "server/parser/types/ast.js";
import type { AnyAstDeclaration } from "server/parser/types/declaration.js";
import { referenceNameToString } from "server/parser/types/name.js";
import { comparePositions } from "server/utils/position.js";
import { BuiltinFunctions } from "server/wrapper/builtin-functions.js";
import { DiagnosticSeverity, Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { createSourceDefinition, createSourceParameterDefinition } from "./definitions.js";
import {
    type AnyReference,
    type Definition,
    type JsoniqAnalysis,
    type ResolvedReference,
    type SourceDefinition,
    type SourceNamespaceDefinition,
    isSourceDefinition,
} from "./model.js";
import { Scope } from "./scope.js";

const CATCH_VARIABLES = [
    { qname: { prefix: "err", localName: "code" } },
    { qname: { prefix: "err", localName: "description" } },
    { qname: { prefix: "err", localName: "value" } },
    { qname: { prefix: "err", localName: "module" } },
    { qname: { prefix: "err", localName: "line-number" } },
    { qname: { prefix: "err", localName: "column-number" } },
    { qname: { prefix: "err", localName: "additional" } },
] as const;

class AnalysisBuilder {
    private readonly analysis: JsoniqAnalysis;

    private currentScope: Scope;
    private readonly deferredScopeDefinitions: SourceDefinition[] = [];

    public constructor(
        private readonly document: TextDocument,
        private readonly builtinFunctions: BuiltinFunctions,
    ) {
        const namespaces = new Map<string, SourceNamespaceDefinition>();
        this.analysis = {
            moduleScope: Scope.module(document, namespaces),
            namespaces,
            definitions: [],
            references: [],
            diagnostics: [],
            symbolIndex: [],
        };

        this.currentScope = this.analysis.moduleScope;
    }

    public build(): JsoniqAnalysis {
        this.visitNode(parseDocument(this.document).ast);

        this.analysis.symbolIndex.sort((left, right) => {
            const startComparison = comparePositions(left.range.start, right.range.start);
            if (startComparison !== 0) {
                return startComparison;
            }

            return comparePositions(left.range.end, right.range.end);
        });

        this.analysis.definitions.sort((left, right) =>
            comparePositions(left.range.start, right.range.start),
        );

        return this.analysis;
    }

    private visitNode(node: AstNode): void {
        switch (node.kind) {
            case "module":
                this.visitChildren(node);
                break;
            case "functionDeclaration":
                this.visitFunctionDeclaration(node);
                break;
            case "variableDeclaration":
            case "letBinding":
            case "groupByBinding":
            case "countClause":
                this.registerDeclaration(node.declaration);
                this.visitChildren(node);
                break;
            case "forBinding":
                for (const declaration of node.declarations) {
                    this.registerDeclaration(declaration);
                }
                this.visitChildren(node);
                break;
            case "flowrExpression":
                this.visitScopedChildren(node);
                break;
            case "catchClause":
                this.visitCatchClause(node);
                break;
            case "declaration":
                this.registerDeclaration(node.declaration);
                break;
            case "variableReference":
            case "contextItemExpression":
                this.recordReference({
                    kind: "variable",
                    name: node.name,
                    range: node.range,
                });
                break;
            case "functionCall":
            case "namedFunctionReference":
                this.recordReference({
                    kind: "function",
                    name: node.name,
                    range: node.nameRange,
                });
                this.visitChildren(node);
                break;
            case "reference":
                this.recordReference({
                    kind: node.referenceKind,
                    name: node.name,
                    range: node.range,
                });
                break;
            case "unknown":
                this.visitChildren(node);
                break;
            default:
                throw node satisfies never;
        }
    }

    private visitChildren(node: AstNode) {
        for (const child of node.children) {
            this.visitNode(child);
        }
    }

    private visitFunctionDeclaration(node: FunctionDeclarationAstNode) {
        this.registerDeclaration(node.declaration);
        this.visitScopedChildren(node);
    }

    private visitCatchClause(node: Extract<AstNode, { kind: "catchClause" }>) {
        this.pushScope(node.range.start, node.range.end);
        for (const declaration of this.catchDeclarations(node)) {
            this.registerDeclaration(declaration);
        }
        this.visitChildren(node);
        this.popScope();
    }

    private visitScopedChildren(node: AstNode) {
        this.pushScope(node.range.start, node.range.end);
        this.visitChildren(node);
        this.popScope();
    }

    private pushScope(start: Position, end: Position): void {
        this.currentScope = this.currentScope.enter(
            this.document.offsetAt(start),
            this.document.offsetAt(end),
        );

        for (const definition of this.deferredScopeDefinitions.splice(0)) {
            this.currentScope.declare(definition);
        }
    }

    private popScope(): void {
        const parent = this.currentScope.parent;
        if (parent === undefined) {
            throw new Error("Cannot exit the module scope.");
        }
        this.currentScope = parent;
    }

    private registerDefinition(newDefinition: SourceDefinition): void {
        this.analysis.definitions.push(newDefinition);
        this.analysis.symbolIndex.push({
            range: newDefinition.selectionRange,
            declaration: newDefinition,
            reference: undefined,
        });
    }

    private registerDeclaration(declaration: AnyAstDeclaration): void {
        const definition = createSourceDefinition(this.document, declaration);

        if (declaration.kind === "catch-variable") {
            definition.visibleFrom = this.document.offsetAt(declaration.range.start);
        }

        this.registerDefinition(definition);

        if (declaration.kind === "function" && definition.kind === "function") {
            for (const parameter of declaration.extra.parameters) {
                const parameterDefinition = createSourceParameterDefinition(
                    this.document,
                    parameter,
                    definition,
                );

                this.registerDefinition(parameterDefinition);
                definition.parameters.push(parameterDefinition);
                this.deferredScopeDefinitions.push(parameterDefinition);
            }
        }

        if (definition.kind === "namespace") {
            if (this.analysis.namespaces.has(definition.name.prefix)) {
                this.analysis.diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    message: `Duplicate namespace declaration for prefix '${definition.name.prefix}'.`,
                    range: definition.range,
                    code: "duplicate-namespace",
                });
            } else {
                this.analysis.namespaces.set(definition.name.prefix, definition);
            }
            return;
        }

        this.currentScope.declare(definition);
    }

    private catchDeclarations(
        node: Extract<AstNode, { kind: "catchClause" }>,
    ): Extract<AnyAstDeclaration, { kind: "catch-variable" }>[] {
        return CATCH_VARIABLES.map((name) => ({
            name,
            kind: "catch-variable",
            range: node.range,
            selectionRange: node.range,
        }));
    }

    private resolve(reference: AnyReference): Definition | undefined {
        const lookupName = referenceNameToString(reference.name, reference.kind);
        const builtinDefinition = this.builtinFunctions.find(lookupName);
        if (builtinDefinition !== undefined) {
            return builtinDefinition;
        }

        return this.currentScope.resolve(
            reference.kind,
            reference.name,
            this.document.offsetAt(reference.range.start),
        );
    }

    private recordReference(reference: AnyReference) {
        const lookupName = referenceNameToString(reference.name, reference.kind);
        const declaration = this.resolve(reference);
        if (declaration === undefined) {
            this.analysis.diagnostics.push({
                severity: DiagnosticSeverity.Error,
                message: `Reference to undefined variable '${lookupName}'`,
                range: reference.range,
                code: "unresolved-variable",
            });
            return;
        }

        const resolvedReference = {
            ...reference,
            declaration,
        } satisfies ResolvedReference;

        this.analysis.references.push(resolvedReference);
        this.analysis.symbolIndex.push({
            range: resolvedReference.range,
            declaration,
            reference: resolvedReference,
        });

        if (isSourceDefinition(declaration)) {
            declaration.references.push(resolvedReference);
        }
    }
}

export function buildAnalysis(
    document: TextDocument,
    builtinFunctions: BuiltinFunctions = { all: [], find: () => undefined },
): JsoniqAnalysis {
    return new AnalysisBuilder(document, builtinFunctions).build();
}
