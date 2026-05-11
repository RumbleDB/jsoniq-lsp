import { definitionNameToString, SourceDefinition } from "server/analysis/model.js";

const INFERENCE_KEY_SEPARATOR = "\u001F";

export type InferenceKey = string;

export function buildInferenceKey(
    kind: string,
    position: { line: number; character: number },
    ...names: string[]
): InferenceKey {
    return [kind, position.line, position.character, ...names].join(INFERENCE_KEY_SEPARATOR);
}

export function buildInferenceKeyForDefinition(definition: SourceDefinition): InferenceKey {
    switch (definition.kind) {
        case "function":
            return buildInferenceKey(
                "function",
                definition.range.start,
                definitionNameToString(definition),
            );
        case "parameter":
            return buildInferenceKey(
                "parameter",
                definition.function.range.start,
                definitionNameToString(definition.function),
                definitionNameToString(definition),
            );
        default:
            return buildInferenceKey(
                definition.kind,
                definition.range.start,
                definitionNameToString(definition),
            );
    }
}
