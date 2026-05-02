import type { SemanticDeclaration } from "server/parser/semantic-events.js";
import type {
    SourceDefinition,
    SourceFunctionDefinition,
    SourceParameterDefinition,
    SourceVariableDefinition,
} from "./model.js";

export function createSourceDefinition(
    declaration: SemanticDeclaration,
    containingFunction?: SourceFunctionDefinition,
): SourceDefinition {
    const base = {
        name: declaration.name,
        range: declaration.range,
        selectionRange: declaration.selectionRange,
        scopeEnd: { line: 0, character: 0 },
        references: [],
        isBuiltin: false as const,
    };

    if (declaration.kind === "function") {
        return {
            ...base,
            kind: "function",
            parameters: [],
        } satisfies SourceFunctionDefinition;
    }

    if (declaration.kind === "parameter") {
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
        kind: declaration.kind,
    } satisfies SourceVariableDefinition;
}
