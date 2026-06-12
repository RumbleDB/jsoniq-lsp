import fs from "node:fs";
import path from "node:path";

import { defaultNamespaces } from "server/analysis/default-namespaces.js";
import { QNameToString, type FunctionName } from "server/analysis/names.js";
import type { FunctionEntry } from "server/function-doc/types.js";
import { getAssetsPath } from "server/utils/assets.js";
import type { WrapperFunctionSignature } from "server/wrapper/types.js";

export interface BuiltinFunctionRaw {
    name: FunctionName;
    signature: WrapperFunctionSignature;
}

const docs: Record<string, FunctionEntry> = {};
let docsLoaded = false;

export function loadJsonAsset<T>(relativeAssetPath: string): T | null {
    try {
        const assetsPath = getAssetsPath();
        const filePath = path.join(assetsPath, relativeAssetPath);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf-8");
            return JSON.parse(content) as T;
        }
    } catch (error) {
        console.error(`Failed to load JSON asset '${relativeAssetPath}':`, error);
    }
    return null;
}

function processDocs(fileDocs: Record<string, FunctionEntry>): void {
    for (const [originalKey, value] of Object.entries(fileDocs)) {
        const [prefix, localName] = originalKey.split(":");
        const namespace = defaultNamespaces.get(prefix!);
        if (!namespace) {
            continue;
        }
        const key = QNameToString({ localName: localName!, namespaceUri: namespace }, true);
        docs[key] = value;
    }
}

export function loadFunctionDocs(): Record<string, FunctionEntry> {
    if (docsLoaded) {
        return docs;
    }

    const w3Docs = loadJsonAsset<Record<string, FunctionEntry>>("function-doc/w3-functions.json");
    if (w3Docs !== null) {
        processDocs(w3Docs);
    }

    const customDocs = loadJsonAsset<Record<string, FunctionEntry>>(
        "function-doc/custom-functions.json",
    );
    if (customDocs !== null) {
        processDocs(customDocs);
    }

    docsLoaded = true;
    return docs;
}
