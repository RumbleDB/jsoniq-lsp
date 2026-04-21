import {
    DiagnosticSeverity,
    type Diagnostic,
    SemanticTokensBuilder,
    type SemanticTokens,
    SemanticTokensLegend,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Range } from "vscode-languageserver";
import { DefinitionKind, getAnalysis } from "./analysis.js";

export const legend: SemanticTokensLegend = {
    tokenTypes: ["function", "parameter", "variable"],
    tokenModifiers: ["user", "builtin"],
};

const USER_MODIFIER_MASK = 1 << 0;
const defaultLibraryModifierMask = 1 << 1;

export async function collectSemanticDiagnostics(document: TextDocument): Promise<Diagnostic[]> {
    const analysis = await getAnalysis(document);
    const diagnostics: Diagnostic[] = [];

    for (const reference of analysis.unresolvedReferences) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: reference.range,
            message: `Unresolved variable reference '${reference.name}'.`,
            source: "jsoniq-semantic",
        });
    }

    return diagnostics;
}

function addSemanticToken(
    builder: SemanticTokensBuilder,
    selectionRange: Range,
    tokenType: number,
    tokenModifiers: number
): void {
    builder.push(
        selectionRange.start.line,
        selectionRange.start.character,
        selectionRange.end.character - selectionRange.start.character,
        tokenType,
        tokenModifiers
    );
}

export async function collectSemanticTokens(document: TextDocument): Promise<SemanticTokens> {
    const analysis = await getAnalysis(document);
    const builder = new SemanticTokensBuilder();

    for (const definition of analysis.definitions) {
        const tokenType = getTokenTypeForDefinition(definition.kind);
        const tokenModifiers = getTokenModifierForDefinition(definition.kind);
        addSemanticToken(builder, definition.selectionRange, tokenType, tokenModifiers);
    }

    for (const reference of analysis.references) {
        const tokenType = getTokenTypeForDefinition(reference.declaration.kind);
        const tokenModifiers = getTokenModifierForDefinition(reference.declaration.kind);
        addSemanticToken(builder, reference.range, tokenType, tokenModifiers);
    }

    return builder.build();
}

function getTokenTypeForDefinition(kind: DefinitionKind): number {
    switch (kind) {
        case "builtin-function":
        case "function":
            return 0;
        case "parameter":
            return 1;
        case "declare-variable":
        case "let":
        case "for":
        case "for-position":
        case "group-by":
        case "count":
            return 2;
    }
}

function getTokenModifierForDefinition(kind: DefinitionKind): number {
    switch (kind) {
        case "builtin-function":
            return defaultLibraryModifierMask;
        default:
            return USER_MODIFIER_MASK;
    }
}