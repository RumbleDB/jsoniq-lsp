import type { Position } from "vscode-languageserver";

import type { ScopeKind } from "server/parser/types/semantic-events.js";
import type {
    SourceDefinition,
    SourceFunctionDefinition,
} from "./model.js";
import { TextDocument } from "vscode-languageserver-textdocument";

export type AnalysisScopeKind = ScopeKind | "module";

export class Scope {
    private readonly definitionByName = new Map<string, SourceDefinition[]>();
    private readonly children: Scope[] = [];
    private definitions: SourceDefinition[] = [];

    private constructor(
        public readonly kind: AnalysisScopeKind,
        public readonly parent: Scope | undefined,
        public readonly owner: SourceDefinition | undefined,
        public readonly startOffset: number,
        public readonly endOffset: number,
    ) { }

    public static module(document: TextDocument): Scope {
        return new Scope("module", undefined, undefined, 0, document.getText().length);
    }

    /**
     * Enters a new scope.
     */
    public enter(
        kind: ScopeKind,
        startOffset: number,
        endOffset: number,
        owner?: SourceDefinition
    ): Scope {
        const child = new Scope(kind, this, owner, startOffset, endOffset);
        this.children.push(child);
        return child;
    }

    public declare(newDefinition: SourceDefinition): void {
        if (!this.definitionByName.has(newDefinition.name)) {
            this.definitionByName.set(newDefinition.name, []);
        }

        const definitionsWithSameName = this.definitionByName.get(newDefinition.name)!;
        const lastDefinition = definitionsWithSameName[definitionsWithSameName.length - 1];
        if (lastDefinition !== undefined) {
            lastDefinition.scopeEnd = newDefinition.range.end;
        }

        definitionsWithSameName.push(newDefinition);
        this.definitions.push(newDefinition);
    }

    public resolve(name: string): SourceDefinition | undefined {
        const declarations = this.definitionByName.get(name);
        const declaration = declarations?.[declarations.length - 1];
        if (declaration !== undefined) {
            return declaration;
        }

        return this.parent?.resolve(name);
    }

    public close(scopeEnd: Position): void {
        for (const scopedDefinitions of this.definitionByName.values()) {
            const lastDefinition = scopedDefinitions[scopedDefinitions.length - 1];
            if (lastDefinition !== undefined) {
                lastDefinition.scopeEnd = scopeEnd;
            }
        }
    }

    public get owningFunction(): SourceFunctionDefinition | undefined {
        if (this.owner?.kind === "function") {
            return this.owner;
        }

        return this.parent?.owningFunction;
    }

    /**
     * Checks if the given offset is within the range of this scope.
     */
    public contains(offset: number): boolean {
        return offset >= this.startOffset && offset < this.endOffset;
    }
}
