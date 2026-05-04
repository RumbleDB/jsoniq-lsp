import {
    DiagnosticSeverity,
    Range,
    type Position,
    type Diagnostic,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getTypeInference, type WrapperTypeError } from "./wrapper/type-inference.js";

export async function collectTypeDiagnostics(document: TextDocument): Promise<Diagnostic[]> {
    const response = await getTypeInference(document);
    if (response.body.typeErrors.length === 0) {
        return [];
    }

    return response.body.typeErrors
        .map((error) => toDiagnostic(document, error));
}

function toDiagnostic(document: TextDocument, error: WrapperTypeError): Diagnostic {
    const diagnosticRange = createRangeFromStartPosition(document, error, error.position)

    return {
        severity: DiagnosticSeverity.Warning,
        range: diagnosticRange,
        code: error.code,
        source: "jsoniq-type",
        message: error.message,
    };
}

/**
 * We don't have the full range of errors from the wrapper,
 * for now, we'll just return the full line as the error range
 */
function createRangeFromStartPosition(
    document: TextDocument,
    error: WrapperTypeError,
    start: Position,
): Range {
    return {
        start,
        end: {
            line: start.line + 1,
            character: 0,
        }
    }
}
