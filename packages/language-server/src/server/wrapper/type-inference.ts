import type { DocumentUri, Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { WrapperDaemonResponse } from "./protocol.js";
import { wrapperClient } from "./client.js";

export type WrapperVariableKind =
    | "declare-variable"
    | "let"
    | "for"
    | "for-position"
    | "group-by"
    | "count";

export interface WrapperVariableType {
    name: string;
    type: string;
    kind: WrapperVariableKind;
}

export interface WrapperFunctionType {
    position: Position;
    name: string;
    parameterTypes: Array<{
        name: string;
        type: string;
    }>;
    returnType: string;
}

export interface WrapperTypeError {
    code: string;
    message: string;
    location: string;
    position: Position;
}

export interface TypeInferenceResult {
    variableTypes: WrapperVariableType[];
    functionTypes: WrapperFunctionType[];
    typeErrors: WrapperTypeError[];
}

export const REQUEST_TYPE_INFER_TYPES = "inferTypes" as const;

export interface InferTypesRequestPayload {
    requestType: typeof REQUEST_TYPE_INFER_TYPES;
    body: string;
}

export type TypeInferenceResponse = WrapperDaemonResponse<typeof REQUEST_TYPE_INFER_TYPES, TypeInferenceResult>;

interface CachedTypeInference {
    version: number;
    response: TypeInferenceResponse;
}

const typeInferenceCache = new Map<DocumentUri, CachedTypeInference>();

// Avoid sending multiple identical inference requests for the same document.
const pendingInferenceByUri = new Map<DocumentUri, Promise<TypeInferenceResponse>>();

export function clearTypeInferenceCache(uri: DocumentUri): void {
    typeInferenceCache.delete(uri);
    pendingInferenceByUri.delete(uri);
}

export async function getTypeInference(document: TextDocument): Promise<TypeInferenceResponse> {
    const cached = typeInferenceCache.get(document.uri);
    if (cached !== undefined && cached.version === document.version) {
        return cached.response;
    }

    const pending = pendingInferenceByUri.get(document.uri);
    if (pending !== undefined) {
        return pending;
    }

    const inferencePromise = wrapperClient.inferTypes(document.getText())
        .then((response) => {
            typeInferenceCache.set(document.uri, {
                version: document.version,
                response,
            });
            pendingInferenceByUri.delete(document.uri);

            // DO NOT REMOVE
            console.log(`Type inference completed for ${document.uri} (version ${document.version})`);
            console.log(JSON.stringify(response, null, 2));
            return response;
        })
        .catch(() => {
            pendingInferenceByUri.delete(document.uri);
            return {
                id: -1,
                responseType: "inferTypes",
                body: {
                    variableTypes: [],
                    functionTypes: [],
                    typeErrors: [],
                },
                error: "Wrapper request failed.",
            } satisfies TypeInferenceResponse;
        });

    pendingInferenceByUri.set(document.uri, inferencePromise);
    return inferencePromise;
}
