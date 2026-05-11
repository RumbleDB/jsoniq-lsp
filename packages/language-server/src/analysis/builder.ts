import { parseDocument } from "server/parser/index.js";
import { referenceNameToString } from "server/parser/types/name.js";
import type { AnySemanticDeclaration, ScopeKind } from "server/parser/types/semantic-events.js";
import { comparePositions } from "server/utils/position.js";
import { findBuiltinFunctionDefinition } from "server/wrapper/builtin-functions.js";
import { DiagnosticSeverity, Position, type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { isVisibleOnEnter, PendingDeclarations } from "./declarations.js";
import { createSourceDefinition } from "./definitions.js";
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
    private readonly pendingDeclarations = new PendingDeclarations();

    private currentScope: Scope;

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
                case "enterDeclaration":
                    this.enterDeclaration(event.declaration);
                    break;
                case "exitDeclaration":
                    this.exitDeclaration(event.declaration);
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
        let owner: SourceDefinition | undefined;
        if (scopeKind === "function") {
            const currentDefinition = this.pendingDeclarations.currentDefinition();
            owner = currentDefinition;
        }

        this.currentScope = this.currentScope.enter(
            scopeKind,
            this.document.offsetAt(start),
            this.document.offsetAt(end),
            owner,
        );
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

    private enterDeclaration(declaration: AnySemanticDeclaration): void {
        const definition = createSourceDefinition(
            this.document,
            declaration,
            this.currentScope.owningFunction,
        );
        this.registerDefinition(definition);
        this.pendingDeclarations.enter(declaration, definition);

        if (definition.kind === "parameter") {
            definition.function.parameters.push(definition);
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

        if (isVisibleOnEnter(definition.kind)) {
            this.currentScope.declare(definition);
        }
    }

    private exitDeclaration(declaration: AnySemanticDeclaration): void {
        const definition = this.pendingDeclarations.exit(declaration);

        if (!isVisibleOnEnter(definition.kind)) {
            this.currentScope.declare(definition);
        }
    }

    private async resolve(reference: AnyReference): Promise<Definition | undefined> {
        const lookupName = referenceNameToString(reference.name, reference.kind);
        const builtinDefinition = await findBuiltinFunctionDefinition(lookupName);
        if (builtinDefinition !== undefined) {
            return builtinDefinition;
        }

        return this.currentScope.resolve(reference.kind, reference.name);
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
