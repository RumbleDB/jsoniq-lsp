import { ParserRuleContext, type ParseTree } from "antlr4ng";
import {
    DocumentSymbol,
    DocumentUri,
    type Position,
    type Range,
    SymbolKind,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    ContextItemDeclContext,
    CountClauseContext,
    ForVarContext,
    FunctionDeclContext,
    FunctionCallContext,
    GroupByVarContext,
    LetVarContext,
    NamedFunctionRefContext,
    NamespaceDeclContext,
    ParamContext,
    TypeDeclContext,
    VarDeclContext,
    VarRefContext,
} from "../grammar/jsoniqParser.js";
import { parseJsoniqDocument } from "./parser.js";
import { upperBound } from "./utils/binary-search.js";
import { rangeFromNode } from "./utils/range.js";
import { isNewScopeNode } from "./utils/scope.js";
import { comparePositions } from "./utils/position.js";
import { functionNameWithArityOrNull, varRefNameOrNull } from "./utils/name.js";
import { findBuiltinFunctionDefinition, type BuiltinFunctionDefinition } from "./builtin-definitions.js";

export type DefinitionKind =
    | "declare-variable"
    | "let"
    | "for"
    | "for-position"
    | "group-by"
    | "count"
    | "parameter"
    | "function"
    | "builtin-function";

export interface BaseDefinition {
    name: string;
    kind: DefinitionKind;

    /// List of references that resolve to this declaration
    references: Reference[];

    isBuiltin: boolean;
}

/**
 * Represents a variable declaration in the source code, including its name, kind (e.g. function parameter, FLWOR clause variable, etc.), 
 * the corresponding parse tree node, and the range of the declaration in the source document.
 */
export interface SourceDefinition extends BaseDefinition {
    node: ParseTree;

    /// Range = the entire range of the declaration
    /// For example, for a variable declaration like "let $x := 10", the range would cover the entire "let $x := 10" expression.
    range: Range;

    /// Selection range = the range of the variable name within the declaration, which should be used for features like "go to definition" to navigate to the variable name rather than the entire declaration.
    /// For example, for a variable declaration like "let $x := 10", the selection range would cover just the "$x" part of the expression.
    selectionRange: Range;

    /// Position where this definition is not visible anymore
    scopeEnd: Position;

    isBuiltin: false;
}

export type Definition = SourceDefinition | BuiltinFunctionDefinition;

/**
 * Represents a reference to a variable or function in the source code, along with a reference to the corresponding declaration (if it can be resolved).
 */
export interface Reference {
    name: string;
    node: ParseTree;
    range: Range;
    declaration: Definition | undefined;
}

/**
 * Interface used for both variable declarations and references to enable efficient lookup of the declaration corresponding to a given source position.
 */
export interface OccurrenceIndexEntry {
    range: Range;
    declaration: Definition;

    /** The reference corresponding to this occurrence, if it is a reference. Undefined for declaration occurrences. */
    reference: Reference | undefined;
}

/**
 * Results of variable scope analysis for a JSONiq document
*/
export interface JsoniqAnalysis {
    /** All variable declarations found in the document, sorted by declaration position in source order. */
    definitions: SourceDefinition[];

    /** All variable references found in the document, in the order they were encountered during traversal. */
    references: Reference[];

    /** A sorted index of all variable occurrences (declarations and references) in the document, sorted by their position in the source code. */
    occurrenceIndex: OccurrenceIndexEntry[];

    /** Document symbols found while traversing the parse tree. */
    documentSymbols: DocumentSymbol[];
}

interface ScopeFrame {
    /** 
     * Map from variable names to their corresponding declarations within this scope frame. 
     * Because variable shadows can occur, we save all of them in a list, but only the nearest declaration (the last one in the list) is the one that should be resolved from references in this scope.
     * */
    definitionByName: Map<string, Array<SourceDefinition>>;
}

interface SymbolTraversalState {
    childSymbols: DocumentSymbol[];
    declarationContainerSymbol?: DocumentSymbol;
    declarationChildSymbols?: DocumentSymbol[];
}

/**
 * Analyzes the variable scopes in a JSONiq document, returning all variable declarations and references along with their relationships.
 * This is used for features like "go to definition" and "find references" in the language server.
 * 
 * @param document The TextDocument representing the JSONiq source code to analyze
 * @returns An object containing the results of variable scope analysis, including all variable declarations and references along with their relationships
 */
export function analyzeVariableScopes(document: TextDocument): JsoniqAnalysis {
    const parseResult = parseJsoniqDocument(document);
    const definitions: SourceDefinition[] = [];
    const references: Reference[] = [];
    const occurrenceIndex: OccurrenceIndexEntry[] = [];
    const documentSymbols: DocumentSymbol[] = [];
    const scopeStack: ScopeFrame[] = [{ definitionByName: new Map() }];

    const pushScope = (): void => {
        scopeStack.push({ definitionByName: new Map() });
    };

    const popScope = (scopeEnd: Position): void => {
        const scope = scopeStack.pop();
        if (scope !== undefined) {
            for (const definitions of scope.definitionByName.values()) {
                /// Only the last one ends at the scope boundary, because of variable shadowing.
                /// Previous declarations with the same name has smaller scopeEnd, updated when new variable with the same name is declared in the same scope.
                const lastDefinition = definitions[definitions.length - 1];
                if (lastDefinition !== undefined) {
                    lastDefinition.scopeEnd = scopeEnd;
                }
            }
        }
    };

    const currentScope = (): ScopeFrame => {
        const scope = scopeStack[scopeStack.length - 1];
        if (scope === undefined) {
            throw new Error("Variable scope stack is unexpectedly empty.");
        }
        return scope;
    };

    /** Declares a definition in the current scope and adds it to the list of declarations and occurrence index. */
    const declare = (newDef: SourceDefinition): void => {
        definitions.push(newDef);
        const scope = currentScope();

        if (!scope.definitionByName.has(newDef.name)) {
            scope.definitionByName.set(newDef.name, []);
        }

        const defWithSameName = scope.definitionByName.get(newDef.name)!;
        const lastDefWithSameName = defWithSameName[defWithSameName.length - 1];
        if (lastDefWithSameName !== undefined) {
            /// Because of shadowing, once our new declaration with the same name is declared in the same scope, 
            // the previous declaration with the same name is no longer visible from this point onward, 
            // so we update its scope end to be the end position of the new declaration.
            lastDefWithSameName.scopeEnd = newDef.range.end;
        }
        defWithSameName.push(newDef);

        occurrenceIndex.push({
            range: newDef.selectionRange,
            declaration: newDef,
            reference: undefined,
        });
    };

    /** Resolves a variable name to its corresponding declaration by searching the scope stack from innermost to outermost scope. */
    const resolve = (name: string): Definition | undefined => {
        const builtinDefinition = findBuiltinFunctionDefinition(name);
        if (builtinDefinition !== undefined) {
            return builtinDefinition;
        }

        for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
            const scope = scopeStack[index];
            const declarations = scope?.definitionByName.get(name);
            const declaration = declarations?.[declarations.length - 1];
            if (declaration !== undefined) {
                return declaration;
            }
        }
    };

    const attachDocumentSymbol = (symbols: DocumentSymbol[], symbol: DocumentSymbol | undefined): DocumentSymbol | undefined => {
        if (symbol !== undefined) {
            symbols.push(symbol);
        }
        return symbol;
    };

    const declareVariable = (kind: DefinitionKind, node: ParserRuleContext, varRef: VarRefContext): void => {
        const name = varRefNameOrNull(varRef);
        if (name === null) {
            return;
        }

        declare(createDefinition(name, kind, node, varRef, document));
    };

    const recordReference = (name: string, node: ParseTree, range: Range): void => {
        const declaration = resolve(name);
        const reference = {
            name,
            node,
            range,
            declaration,
        } satisfies Reference;

        /// We still push reference so we can show unresolved references diagnostic
        references.push(reference);

        if (declaration === undefined) {
            return;
        }

        occurrenceIndex.push({
            range: reference.range,
            declaration,
            reference,
        });

        if (isSourceDefinition(declaration)) {
            declaration.references.push(reference);
        }
    };

    const collectSymbolsBeforeChildren = (node: ParseTree, symbols: DocumentSymbol[]): SymbolTraversalState => {
        const state: SymbolTraversalState = { childSymbols: symbols };

        const collectChildSymbolsUnder = (symbol: DocumentSymbol | undefined): void => {
            if (symbol === undefined) {
                return;
            }

            state.declarationContainerSymbol = symbol;
            state.declarationChildSymbols = [];
            state.childSymbols = state.declarationChildSymbols;
        };

        if (node instanceof FunctionDeclContext) {
            const nameNode = node._fn_name ?? node.qname();
            const name = node._fn_name?.getText() ?? node.qname()?.getText();
            const functionSymbol = nameNode === null || name === undefined
                ? undefined
                : attachDocumentSymbol(symbols, createDocumentSymbol(
                    name,
                    SymbolKind.Function,
                    node,
                    nameNode,
                    document,
                ));
            if (functionSymbol !== undefined) {
                functionSymbol.children ??= [];
                state.childSymbols = functionSymbol.children;
            }
        }

        if (node instanceof ForVarContext) {
            const variableRefs = node.varRef();
            let boundVariableSymbol: DocumentSymbol | undefined;
            for (const varRef of variableRefs) {
                const name = varRefNameOrNull(varRef);
                const symbol = name === null ? undefined : attachDocumentSymbol(symbols, createDocumentSymbol(name, SymbolKind.Variable, node, varRef, document));
                if (varRef === variableRefs[0]) {
                    boundVariableSymbol = symbol;
                }
            }
            collectChildSymbolsUnder(boundVariableSymbol);
        }

        if (node instanceof VarDeclContext || node instanceof LetVarContext || node instanceof GroupByVarContext || node instanceof CountClauseContext) {
            const varRef = node.varRef();
            const name = varRefNameOrNull(varRef);
            const symbol = name === null ? undefined : attachDocumentSymbol(symbols, createDocumentSymbol(name, SymbolKind.Variable, node, varRef, document));
            if (!(node instanceof CountClauseContext)) {
                collectChildSymbolsUnder(symbol);
            }
        }

        if (node instanceof TypeDeclContext) {
            const nameNode = node._type_name ?? node.qname();
            const name = node._type_name?.getText() ?? node.qname()?.getText();
            if (nameNode !== null && name !== undefined) {
                attachDocumentSymbol(symbols, createDocumentSymbol(
                    name,
                    SymbolKind.Struct,
                    node,
                    nameNode,
                    document,
                ));
            }
        }

        if (node instanceof ContextItemDeclContext) {
            attachDocumentSymbol(symbols, createDocumentSymbol("context item", SymbolKind.Variable, node, node, document));
        }

        if (node instanceof NamespaceDeclContext) {
            attachDocumentSymbol(symbols, createDocumentSymbol(node.NCName().getText(), SymbolKind.Namespace, node, node.NCName(), document));
        }

        if (node instanceof ParamContext) {
            const qname = node.qname();
            const name = qname?.getText().trim();
            if (name !== undefined && name !== "") {
                attachDocumentSymbol(symbols, createDocumentSymbol(`$${name}`, SymbolKind.Variable, node, qname, document));
            }
        }

        return state;
    };

    const collectDefinitionsBeforeScope = (node: ParseTree): void => {
        if (node instanceof FunctionDeclContext) {
            const name = functionNameWithArityOrNull(node);
            if (name !== null) {
                declare(createDefinition(name, "function", node, node._fn_name ?? node.qname(), document));
            }
        }
    };

    const collectDefinitionsBeforeChildren = (node: ParseTree): void => {
        if (node instanceof ParamContext) {
            const qname = node.qname();
            const name = qname?.getText().trim();
            if (name !== undefined && name !== "") {
                const declaration = createDefinition(`$${name}`, "parameter", node, qname, document);
                const dollarRange = rangeFromNode(node.Kdollar(), document);
                declaration.selectionRange = {
                    start: dollarRange.start,
                    end: declaration.selectionRange.end,
                };
                declare(declaration);
            }
        }

        /**
         * Count clause introduces a new variable, for example:
         * for $x in (1, 2, 3)
         * count $i
         * return $x + $i
         * In this example, the count clause introduces a new variable $i that is bound to the position of each item in the iteration. 
         * This variable should be treated as a declaration and should be resolvable from references within the FLWOR expression. 
         */
        if (node instanceof CountClauseContext) {
            const varRef = node.varRef();
            declareVariable("count", node, varRef);
        }
    };

    const collectReferencesBeforeChildren = (node: ParseTree): void => {
        if (node instanceof VarRefContext && !isDeclarationVarRef(node)) {
            const name = varRefNameOrNull(node);
            if (name !== null) {
                recordReference(name, node, rangeFromNode(node, document));
            }
        }

        if (node instanceof FunctionCallContext || node instanceof NamedFunctionRefContext) {
            const nameNode = node._fn_name ?? node.qname();
            const name = functionNameWithArityOrNull(node);
            if (name !== null) {
                recordReference(name, node, rangeFromNode(nameNode, document));
            }
        }
    };

    const collectDefinitionsAfterChildren = (node: ParseTree): void => {
        // After visiting the children, if this node is a variable declaration, we add it to the current scope and to the list of declarations and occurrence index.
        // It's important that we do this after visiting the children, so that if there are references to this variable within its own initializer (e.g. let $x := $x + 1)
        if (node instanceof VarDeclContext) {
            declareVariable("declare-variable", node, node.varRef());
        } else if (node instanceof LetVarContext) {
            declareVariable("let", node, node.varRef());
        } else if (node instanceof GroupByVarContext) {
            declareVariable("group-by", node, node.varRef());
        } else if (node instanceof ForVarContext) {
            const variableRefs = node.varRef();
            const boundVariable = variableRefs[0];
            if (boundVariable !== undefined) {
                declareVariable("for", node, boundVariable);
            }
            const positionVariable = variableRefs[1];
            if (positionVariable !== undefined) {
                declareVariable("for-position", node, positionVariable);
            }
        }
    };

    const finishSymbolCollectionAfterChildren = (state: SymbolTraversalState): void => {
        if (state.declarationChildSymbols !== undefined && state.declarationChildSymbols.length > 0) {
            if (state.declarationContainerSymbol !== undefined) {
                state.declarationContainerSymbol.children = state.declarationChildSymbols;
            }
        }
    };

    const visit = (node: ParseTree, symbols: DocumentSymbol[]): void => {
        const symbolState = collectSymbolsBeforeChildren(node, symbols);

        collectDefinitionsBeforeScope(node);

        if (isNewScopeNode(node)) {
            pushScope();
        }

        collectDefinitionsBeforeChildren(node);
        collectReferencesBeforeChildren(node);

        for (let index = 0; index < node.getChildCount(); index += 1) {
            const child = node.getChild(index);
            if (child !== null) {
                visit(child, symbolState.childSymbols);
            }
        }

        collectDefinitionsAfterChildren(node);
        finishSymbolCollectionAfterChildren(symbolState);

        /** 
         * After visiting the children of the current node, if this node introduced a new scope, 
         * we pop that scope to ensure variables declared in that scope are not visible outside of it. 
         * */
        if (isNewScopeNode(node)) {
            popScope(rangeFromNode(node, document).end);
        }
    };

    // Start the traversal from the root of the parse tree
    visit(parseResult.tree, documentSymbols);

    // Sort occurrences by position to allow binary search lookup of variable occurrences.
    occurrenceIndex.sort((left, right) => {
        const startComparison = comparePositions(left.range.start, right.range.start);
        if (startComparison !== 0) {
            return startComparison;
        }

        return comparePositions(left.range.end, right.range.end);
    });

    for (const declaration of scopeStack[0]?.definitionByName.values() ?? []) {
        const lastDeclaration = declaration[declaration.length - 1];
        if (lastDeclaration !== undefined) {
            lastDeclaration.scopeEnd = document.positionAt(document.getText().length);
        }
    }

    definitions.sort((left, right) => comparePositions(left.range.start, right.range.start));

    return {
        definitions,
        references,
        occurrenceIndex,
        documentSymbols,
    };
}

export function isSourceDefinition(declaration: BaseDefinition | undefined): declaration is SourceDefinition {
    return declaration !== undefined && declaration.isBuiltin === false;
}

/**
 * Creates a DocumentSymbol for the given symbol information, or returns undefined if the symbol name is invalid.
 */
function createDocumentSymbol(
    name: string,
    kind: SymbolKind,
    declarationNode: ParserRuleContext,
    selectionNode: ParserRuleContext | ParseTree,
    document: TextDocument
): DocumentSymbol | undefined {
    const sanitizedName = sanitizeSymbolName(name);
    if (sanitizedName === null) {
        return undefined;
    }

    const range = rangeFromNode(declarationNode, document);

    return {
        name: sanitizedName,
        kind,
        range,
        selectionRange: rangeFromNode(selectionNode, document) ?? range,
    };
}

/**
 * Sanitizes the given symbol name by trimming whitespace and validating that it is not empty or just a "$" character.
 */
function sanitizeSymbolName(name: string): string | null {
    const trimmed = name.trim();
    const isValid = trimmed !== "" && trimmed !== "$";
    return isValid ? trimmed : null;
}

/**
 * Returns all variable declarations visible at the given position. Declarations with the same
 * name are de-duplicated so only the nearest in-scope declaration is returned.
 *
 * Strategy:
 * 1) `declarations` is pre-sorted by declaration start position during analysis.
 * 2) Binary-search the insertion point for `position`.
 * 3) Scan backward to prefer nearest declarations first, keeping one declaration per name.
 */
export function getVisibleDeclarationsAtPosition(document: TextDocument, position: Position): BaseDefinition[] {
    const analysis = getAnalysis(document);
    const visibleByName = new Map<string, BaseDefinition>();
    const source = document.getText();
    const positionOffset = document.offsetAt(position);

    // Index = first declaration with declaration start > position, so we start scanning backward from index - 1 to find declarations that are declared before the position.
    // Between [0, index - 1], we need to check if scopeEnd is before the position to ensure the declaration is still valid
    // TODO: Find a better way to efficiently find the visible declarations at a given position without having to scan backward through all declarations before that position.
    let index = upperBound(analysis.definitions, position, (left, right) => comparePositions(left.range.start, right)) - 1;

    while (index >= 0) {
        const declaration = analysis.definitions[index];

        // A declaration is visible iff the cursor is before the scope boundary. Because we scan
        // backward, the first declaration we keep for a name is the nearest (shadowing-aware).
        if (
            declaration !== undefined
            && isDeclarationVisibleAtOffset(document, source, declaration, positionOffset)
            && comparePositions(position, declaration.scopeEnd) <= 0
            && !visibleByName.has(declaration.name)
        ) {
            visibleByName.set(declaration.name, declaration);
        }

        index -= 1;
    }

    return [...visibleByName.values()];
}

function isDeclarationVisibleAtOffset(
    document: TextDocument,
    source: string,
    declaration: SourceDefinition,
    queryOffset: number,
): boolean {
    if (declaration.kind === "function") {
        return document.offsetAt(declaration.selectionRange.end) < queryOffset;
    }

    const declarationEndOffset = document.offsetAt(declaration.range.end);

    return declarationEndOffset < queryOffset
        && source.slice(declarationEndOffset, queryOffset).trim() !== "";
}

/**
 * Creates a VariableDeclaration object from the given information, including the variable name, kind, corresponding parse tree nodes, and the range of the declaration in the source document.
 * @param name The name of the variable being declared (e.g. "$x")
 * @param kind The kind of variable declaration (e.g. "parameter", "let", "for", etc.)
 * @param declarationNode The parse tree node corresponding to the entire variable declaration (e.g. the VarDeclContext, LetVarContext, etc.)
 * @param selectionNode The parse tree node corresponding to the variable name within the declaration, which should be used for features like "go to definition" to navigate to the variable name rather than the entire declaration
 * @param document The TextDocument containing the source code, used to calculate the range of the declaration in terms of line and character positions
 * @returns A VariableDeclaration object representing this variable declaration, including its name, kind, corresponding parse tree nodes, and range in the source document
 */
function createDefinition(
    name: string,
    kind: DefinitionKind,
    declarationNode: ParserRuleContext,
    selectionNode: ParseTree,
    document: TextDocument,
): SourceDefinition {
    return {
        name,
        kind,
        node: declarationNode,
        range: rangeFromNode(declarationNode, document),
        selectionRange: rangeFromNode(selectionNode, document),
        scopeEnd: { line: 0, character: 0 },
        references: [],
        isBuiltin: false,
    };
}

/**
 * Finds the variable occurrence (declaration or reference) at the given position in the document, and returns the corresponding declaration and reference information.
 * This is used for features like "go to definition" and "find references" to determine which variable declaration or reference the user is trying to navigate to based on the cursor position in the editor.
 * @param analysis The variable scope analysis results for the document, which includes all variable declarations and references along with their positions in the source code
 * @param position The position in the document for which to find the corresponding variable occurrence
 * @returns The variable occurrence at the given position, including the corresponding declaration and reference information, or undefined if there is no variable occurrence at that position
 */
export function findVariableOccurrenceAtPosition(
    analysis: JsoniqAnalysis,
    position: Position,
): OccurrenceIndexEntry | undefined {
    const occurrenceIndex = upperBound(analysis.occurrenceIndex, position,
        (occurrence, position) => comparePositions(occurrence.range.start, position)
    ) - 1;
    const occurrence = analysis.occurrenceIndex[occurrenceIndex];

    if (occurrence !== undefined && comparePositions(position, occurrence.range.end) < 0) {
        return occurrence;
    }

    return undefined;
}

/**
 * Finds the variable occurrence (declaration or reference) **near** the given position in the document, allowing for some tolerance when the cursor is not exactly on the variable name but is still close enough to be considered as trying to navigate to that variable.
 *
 * Tolerance is intentionally limited to adjacent columns on the same line. This avoids resolving a variable on the next or previous line when the cursor is sitting on a line boundary.
 *
 * @param analysis The variable scope analysis results for the document
 * @param position The position in the document for which to find the corresponding variable occurrence
 * @returns The variable occurrence near the given position, including the corresponding declaration and reference information, or undefined if there is no variable occurrence near that position
 */
export function findVariableOccurrenceNearPosition(
    analysis: JsoniqAnalysis,
    position: Position,
): OccurrenceIndexEntry | undefined {
    const exact = findVariableOccurrenceAtPosition(analysis, position);
    if (exact !== undefined) {
        return exact;
    }

    // If there is no occurrence at the exact position, check adjacent columns on
    // the same line. This keeps the tolerance useful without crossing newlines.
    if (position.character > 0) {
        const previous = findVariableOccurrenceAtPosition(analysis, {
            line: position.line,
            character: position.character - 1,
        });
        if (previous !== undefined) {
            return previous;
        }
    }

    return findVariableOccurrenceAtPosition(analysis, {
        line: position.line,
        character: position.character + 1,
    });
}

/**
 * Determines whether a given VarRefContext node is part of a variable declaration (e.g. the variable being declared in a VarDeclContext, LetVarContext, etc.) rather than a reference to an already declared variable.
 * This is necessary because in the parse tree, the variable being declared is represented as a VarRefContext node, just like references to that variable elsewhere in the code. 
 * To avoid treating the declaration as a reference to itself, we need to check the parent node to see if this VarRefContext is actually part of a declaration.
 * @param node The VarRefContext node to check
 * @returns true if this node is part of a variable declaration, false if it is a reference to an already declared variable
 */
function isDeclarationVarRef(node: VarRefContext): boolean {
    const parent = node.parent;

    // In VarDeclContext, LetVarContext, GroupByVarContext, and CountClauseContext, the variable being declared is represented as a VarRefContext that is a direct child of the declaration context. 
    // For example, in the following code snippet:
    //     let $x := 10
    // The variable declaration for $x is represented in the parse tree as a LetVarContext node, which has a child VarRefContext node representing $x. 
    // Therefore, if the parent of the given VarRefContext node is one of these declaration contexts, and its varRef() method returns this node, we can conclude that this VarRefContext is part of a variable declaration.
    if (parent instanceof VarDeclContext || parent instanceof LetVarContext || parent instanceof GroupByVarContext || parent instanceof CountClauseContext) {
        return parent.varRef() === node;
    }

    // In ForVarContext, there can be either one or two variables being declared (the iteration variable and an optional position variable), both represented as VarRefContext nodes that are direct children of the ForVarContext.
    // For example, in the following code snippet:
    //     for $x at $i in (1, 2, 3)
    // The variable declaration for $x is represented as a VarRefContext that is a child of the ForVarContext, and the variable declaration for $i is represented as another VarRefContext that is also a child of the same ForVarContext.
    // Therefore, if the parent of the given VarRefContext node is a ForVarContext, and its varRef() method returns an array that includes this node, we can conclude that this VarRefContext is part of a variable declaration.
    if (parent instanceof ForVarContext) {
        return parent.varRef().some((entry) => entry === node);
    }

    return false;
}

/**
 * Cached analysis results for documents, keyed by document URI and version, 
 * Used to avoid redundant analysis when the same document is queried multiple times without changes
 */
interface CachedAnalysis {
    version: number;
    analysis: JsoniqAnalysis;
}

/** In memory cache for analysis results */
const analysisCache = new Map<DocumentUri, CachedAnalysis>();

/**
 * Retrieves the variable scope analysis for the given document, using a cache to avoid redundant analysis when possible.
 * If the analysis for the document is not in the cache or is outdated (i.e. the document version has changed), it performs a new analysis and updates the cache.
 * This is used to optimize performance when finding definition locations, as analyzing variable scopes can be an expensive operation.
 * 
 * @param document The TextDocument representing the JSONiq source code to analyze
 * @returns The JsoniqVariableScopeAnalysis object containing the results of variable scope analysis for the given document
 */
export function getAnalysis(document: TextDocument): JsoniqAnalysis {
    const cached = analysisCache.get(document.uri);

    if (cached !== undefined && cached.version === document.version) {
        return cached.analysis;
    }

    const analysis = analyzeVariableScopes(document);

    analysisCache.set(document.uri, {
        version: document.version,
        analysis,
    });

    return analysis;
}
