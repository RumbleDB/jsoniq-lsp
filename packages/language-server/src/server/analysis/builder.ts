import {
    type Position,
    type Range,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { parseDocument } from "server/parser/index.js";
import type {
    SemanticDeclarationEvent,
    SemanticEvent,
    ScopeKind,
} from "server/parser/semantic-events.js";
import { findBuiltinFunctionDefinition } from "server/wrapper/builtin-functions.js";
import { comparePositions } from "../utils/position.js";
import {
    type Definition,
    type JsoniqAnalysis,
    type OccurrenceIndexEntry,
    type Reference,
    type ResolvedReference,
    type SourceDefinition,
    type SourceFunctionDefinition,
    type SourceParameterDefinition,
    type SourceVariableDefinition,
    isSourceDefinition,
} from "./model.js";

interface ScopeFrame {
    definitionByName: Map<string, SourceDefinition[]>;
    scopeKind?: ScopeKind;
}

class AnalysisBuilder {
    private readonly definitions: SourceDefinition[] = [];
    private readonly references: ResolvedReference[] = [];
    private readonly unresolvedReferences: Reference[] = [];
    private readonly occurrenceIndex: OccurrenceIndexEntry[] = [];
    private readonly scopeStack: ScopeFrame[] = [{ definitionByName: new Map() }];
    private readonly functionStack: SourceFunctionDefinition[] = [];

    public constructor(private readonly document: TextDocument) { }

    public build(events: readonly SemanticEvent[]): JsoniqAnalysis {
        for (const event of events) {
            switch (event.type) {
                case "declaration":
                    this.handleDeclaration(event);
                    break;
                case "reference":
                    this.recordReference(event.name, event.range);
                    break;
                case "enterScope":
                    this.pushScope(event.scopeKind);
                    break;
                case "exitScope":
                    this.popScope(event.range.end, event.scopeKind);
                    break;
                default:
                    throw event satisfies never;
            }
        }

        const documentEnd = this.document.positionAt(this.document.getText().length);
        for (const scopedDefinitions of this.scopeStack[0]?.definitionByName.values() ?? []) {
            const lastDefinition = scopedDefinitions[scopedDefinitions.length - 1];
            if (lastDefinition !== undefined) {
                lastDefinition.scopeEnd = documentEnd;
            }
        }

        this.occurrenceIndex.sort((left, right) => {
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
            occurrenceIndex: this.occurrenceIndex,
            documentSymbols: [],
        };
    }

    private pushScope(scopeKind: ScopeKind): void {
        this.scopeStack.push({
            definitionByName: new Map(),
            scopeKind,
        });

        if (scopeKind === "function") {
            const currentFunction = this.definitions[this.definitions.length - 1];
            if (currentFunction === undefined || currentFunction.kind !== "function") {
                throw new Error("Function scope entered without a preceding function declaration.");
            }
            this.functionStack.push(currentFunction);
        }
    }

    private popScope(scopeEnd: Position, scopeKind: ScopeKind): void {
        const scope = this.scopeStack.pop();
        if (scope !== undefined) {
            for (const scopedDefinitions of scope.definitionByName.values()) {
                const lastDefinition = scopedDefinitions[scopedDefinitions.length - 1];
                if (lastDefinition !== undefined) {
                    lastDefinition.scopeEnd = scopeEnd;
                }
            }

            if (scopeKind === "function") {
                this.functionStack.pop();
            }
        }
    }

    private currentScope(): ScopeFrame {
        const scope = this.scopeStack[this.scopeStack.length - 1];
        if (scope === undefined) {
            throw new Error("Variable scope stack is unexpectedly empty.");
        }
        return scope;
    }

    private declare(newDefinition: SourceDefinition): void {
        this.definitions.push(newDefinition);

        const scope = this.currentScope();
        if (!scope.definitionByName.has(newDefinition.name)) {
            scope.definitionByName.set(newDefinition.name, []);
        }

        const definitionsWithSameName = scope.definitionByName.get(newDefinition.name)!;
        const lastDefinition = definitionsWithSameName[definitionsWithSameName.length - 1];
        if (lastDefinition !== undefined) {
            lastDefinition.scopeEnd = newDefinition.range.end;
        }
        definitionsWithSameName.push(newDefinition);

        this.occurrenceIndex.push({
            range: newDefinition.selectionRange,
            declaration: newDefinition,
            reference: undefined,
        });
    }

    private handleDeclaration(event: SemanticDeclarationEvent): void {
        const definition = this.createDefinition(event);
        this.declare(definition);

        if (definition.kind === "parameter") {
            definition.function.parameters.push(definition);
        }
    }

    private createDefinition(event: SemanticDeclarationEvent): SourceDefinition {
        const base = {
            name: event.name,
            range: event.range,
            selectionRange: event.selectionRange,
            scopeEnd: { line: 0, character: 0 },
            references: [],
            isBuiltin: false as const,
        };

        if (event.kind === "function") {
            return {
                ...base,
                kind: "function",
                parameters: [],
            } satisfies SourceFunctionDefinition;
        }

        if (event.kind === "parameter") {
            const containingFunction = this.functionStack[this.functionStack.length - 1];
            if (containingFunction === undefined) {
                throw new Error("Parameter declaration must belong to a function.");
            }

            return {
                ...base,
                kind: "parameter",
                function: containingFunction,
            } satisfies SourceParameterDefinition;
        }

        return {
            ...base,
            kind: event.kind,
        } satisfies SourceVariableDefinition;
    }

    private resolve(name: string): Definition | undefined {
        const builtinDefinition = findBuiltinFunctionDefinition(name);
        if (builtinDefinition !== undefined) {
            return builtinDefinition;
        }

        for (let index = this.scopeStack.length - 1; index >= 0; index -= 1) {
            const scope = this.scopeStack[index];
            const declarations = scope?.definitionByName.get(name);
            const declaration = declarations?.[declarations.length - 1];
            if (declaration !== undefined) {
                return declaration;
            }
        }
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
        this.occurrenceIndex.push({
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
    const parseResult = parseDocument(document);
    return new AnalysisBuilder(document).build(parseResult.semanticEvents);
}
