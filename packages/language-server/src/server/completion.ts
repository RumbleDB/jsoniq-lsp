import {
    CompletionItemKind,
    TextEdit,
    type CompletionItem,
    type Position,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { jsoniqParser } from "../grammar/jsoniqParser.js";
import type { BaseDefinition } from "./analysis/model.js";
import { getVisibleDeclarationsAtPosition } from "./analysis/queries.js";
import { listBuiltinFunctionDefinitions } from "./wrapper/builtin-functions.js";
import {
    EXPRESSION_KEYWORD_TOKENS,
    EXPRESSION_RULES,
    FLOWR_CONTINUATION_TOKENS,
    KEYWORD_COMPLETIONS,
    NON_DOLLAR_EXPRESSION_START_TOKENS,
    VARIABLE_DECLARATION_NAME_RULES,
    VARIABLE_DECLARATION_RULES,
} from "./parser/adapters/jsoniq/completion-data.js";
import {
    collectCompletionContext,
} from "./parser/index.js";
import type { ParserSyntaxContext } from "./parser/types.js";

export async function findCompletions(document: TextDocument, position: Position): Promise<CompletionItem[]> {
    const source = document.getText();
    const cursorOffset = document.offsetAt(position);
    const context = collectCompletionContext(document, cursorOffset);

    if (context === null) {
        return [];
    }

    // Find the prefix of the variable or name being typed, if any. 
    // This is used to determine whether to offer variable or name completions, and to limit the completion suggestions to those matching the prefix.
    const variablePrefix = source.slice(0, cursorOffset).match(VARIABLE_PREFIX_PATTERN)?.[0] ?? null;
    const typingVariablePrefix = variablePrefix !== null;

    /// Similarly, check if the user is typing a name (e.g. for a function or variable declaration) to offer appropriate completions and filtering.
    const typingNamePrefix = NAME_PREFIX_PATTERN.test(source.slice(0, cursorOffset));

    /// Determine whether we are in a context where a variable is being declared (e.g. the "$x" in "let $x := ..."), 
    // which affects whether we offer variable completions and whether to include the "$" declaration starter.
    const insideVariableBindingHeader = isInsideVariableBindingHeader(context);

    // In declaration contexts, we want to offer keyword completions (e.g. "declare function") as well as a "$" completion for variable declarations, but not variable reference completions.
    const declaringVariableName = insideVariableBindingHeader && (
        context.expectedTokenSet.contains(jsoniqParser.Kdollar)
        || VARIABLE_DECLARATION_NAME_RULES.has(context.ruleStack[0] ?? -1)
    );

    // We are expecting a name if we are declaring a variable and the expected tokens include "$", 
    // or if the syntax context is explicitly a qname (e.g. in a function declaration or prolog declaration)
    const expectingName = declaringVariableName || context.ruleStack[0] === jsoniqParser.RULE_qname;

    // Do we expect an expression here?
    const expressionReferenceContext = isExpressionReferenceContext(context);

    // We allow variable completions when
    // - We are not declaring a variable name
    // - AND EITHER we are typing a variable reference (i.e. we have a "$" prefix) OR we are in an expression context where a variable reference could be expected.
    const allowVariableSuggestions = !insideVariableBindingHeader
        && (typingVariablePrefix || expressionReferenceContext);

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
        && !declaringVariableName
        && expressionReferenceContext;

    const topLevelModuleStartContext = context.ruleStack.length === 0
        && context.expectedTokenSet.contains(jsoniqParser.Kmodule);
    const filterKeywordsAsExpression = expressionReferenceContext && !topLevelModuleStartContext;

    const builtinFunctions = allowBuiltinFunctionSuggestions
        ? getBuiltinFunctionCompletionItems()
        : [];

    // We offer keyword completions when we are not typing name
    const keywords = !typingVariablePrefix && !typingNamePrefix && !expectingName
        ? keywordCompletions(context, filterKeywordsAsExpression)
        : [];

    // In case that we are declaring a variable and $ is not typed yet, offer a $ completion item to start the variable declaration
    const declarationPrefix = declaringVariableName && !typingVariablePrefix
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

/**
 * Determines whether we are in a context where a variable name is being declared, based on the syntax context.
 */
function isInsideVariableBindingHeader(context: ParserSyntaxContext): boolean {
    const declarationDepth = firstIndexOfRule(context.ruleStack, VARIABLE_DECLARATION_RULES);

    if (declarationDepth === -1) {
        return context.ruleStack.length === 0
            && context.expectedTokenSet.contains(jsoniqParser.Kdollar)
            && !hasExpectedToken(context, NON_DOLLAR_EXPRESSION_START_TOKENS);
    }

    // If we are already inside an expression nested in a declaration construct
    // (e.g. let $x := <expr>), this is no longer a declaration-name site.
    const expressionDepth = firstIndexOfRule(context.ruleStack, EXPRESSION_RULES);
    if (expressionDepth !== -1 && expressionDepth < declarationDepth) {
        return false;
    }

    return true;
}

/**
 * Check if we are in a context where an expression can be expected
 * @param context current syntax context at the cursor position
 * @returns true if we are in an expression context, false otherwise
 */
function isExpressionReferenceContext(context: ParserSyntaxContext): boolean {
    if (context.ruleStack[0] === jsoniqParser.RULE_qname) {
        // we are expecting a name, not an expression
        return false;
    }

    // With an empty rule stack, we can still distinguish the start of a module
    // from expression-capable locations by checking whether `module` is expected.
    if (context.ruleStack.length === 0) {
        if (hasExpectedToken(context, NON_DOLLAR_EXPRESSION_START_TOKENS)) {
            return true;
        }

        return !context.expectedTokenSet.contains(jsoniqParser.Kmodule);
    }

    const insideFlowrExpression = context.ruleStack.includes(jsoniqParser.RULE_flowrExpr);
    if (insideFlowrExpression
        && hasExpectedToken(context, FLOWR_CONTINUATION_TOKENS)
        && !context.expectedTokenSet.contains(jsoniqParser.Kdollar)) {
        // If we are in a continuation clause of a FLWOR expression (e.g. after a "where" or "group by")
        // For example:
        //      for $x in items
        //      let $y := $x
        //      | <- here we expect a "where", "group by", "order by" or "count" continuation, but not an expression starting with "$"
        return false;
    }

    // In all other cases, we are in an expression context if either the grammar explicitly allows an expression to start here (e.g. after an "=" or "return")
    // or if we are already inside an expression (e.g. in the "then" branch of an if expression)
    const insideExpressionRule = firstIndexOfRule(context.ruleStack, EXPRESSION_RULES) !== -1;
    return insideExpressionRule || hasExpectedToken(context, NON_DOLLAR_EXPRESSION_START_TOKENS);
}

/**
 * Finds the index of the first occurrence of any of the candidate rules in the rule stack.
 * @param ruleStack the current syntax context's rule stack
 * @param candidates the set of candidate rules to look for
 * @returns the index of the first occurrence of any candidate rule, or -1 if none are found
 */
function firstIndexOfRule(ruleStack: number[], candidates: Set<number>): number {
    const index = ruleStack.findIndex((rule) => candidates.has(rule));
    return index;
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

function keywordCompletions(context: ParserSyntaxContext, expressionReferenceContext: boolean): CompletionItem[] {
    return KEYWORD_COMPLETIONS
        .filter((completion) => context.expectedTokenSet.contains(completion.tokenType))
        .filter((completion) => {
            if (!expressionReferenceContext) {
                // Not writing an expression, so offer keywords that are explicitly expected here
                return true;
            }
            else {
                // In expression contexts, only offer keywords that can start an expression.
                return EXPRESSION_KEYWORD_TOKENS.has(completion.tokenType);
            }
        })
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

function hasExpectedToken(context: ParserSyntaxContext, tokenTypes: Set<number>): boolean {
    return [...tokenTypes.values()]
        .some((tokenType) => context.expectedTokenSet.contains(tokenType));
}
