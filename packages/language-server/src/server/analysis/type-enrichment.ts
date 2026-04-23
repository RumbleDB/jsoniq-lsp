import { FunctionDeclContext } from "../../grammar/jsoniqParser.js";
import { functionName } from "../utils/name.js";
import type { JsoniqAnalysis } from "./model.js";
import type { TypeInferenceResult } from "../wrapper/type-inference.js";

export function injectInferredTypeToAnalysis(analysis: JsoniqAnalysis, inferredTypes: TypeInferenceResult): void {
    const variables = inferredTypes.variableTypes.values();
    const functions = inferredTypes.functionTypes.values();

    for (const definition of analysis.definitions) {
        if (definition.kind === "parameter") {
            continue;
        }

        if (definition.kind === "function") {
            const functionType = functions.next();
            if (functionType.done) {
                throw new Error(`Requested inferred type for ${definition.name}, but no more function types are available in the inference response.`);
            }

            const { name: expectedName, parameterTypes, returnType } = functionType.value;
            const name = functionName(definition.node as FunctionDeclContext);

            if (name !== expectedName) {
                throw new Error(`Inferred function type name ${expectedName} does not match the function declaration name ${name} in the source code.`);
            }

            const parameterTypeStrings = parameterTypes.map(({ name: parameterName, type }) => `${parameterName}: ${type}`);
            definition.inferredType = `(${parameterTypeStrings.join(", ")}) => ${returnType}`;

            const parameterDefinitions = definition.parameters;
            if (parameterDefinitions.length !== parameterTypes.length) {
                throw new Error(`Inferred function type for ${definition.name} has ${parameterTypes.length} parameters, but the function declaration has ${parameterDefinitions.length} parameters.`);
            }

            for (let i = 0; i < parameterDefinitions.length; i += 1) {
                const parameterDefinition = parameterDefinitions[i]!;
                const parameterType = parameterTypes[i]!;
                if (parameterDefinition.name !== parameterType.name) {
                    throw new Error(`Inferred function parameter type name ${parameterType.name} does not match the parameter declaration name ${parameterDefinition.name} in the source code.`);
                }
                parameterDefinition.inferredType = parameterType.type;
            }

            continue;
        }

        const variableType = variables.next();
        if (variableType.done) {
            throw new Error(`Requested inferred type for ${definition.name}, but no more variable types are available in the inference response.`);
        }

        const { name: expectedName, type } = variableType.value;
        if (definition.name !== expectedName) {
            throw new Error(`Inferred variable type name ${expectedName} does not match the variable declaration name ${definition.name} in the source code.`);
        }

        definition.inferredType = type;
    }
}
