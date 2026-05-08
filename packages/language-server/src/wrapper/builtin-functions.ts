import type { BaseDefinition } from "server/analysis/model.js";
import { createLogger } from "server/utils/logger.js";

import { getWrapperClient } from "./client.js";
import type { WrapperDaemonResponse } from "./protocol.js";

export interface WrapperBuiltinFunctionSignature {
    parameterTypes: string[];
    returnType: string;
}

export interface BuiltInFunctionListResponseBody {
    builtinFunctions: Record<string, WrapperBuiltinFunctionSignature>;
}

export const REQUEST_TYPE_BUILTIN_FUNCTIONS = "builtinFunctions" as const;

export interface BuiltinFunctionsRequestPayload {
    requestType: typeof REQUEST_TYPE_BUILTIN_FUNCTIONS;
}

export type BuiltinFunctionListResponse = WrapperDaemonResponse<
    typeof REQUEST_TYPE_BUILTIN_FUNCTIONS,
    BuiltInFunctionListResponseBody
>;

export interface BuiltinFunctionDefinition extends BaseDefinition {
    name: string;
    kind: "builtin-function";
    signature: WrapperBuiltinFunctionSignature;
    isBuiltin: true;
}

const DEFAULT_FUNCTION_PREFIXES = ["fn", "jn", "math", "map", "array"] as const;
const BUILTIN_FUNCTIONS_REQUEST: BuiltinFunctionsRequestPayload = {
    requestType: REQUEST_TYPE_BUILTIN_FUNCTIONS,
};

let builtinDefinitionsPromise: Promise<Map<string, BuiltinFunctionDefinition>> | null = null;
const logger = createLogger("wrapper:builtin-functions");

async function getBuiltinFunctionMap(): Promise<Map<string, BuiltinFunctionDefinition>> {
    if (builtinDefinitionsPromise !== null) {
        return builtinDefinitionsPromise;
    }

    builtinDefinitionsPromise = (async () => {
        const response = await getWrapperClient()
            .sendRequest<typeof REQUEST_TYPE_BUILTIN_FUNCTIONS>(BUILTIN_FUNCTIONS_REQUEST)
            .catch((error) => {
                logger.warn(
                    `Failed to fetch builtin function definitions from wrapper: ${String(error)}`,
                );
                return undefined;
            });

        const builtinDefinitionsByName = new Map<string, BuiltinFunctionDefinition>();

        if (response !== undefined) {
            for (const [name, signature] of Object.entries(response.body.builtinFunctions)) {
                builtinDefinitionsByName.set(name, {
                    name,
                    kind: "builtin-function",
                    signature,
                    references: [],
                    isBuiltin: true,
                });
            }
        }

        return builtinDefinitionsByName;
    })();

    return builtinDefinitionsPromise;
}

export async function findBuiltinFunctionDefinition(
    nameWithArity: string,
): Promise<BuiltinFunctionDefinition | undefined> {
    const builtinFunctionMap = await getBuiltinFunctionMap();
    const direct = builtinFunctionMap.get(nameWithArity);
    if (direct !== undefined) {
        return direct;
    }

    const hashIndex = nameWithArity.lastIndexOf("#");
    if (hashIndex === -1) {
        return undefined;
    }

    const name = nameWithArity.slice(0, hashIndex);
    const arity = nameWithArity.slice(hashIndex + 1);
    if (name.includes(":")) {
        return undefined;
    }

    for (const prefix of DEFAULT_FUNCTION_PREFIXES) {
        const candidate = builtinFunctionMap.get(`${prefix}:${name}#${arity}`);
        if (candidate !== undefined) {
            return candidate;
        }
    }

    return undefined;
}

export async function listBuiltinFunctionDefinitions(): Promise<BuiltinFunctionDefinition[]> {
    return [...(await getBuiltinFunctionMap()).values()];
}
