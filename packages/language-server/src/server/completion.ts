import {
    CompletionItemKind,
    TextEdit,
    type CompletionItem,
    type Position,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { BaseDefinition } from "./analysis/model.js";
import { getVisibleDeclarationsAtPosition } from "./analysis/queries.js";
import { listBuiltinFunctionDefinitions } from "./wrapper/builtin-functions.js";
import { collectCompletionIntent } from "./parser/index.js";

export async function findCompletions(document: TextDocument, position: Position): Promise<CompletionItem[]> {
    const source = document.getText();
    const cursorOffset = document.offsetAt(position);
    const intent = collectCompletionIntent(document, cursorOffset);

    if (intent === null) {
        return [];
    }

    // Find the prefix of the variable or name being typed, if any.
    // This is used to determine whether to offer variable or name completions, and to limit the completion suggestions to those matching the prefix.
    const variablePrefix = source.slice(0, cursorOffset).match(VARIABLE_PREFIX_PATTERN)?.[0] ?? null;
    const typingVariablePrefix = variablePrefix !== null;

    // Similarly, check if the user is typing a name (e.g. for a function or variable declaration) to offer appropriate completions and filtering.
    const typingNamePrefix = NAME_PREFIX_PATTERN.test(source.slice(0, cursorOffset));

    // We allow variable completions when:
    // - We are not declaring a variable name
    // - AND EITHER we are typing a variable reference (i.e. we have a "$" prefix) OR we are in an expression context where a variable reference could be expected.
    const allowVariableSuggestions = !intent.insideVariableBindingHeader
        && (typingVariablePrefix || intent.expressionReferenceContext);

    // If we have already typed part of a variable name, we want to replace that prefix with the completion,
    // This is to avoid inserting the completion after the prefix, which would result in an invalid variable name 
    const variableReplaceRange = variablePrefix === null
        ? null
        : {
            start: document.positionAt(cursorOffset - variablePrefix.length),
            end: position,
        };

    const variables = allowVariableSuggestions
        ? (await getDeclarationCompletionItems(document, position))
            .map((item) => variableReplaceRange === null
                ? item
                : {
                    ...item,
                    textEdit: TextEdit.replace(variableReplaceRange, item.label),
                })
        : [];

    const allowBuiltinFunctionSuggestions = !typingVariablePrefix
        && !intent.declaringVariableName
        && intent.expressionReferenceContext;

    const builtinFunctions = allowBuiltinFunctionSuggestions
        ? getBuiltinFunctionCompletionItems()
        : [];

    // We offer keyword completions when we are not typing name.
    const keywords = !typingVariablePrefix && !typingNamePrefix && !intent.expectingName
        ? keywordCompletions(intent.keywords)
        : [];

    // In case that we are declaring a variable and $ is not typed yet, offer a $ completion item to start the variable declaration.
    const declarationPrefix = intent.declaringVariableName && !typingVariablePrefix
        ? [DOLLAR_COMPLETION]
        : [];

    return withSortText([
        ...declarationPrefix,
        ...keywords,
        ...variables,
        ...builtinFunctions,
    ]);
}

/**
 * Returns only visible variable/function declarations. Tests use this directly
 * to keep scope analysis separate from grammar-driven keyword completion.
 */
export async function findVariableCompletions(document: TextDocument, position: Position): Promise<CompletionItem[]> {
    return withSortText(await getDeclarationCompletionItems(document, position));
}

async function getDeclarationCompletionItems(document: TextDocument, position: Position): Promise<CompletionItem[]> {
    return (await getVisibleDeclarationsAtPosition(document, position)).map(toCompletionItem);
}

function toCompletionItem(declaration: BaseDefinition): CompletionItem {
    if (declaration.kind === "function") {
        const [name, arity] = declaration.name.split("#", 2);
        return {
            label: name ?? declaration.name,
            kind: CompletionItemKind.Function,
            detail: arity === undefined ? "JSONiq function" : `JSONiq function/${arity}`,
        };
    }

    return {
        label: declaration.name,
        kind: CompletionItemKind.Variable,
        detail: `JSONiq ${declaration.kind}`,
    };
}

function getBuiltinFunctionCompletionItems(): CompletionItem[] {
    return listBuiltinFunctionDefinitions().map((definition) => {
        const [name, arity] = definition.name.split("#", 2);
        const parameterTypes = definition.signature.parameterTypes.join(", ");
        const functionName = name ?? definition.name;
        const detailArity = arity === undefined ? "JSONiq builtin function" : `JSONiq builtin function/${arity}`;
        const signature = `${functionName}(${parameterTypes}) as ${definition.signature.returnType}`;

        return {
            label: functionName,
            kind: CompletionItemKind.Function,
            detail: detailArity,
            documentation: signature,
        };
    });
}

function keywordCompletions(keywords: Array<{ label: string; insertText?: string }>): CompletionItem[] {
    return keywords
        .map((completion) => ({
            label: completion.label,
            ...(completion.insertText === undefined ? {} : { insertText: completion.insertText }),
            kind: CompletionItemKind.Keyword,
            detail: "JSONiq keyword",
        }));
}

function withSortText(items: CompletionItem[]): CompletionItem[] {
    return items
        .sort((left, right) => left.label.localeCompare(right.label))
        .map((item, index) => ({
            ...item,
            sortText: `${index.toString().padStart(5, "0")}:${item.label}`,
        }));
}

const VARIABLE_PREFIX_PATTERN = /\$[A-Za-z0-9_.:-]*$/;
const NAME_PREFIX_PATTERN = /(?:^|[^$A-Za-z0-9_.:-])[A-Za-z_][A-Za-z0-9_.:-]*$/;

const DOLLAR_COMPLETION: CompletionItem = {
    label: "$",
    insertText: "$",
    kind: CompletionItemKind.Variable,
    detail: "JSONiq variable declaration",
};
