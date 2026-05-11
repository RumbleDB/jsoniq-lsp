import {
    type FunctionName,
    type Prefix,
    type QName,
    type ReferenceNameByKind,
    type VarName,
} from "server/parser/types/name.js";
import type { ScopeKind } from "server/parser/types/semantic-events.js";
import { getDocumentText } from "server/parser/utils.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    type BaseDefinition,
    type SourceDefinition,
    type SourceNamespaceDefinition,
} from "./model.js";

export type AnalysisScopeKind = ScopeKind | "module";

export class Scope {
    private readonly definitionByName = new Map<string, SourceDefinition[]>();
    private readonly children: Scope[] = [];

    private constructor(
        public readonly kind: AnalysisScopeKind,
        public readonly parent: Scope | undefined,
        public readonly startOffset: number,
        public readonly endOffset: number,
        private readonly namespaces: ReadonlyMap<Prefix, SourceNamespaceDefinition>,
    ) {}

    public static module(
        document: TextDocument,
        namespaces: ReadonlyMap<Prefix, SourceNamespaceDefinition>,
    ): Scope {
        return new Scope("module", undefined, 0, getDocumentText(document).length, namespaces);
    }

    /**
     * Enters a new scope.
     */
    public enter(kind: ScopeKind, startOffset: number, endOffset: number): Scope {
        const child = new Scope(kind, this, startOffset, endOffset, this.namespaces);
        this.children.push(child);
        return child;
    }

    public declare(newDefinition: SourceDefinition): void {
        const name = this.definitionLookupKey(newDefinition);
        if (!this.definitionByName.has(name)) {
            this.definitionByName.set(name, []);
        }

        const definitionsWithSameName = this.definitionByName.get(name)!;
        definitionsWithSameName.push(newDefinition);
    }

    public resolve<K extends keyof ReferenceNameByKind>(
        kind: K,
        name: ReferenceNameByKind[K],
    ): SourceDefinition | undefined {
        const declarations = this.definitionByName.get(this.referenceLookupKey(name, kind));
        const declaration = declarations?.[declarations.length - 1];
        if (declaration !== undefined) {
            return declaration;
        }

        return this.parent?.resolve(kind, name);
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

    private qnameLookupKey(qname: QName): string {
        if (qname.prefix === undefined) {
            return qname.localName;
        }

        const namespaceUri = this.namespaces.get(qname.prefix)?.namespaceUri;
        return namespaceUri === undefined
            ? `${qname.prefix}:${qname.localName}`
            : `Q{${namespaceUri}}${qname.localName}`;
    }

    private variableLookupKey(name: VarName): string {
        return `$${this.qnameLookupKey(name.qname)}`;
    }

    private functionLookupKey(name: FunctionName): string {
        return `${this.qnameLookupKey(name.qname)}#${name.arity ?? "?"}`;
    }

    private definitionLookupKey(definition: BaseDefinition): string {
        switch (definition.kind) {
            case "context-item":
                return definition.name.label;
            case "namespace":
                return definition.name.prefix;
            case "function":
            case "builtin-function":
                return this.functionLookupKey(definition.name);
            case "type":
                return this.qnameLookupKey(definition.name.qname);
            case "parameter":
            case "declare-variable":
            case "let":
            case "for":
            case "for-position":
            case "group-by":
            case "count":
            case "catch-variable":
                return this.variableLookupKey(definition.name);
            default:
                throw definition satisfies never;
        }
    }

    private referenceLookupKey<K extends keyof ReferenceNameByKind>(
        name: ReferenceNameByKind[K],
        kind: K,
    ): string {
        switch (kind) {
            case "function":
                return this.functionLookupKey(name as FunctionName);
            case "variable":
                return this.variableLookupKey(name as VarName);
            default:
                throw kind satisfies never;
        }
    }
}
