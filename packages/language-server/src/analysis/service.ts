import { DocumentUri } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getTypeInference } from "../wrapper/type-inference.js";
import { buildAnalysis } from "./builder.js";
import type { JsoniqAnalysis } from "./model.js";
import { injectInferredTypeToAnalysis } from "./type-enrichment.js";

interface CachedAnalysis {
    version: number;
    analysis: JsoniqAnalysis;
    options: {
        typeInference: boolean;
    };
}

const analysisCache = new Map<DocumentUri, CachedAnalysis>();

export async function getAnalysis(document: TextDocument, options: {
    typeInference: boolean;
} = { typeInference: false }): Promise<JsoniqAnalysis> {
    const cached = analysisCache.get(document.uri);

    if (cached !== undefined && cached.version === document.version) {
        if (options.typeInference && !cached.options.typeInference) {
            const inferredTypes = await getTypeInference(document);
            injectInferredTypeToAnalysis(cached.analysis, inferredTypes.body);
            cached.options.typeInference = true;
        };

        return cached.analysis;
    }

    const analysis = await buildAnalysis(document);

    if (options.typeInference) {
        const inferenceResult = await getTypeInference(document);
        if (inferenceResult.error === null) {
            injectInferredTypeToAnalysis(analysis, inferenceResult.body);
        }
    }

    analysisCache.set(document.uri, {
        version: document.version,
        analysis,
        options,
    });

    return analysis;
}
