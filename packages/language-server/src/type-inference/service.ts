import {
    type SourceDefinition,
    type SourceFunctionDefinition,
    type SourceParameterDefinition,
    type SourceVariableDefinition,
} from "server/analysis/model.js";
import {
    getTypeInference,
    type InferredFunctionType,
    type InferredSequenceType,
    type InferredType,
    type TypeInferenceResult,
} from "server/wrapper/type-inference.js";
import { DocumentUri, TextDocument } from "vscode-languageserver-textdocument";

import { buildInferenceKey, buildInferenceKeyForDefinition, InferenceKey } from "./key.js";

export interface TypeInferenceIndex {
    get(definition: SourceFunctionDefinition): InferredFunctionType | undefined;
    get(definition: SourceParameterDefinition): InferredSequenceType | undefined;
    get(definition: SourceVariableDefinition): InferredSequenceType | undefined;
    get(definition: SourceDefinition): InferredType | undefined;
}

export const EMPTY_TYPE_INFERENCE_INDEX: TypeInferenceIndex = {
    get: () => undefined,
};

function buildTypeInferenceIndex(entries: TypeInferenceResult["types"]): TypeInferenceIndex {
    const result = new Map<InferenceKey, InferredType>();

    for (const entry of entries) {
        if (entry.kind === "function") {
            const {
                name: functionName,
                position: functionPosition,
                returnType,
                parameters,
            } = entry;
            const functionKey = buildInferenceKey("function", functionPosition, functionName);

            result.set(functionKey, { returnType, parameters });

            for (const parameter of parameters) {
                const parameterKey = buildInferenceKey(
                    "parameter",
                    functionPosition,
                    functionName,
                    parameter.name,
                );
                result.set(parameterKey, { sequenceType: parameter.sequenceType });
            }
        } else {
            result.set(buildInferenceKey(entry.variableKind, entry.position, entry.name), {
                sequenceType: entry.sequenceType,
            });
        }
    }

    function get(definition: SourceFunctionDefinition): InferredFunctionType | undefined;
    function get(definition: SourceParameterDefinition): InferredSequenceType | undefined;
    function get(definition: SourceVariableDefinition): InferredSequenceType | undefined;
    function get(definition: SourceDefinition): InferredType | undefined {
        const key = buildInferenceKeyForDefinition(definition);
        return result.get(key);
    }

    return { get };
}

const typeInferenceIndexCache = new Map<
    DocumentUri,
    {
        index: TypeInferenceIndex;
        version: number;
    }
>();

export async function getTypeInferenceIndex(document: TextDocument): Promise<TypeInferenceIndex> {
    let cache = typeInferenceIndexCache.get(document.uri);

    if (cache === undefined || cache.version !== document.version) {
        const typeInferenceResult = await getTypeInference(document);
        cache = {
            index: buildTypeInferenceIndex(typeInferenceResult.body.types),
            version: document.version,
        };
        typeInferenceIndexCache.set(document.uri, cache);
    }

    return cache.index;
}
