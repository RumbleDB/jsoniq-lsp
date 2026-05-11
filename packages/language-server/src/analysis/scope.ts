import type { ScopeKind } from "server/parser/types/semantic-events.js";
import { getDocumentText } from "server/parser/utils.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    definitionNameToString,
    type SourceDefinition,
    type SourceFunctionDefinition,
} from "./model.js";

export type AnalysisScopeKind = ScopeKind | "module";

export class Scope {
    private readonly definitionByName = new Map<string, SourceDefinition[]>();
    private readonly children: Scope[] = [];

    private constructor(
        public readonly kind: AnalysisScopeKind,
        public readonly parent: Scope | undefined,
        public readonly owner: SourceDefinition | undefined,
        public readonly startOffset: number,
        public readonly endOffset: number,
    ) {}

    public static module(document: TextDocument): Scope {
        return new Scope("module", undefined, undefined, 0, getDocumentText(document).length);
    }

    /**
     * Enters a new scope.
     */
    public enter(
        kind: ScopeKind,
        startOffset: number,
        endOffset: number,
        owner?: SourceDefinition,
    ): Scope {
        const child = new Scope(kind, this, owner, startOffset, endOffset);
        this.children.push(child);
        return child;
    }

    public declare(newDefinition: SourceDefinition): void {
        const name = definitionNameToString(newDefinition);
        if (!this.definitionByName.has(name)) {
            this.definitionByName.set(name, []);
        }

        const definitionsWithSameName = this.definitionByName.get(name)!;
        definitionsWithSameName.push(newDefinition);
    }

    public resolve(name: string): SourceDefinition | undefined {
        const declarations = this.definitionByName.get(name);
        const declaration = declarations?.[declarations.length - 1];
        if (declaration !== undefined) {
            return declaration;
        }

        return this.parent?.resolve(name);
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
        return offset >= this.startOffset && offset <= this.endOffset;
    }

    public findInnermostScope(offset: number): Scope {
        for (const child of this.children) {
            if (child.contains(offset)) {
                /// We can return early because we know that scopes cannot overlap, only nest.
                return child.findInnermostScope(offset);
            }
        }

        return this;
    }

    /**
     * Lists all definitions that are visible at the given offset,
     * i.e. all definitions declared in this scope or any parent scope that are visible at the given offset.
     *
     * This method should be called on the innermost scope at the given offset
     */
    public listVisibleDefinitions(offset: number): Map<string, SourceDefinition> {
        const visible = new Map<string, SourceDefinition>();

        for (const [name, definitions] of this.definitionByName.entries()) {
            const definition = definitions.findLast(
                (def) => def.visibleFrom !== null && def.visibleFrom < offset,
            );
            if (definition !== undefined) {
                visible.set(name, definition);
            }
        }

        let current = this.parent;
        while (current !== undefined) {
            for (const [name, definitions] of current.definitionByName.entries()) {
                if (visible.has(name)) {
                    continue;
                }

                const definition = definitions.findLast(
                    (def) => def.visibleFrom !== null && def.visibleFrom < offset,
                );

                if (definition !== undefined) {
                    visible.set(name, definition);
                }
            }

            current = current.parent;
        }

        return visible;
    }
}
