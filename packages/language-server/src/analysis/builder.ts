import { parseDocument } from "server/parser/index.js";
import { referenceNameToString } from "server/parser/types/name.js";
import type {
    AnySemanticDeclaration,
    SemanticParameterDeclaration,
    ScopeKind,
} from "server/parser/types/semantic-events.js";
import { comparePositions } from "server/utils/position.js";
import { findBuiltinFunctionDefinition } from "server/wrapper/builtin-functions.js";
import { DiagnosticSeverity, Position, type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { createSourceDefinition, createSourceParameterDefinition } from "./definitions.js";
import {
    type AnyReference,
    type Definition,
    type JsoniqAnalysis,
    type ResolvedReference,
    type SourceDefinition,
    type SourceFunctionDefinition,
    type SourceNamespaceDefinition,
    isSourceDefinition,
} from "./model.js";
import { Scope } from "./scope.js";

class AnalysisBuilder {
    private readonly analysis: JsoniqAnalysis;

    private currentScope: Scope;
    private pendingFunction:
        | {
              definition: SourceFunctionDefinition;
              parameters: SemanticParameterDeclaration[];
          }
        | undefined;

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
        const events = parseDocument(this.document).semanticEvents;

        for (const event of events) {
            switch (event.type) {
                case "declaration":
                    this.registerDeclaration(event.declaration);
                    break;
                case "reference":
                    await this.recordReference(event);
                    break;
                case "enterScope":
                    this.pushScope(event.scopeKind, event.range.start, event.range.end);
                    break;
                case "exitScope":
                    this.popScope(event.range.end, event.scopeKind);
                    break;
                default:
                    throw event satisfies never;
            }
        }

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

    private pushScope(scopeKind: ScopeKind, start: Position, end: Position): void {
        const pendingFunction = scopeKind === "function" ? this.pendingFunction : undefined;

        this.currentScope = this.currentScope.enter(
            scopeKind,
            this.document.offsetAt(start),
            this.document.offsetAt(end),
        );

        if (pendingFunction !== undefined) {
            for (const parameter of pendingFunction.parameters) {
                this.registerParameterDeclaration(parameter, pendingFunction.definition);
            }
            this.pendingFunction = undefined;
        }
    }

    private popScope(scopeEnd: Range["end"], scopeKind: ScopeKind): void {
        if (this.currentScope.kind !== scopeKind) {
            throw new Error(
                `Tried to exit ${scopeKind} scope while inside ${this.currentScope.kind} scope.`,
            );
        }

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

    private registerDeclaration(declaration: AnySemanticDeclaration): void {
        const definition = createSourceDefinition(this.document, declaration);
        this.registerDefinition(definition);

        if (declaration.kind === "function" && definition.kind === "function") {
            this.pendingFunction = {
                definition,
                parameters: declaration.extra.parameters,
            };
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

    private registerParameterDeclaration(
        declaration: SemanticParameterDeclaration,
        functionDefinition: SourceFunctionDefinition,
    ): void {
        const definition = createSourceParameterDefinition(
            this.document,
            declaration,
            functionDefinition,
        );

        this.registerDefinition(definition);
        functionDefinition.parameters.push(definition);
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
