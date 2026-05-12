import { parseDocument } from "server/parser/index.js";
import type { AstNode, FunctionDeclarationAstNode } from "server/parser/types/ast.js";
import type { AnyAstDeclaration } from "server/parser/types/declaration.js";
import { referenceNameToString } from "server/parser/types/name.js";
import { comparePositions } from "server/utils/position.js";
import { findBuiltinFunctionDefinition } from "server/wrapper/builtin-functions.js";
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

class AnalysisBuilder {
    private readonly analysis: JsoniqAnalysis;

    private currentScope: Scope;
    private readonly deferredScopeDefinitions: SourceDefinition[] = [];

    public constructor(private readonly document: TextDocument) {
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

    public async build(): Promise<JsoniqAnalysis> {
        await this.visitNode(parseDocument(this.document).ast);

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

    private async visitNode(node: AstNode): Promise<void> {
        switch (node.kind) {
            case "module":
                await this.visitChildren(node);
                break;
            case "functionDeclaration":
                await this.visitFunctionDeclaration(node);
                break;
            case "flowrExpression":
                await this.visitScopedChildren(node);
                break;
            case "catchClause":
                await this.visitCatchClause(node);
                break;
            case "declaration":
                this.registerDeclaration(node.declaration);
                break;
            case "variableReference":
            case "contextItemExpression":
                await this.recordReference({
                    kind: "variable",
                    name: node.name,
                    range: node.range,
                });
                break;
            case "functionCall":
            case "namedFunctionReference":
                await this.recordReference({
                    kind: "function",
                    name: node.name,
                    range: node.nameRange,
                });
                await this.visitChildren(node);
                break;
            case "reference":
                await this.recordReference({
                    kind: node.referenceKind,
                    name: node.name,
                    range: node.range,
                });
                break;
            case "unknown":
                await this.visitChildren(node);
                break;
            default:
                throw node satisfies never;
        }
    }

    private async visitChildren(node: AstNode): Promise<void> {
        for (const child of node.children) {
            await this.visitNode(child);
        }
    }

    private async visitFunctionDeclaration(node: FunctionDeclarationAstNode): Promise<void> {
        this.registerDeclaration(node.declaration);
        await this.visitScopedChildren(node);
    }

    private async visitCatchClause(node: Extract<AstNode, { kind: "catchClause" }>): Promise<void> {
        this.pushScope(node.range.start, node.range.end);
        for (const declaration of node.declarations) {
            this.registerDeclaration(declaration);
        }
        await this.visitChildren(node);
        this.popScope();
    }

    private async visitScopedChildren(node: AstNode): Promise<void> {
        this.pushScope(node.range.start, node.range.end);
        await this.visitChildren(node);
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

    private async resolve(reference: AnyReference): Promise<Definition | undefined> {
        const lookupName = referenceNameToString(reference.name, reference.kind);
        const builtinDefinition = await findBuiltinFunctionDefinition(lookupName);
        if (builtinDefinition !== undefined) {
            return builtinDefinition;
        }

        return this.currentScope.resolve(
            reference.kind,
            reference.name,
            this.document.offsetAt(reference.range.start),
        );
    }

    private async recordReference(reference: AnyReference): Promise<void> {
        const lookupName = referenceNameToString(reference.name, reference.kind);
        const declaration = await this.resolve(reference);
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

export async function buildAnalysis(document: TextDocument): Promise<JsoniqAnalysis> {
    return new AnalysisBuilder(document).build();
}
