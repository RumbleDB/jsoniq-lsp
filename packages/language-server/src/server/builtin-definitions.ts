import { BaseDefinition } from "./analysis.js";
import { connection, type WrapperBuiltinFunctionSignature } from "./wrapper-connection.js";

export interface BuiltinFunctionDefinition extends BaseDefinition {
    name: string;
    kind: "builtin-function";
    signature: WrapperBuiltinFunctionSignature;

    isBuiltin: true;
}

const builtinDefinitionsByName = new Map<string, BuiltinFunctionDefinition>();
let initializationPromise: Promise<void> | null = null;

export async function initializeBuiltinFunctionDefinitions(): Promise<void> {
    if (initializationPromise !== null) {
        return initializationPromise;
    }

    initializationPromise = (async () => {
        const response = await connection.listBuiltinFunctions();
        if (response.error !== null) {
            return;
        }

        builtinDefinitionsByName.clear();
        for (const [name, signature] of Object.entries(response.body.builtinFunctions)) {
            builtinDefinitionsByName.set(name, {
                name,
                kind: "builtin-function",
                signature,
                references: [],
                isBuiltin: true,
            });
        }
    })();

    return initializationPromise;
}

export function findBuiltinFunctionDefinition(nameWithArity: string): BuiltinFunctionDefinition | undefined {
    const direct = builtinDefinitionsByName.get(nameWithArity);
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

    for (const prefix of ["fn", "jn", "math", "map", "array"]) {
        const candidate = builtinDefinitionsByName.get(`${prefix}:${name}#${arity}`);
        if (candidate !== undefined) {
            return candidate;
        }
    }

    return undefined;
}

export function listBuiltinFunctionDefinitions(): BuiltinFunctionDefinition[] {
    return [...builtinDefinitionsByName.values()];
}
