import { Position, type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { parseDocument } from "server/parser/index.js";
import type {
    SemanticDeclaration,
    ScopeKind,
} from "server/parser/types/semantic-events.js";
import { findBuiltinFunctionDefinition } from "server/wrapper/builtin-functions.js";
import { comparePositions } from "../utils/position.js";
import {
    isVisibleOnEnter,
    PendingDeclarations,
} from "./declarations.js";
import { createSourceDefinition } from "./definitions.js";
import { Scope } from "./scope.js";
import {
    type Definition,
    type JsoniqAnalysis,
    type SymbolIndexEntry,
    type Reference,
    type ResolvedReference,
    type SourceDefinition,
    isSourceDefinition,
} from "./model.js";

class AnalysisBuilder {
    private readonly definitions: SourceDefinition[] = [];
    private readonly references: ResolvedReference[] = [];
    private readonly unresolvedReferences: Reference[] = [];
    private readonly symbolIndex: SymbolIndexEntry[] = [];
    private readonly pendingDeclarations = new PendingDeclarations();
    private readonly moduleScope: Scope;

    private currentScope: Scope;

    public constructor(private readonly document: TextDocument) {
        this.moduleScope = Scope.module(document);
        this.currentScope = this.moduleScope;
    }

    public build(): JsoniqAnalysis {
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
                    this.recordReference(event.name, event.range);
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

        const documentEnd = this.document.positionAt(this.document.getText().length);
        this.currentScope.close(documentEnd);

        this.symbolIndex.sort((left, right) => {
            const startComparison = comparePositions(left.range.start, right.range.start);
            if (startComparison !== 0) {
                return startComparison;
            }

            return comparePositions(left.range.end, right.range.end);
        });

        this.definitions.sort((left, right) => comparePositions(left.range.start, right.range.start));

        return {
            definitions: this.definitions,
            references: this.references,
            unresolvedReferences: this.unresolvedReferences,
            symbolIndex: this.symbolIndex,
        };
    }

    private pushScope(scopeKind: ScopeKind, start: Position, end: Position): void {
        let owner: SourceDefinition | undefined;
        if (scopeKind === "function") {
            const currentDefinition = this.pendingDeclarations.currentDefinition();
            owner = currentDefinition;
        }

        this.currentScope = this.currentScope.enter(scopeKind, this.document.offsetAt(start), this.document.offsetAt(end), owner);
    }

    private popScope(scopeEnd: Range["end"], scopeKind: ScopeKind): void {
        if (this.currentScope.kind !== scopeKind) {
            throw new Error(`Tried to exit ${scopeKind} scope while inside ${this.currentScope.kind} scope.`);
        }

        this.currentScope.close(scopeEnd);

        const parent = this.currentScope.parent;
        if (parent === undefined) {
            throw new Error("Cannot exit the module scope.");
        }
        this.currentScope = parent;
    }

    private registerDefinition(newDefinition: SourceDefinition): void {
        this.definitions.push(newDefinition);
        this.symbolIndex.push({
            range: newDefinition.selectionRange,
            declaration: newDefinition,
            reference: undefined,
        });
    }

    private enterDeclaration(declaration: SemanticDeclaration): void {
        const definition = createSourceDefinition(this.document, declaration, this.currentScope.owningFunction);
        this.registerDefinition(definition);
        this.pendingDeclarations.enter(declaration, definition);

        if (definition.kind === "parameter") {
            definition.function.parameters.push(definition);
        }

        if (isVisibleOnEnter(definition.kind)) {
            this.currentScope.declare(definition);
        }
    }

    private exitDeclaration(declaration: SemanticDeclaration): void {
        const definition = this.pendingDeclarations.exit(declaration);
        if (!isVisibleOnEnter(definition.kind)) {
            this.currentScope.declare(definition);
        }
    }

    private resolve(name: string): Definition | undefined {
        const builtinDefinition = findBuiltinFunctionDefinition(name);
        if (builtinDefinition !== undefined) {
            return builtinDefinition;
        }

        return this.currentScope.resolve(name);
    }

    private recordReference(name: string, range: Range): void {
        const declaration = this.resolve(name);
        if (declaration === undefined) {
            this.unresolvedReferences.push({
                name,
                range,
            });
            return;
        }

        const reference = {
            name,
            range,
            declaration,
        } satisfies ResolvedReference;

        this.references.push(reference);
        this.symbolIndex.push({
            range: reference.range,
            declaration,
            reference,
        });

        if (isSourceDefinition(declaration)) {
            declaration.references.push(reference);
        }
    }
}

export function buildAnalysis(document: TextDocument): JsoniqAnalysis {
    return new AnalysisBuilder(document).build();
}
