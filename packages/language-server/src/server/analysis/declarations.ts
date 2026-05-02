import type { SemanticDeclaration } from "server/parser/semantic-events.js";
import type {
    SourceDefinition,
    SourceDefinitionKind,
} from "./model.js";

interface PendingDeclaration {
    declaration: SemanticDeclaration;
    definition: SourceDefinition;
}

export class PendingDeclarations {
    private readonly stack: PendingDeclaration[] = [];

    public enter(declaration: SemanticDeclaration, definition: SourceDefinition): void {
        this.stack.push({ declaration, definition });
    }

    public currentDefinition(): SourceDefinition | undefined {
        return this.stack[this.stack.length - 1]?.definition;
    }

    public exit(declaration: SemanticDeclaration): SourceDefinition {
        const pending = this.stack.pop();
        if (pending === undefined) {
            throw new Error(`Declaration ${declaration.name} exited without being entered.`);
        }

        if (pending.declaration.name !== declaration.name || pending.declaration.kind !== declaration.kind) {
            throw new Error(`Tried to exit declaration ${declaration.name} while inside ${pending.declaration.name}.`);
        }

        return pending.definition;
    }
}

export function isVisibleOnEnter(kind: SourceDefinitionKind): boolean {
    return kind === "function";
}
