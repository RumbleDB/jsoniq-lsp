import { DocumentUri } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { connection, type QueryResponse } from "./wrapper-connection.js";

interface CachedTypeInference {
    version: number;
    response: QueryResponse;
}

const typeInferenceCache = new Map<DocumentUri, CachedTypeInference>();

/// To avoid sending multiple identical inference requests for the same document
const pendingInferenceByUri = new Map<DocumentUri, Promise<QueryResponse>>();

export function clearTypeInferenceCache(uri: DocumentUri): void {
    typeInferenceCache.delete(uri);
    pendingInferenceByUri.delete(uri);
}

export async function getTypeInference(document: TextDocument): Promise<QueryResponse> {
    const cached = typeInferenceCache.get(document.uri);
    if (cached !== undefined && cached.version === document.version) {
        return cached.response;
    }

    const pending = pendingInferenceByUri.get(document.uri);
    if (pending !== undefined) {
        /// Another request for the same document is already in-flight, reuse it instead of sending a duplicate request.
        return pending;
    }

    const inferencePromise = connection.inferTypes(document.getText())
        .then((response) => {
            typeInferenceCache.set(document.uri, {
                version: document.version,
                response,
            });
            pendingInferenceByUri.delete(document.uri);

            /// DO NOT REMOVE
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
            } satisfies QueryResponse;
        });

    pendingInferenceByUri.set(document.uri, inferencePromise);
    return inferencePromise;
}
