import { ParserRuleContext, type ParseTree } from "antlr4ng";
import { DocumentUri, type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    CountClauseContext,
    FlowrExprContext,
    FlowrStatementContext,
    ForVarContext,
    FunctionDeclContext,
    GroupByVarContext,
    LetVarContext,
    ParamContext,
    VarDeclContext,
    VarRefContext,
} from "../grammar/jsoniqParser.js";
import { parseJsoniqDocument } from "./parser.js";
import { rangeFromNode } from "./utils/range.js";

type VariableDeclarationKind =
    | "declare-variable"
    | "let"
    | "for"
    | "for-position"
    | "group-by"
    | "count"
    | "parameter";

/**
 * Represents a variable declaration in the source code, including its name, kind (e.g. function parameter, FLWOR clause variable, etc.), 
 * the corresponding parse tree node, and the range of the declaration in the source document.
 */
export interface VariableDeclaration {
    name: string;
    kind: VariableDeclarationKind;
    node: ParseTree;
    range: Range;
    selectionRange: Range;
}

/**
 * Represents a reference to a variable in the source code, along with a reference to the corresponding declaration (if it can be resolved).
 */
export interface VariableReference {
    name: string;
    node: VarRefContext;
    range: Range;
    declaration: VariableDeclaration | undefined;
}

/**
 * Interface used for both variable declarations and references to enable efficient lookup of the declaration corresponding to a given reference offset.
 */
export interface VariableOccurrenceIndexEntry {
    startOffset: number;
    endOffset: number;
    declaration: VariableDeclaration;

    /** The reference corresponding to this occurrence, if it is a reference. Undefined for declaration occurrences. */
    reference: VariableReference | undefined;
}

/**
 * Results of variable scope analysis for a JSONiq document
*/
export interface JsoniqVariableScopeAnalysis {
    /** All variable declarations found in the document, in the order they were declared. */
    declarations: VariableDeclaration[];

    /** Map from variable declarations to the list of references that resolve to that declaration. */
    referencesByDeclaration: Map<VariableDeclaration, VariableReference[]>;

    /** All variable references found in the document, in the order they were encountered during traversal. */
    references: VariableReference[];

    /** A sorted index of all variable occurrences (declarations and references) in the document, sorted by their position in the source code. */
    occurrenceIndex: VariableOccurrenceIndexEntry[];
}

interface ScopeFrame {
    /** Map from variable names to their corresponding declarations within this scope frame. */
    declarationsByName: Map<string, VariableDeclaration>;
}

/**
 * Analyzes the variable scopes in a JSONiq document, returning all variable declarations and references along with their relationships.
 * This is used for features like "go to definition" and "find references" in the language server.
 * 
 * @param document The TextDocument representing the JSONiq source code to analyze
 * @returns An object containing the results of variable scope analysis, including all variable declarations and references along with their relationships
 */
export function analyzeVariableScopes(document: TextDocument): JsoniqVariableScopeAnalysis {
    const parseResult = parseJsoniqDocument(document);
    const declarations: VariableDeclaration[] = [];
    const references: VariableReference[] = [];
    const referencesByDeclaration = new Map<VariableDeclaration, VariableReference[]>();
    const occurrenceIndex: VariableOccurrenceIndexEntry[] = [];
    const scopeStack: ScopeFrame[] = [{ declarationsByName: new Map() }];

    const pushScope = (): void => {
        scopeStack.push({ declarationsByName: new Map() });
    };

    const popScope = (): void => {
        if (scopeStack.length > 1) {
            scopeStack.pop();
        }
    };

    const currentScope = (): ScopeFrame => {
        const scope = scopeStack[scopeStack.length - 1];
        if (scope === undefined) {
            throw new Error("Variable scope stack is unexpectedly empty.");
        }
        return scope;
    };

    /** Declares a variable in the current scope and adds it to the list of declarations and occurrence index. */
    const declare = (declaration: VariableDeclaration): void => {
        declarations.push(declaration);
        currentScope().declarationsByName.set(declaration.name, declaration);
        referencesByDeclaration.set(declaration, []);

        const declarationOffsets = offsetsFromRange(declaration.selectionRange, document);
        occurrenceIndex.push({
            startOffset: declarationOffsets.startOffset,
            endOffset: declarationOffsets.endOffset,
            declaration,
            reference: undefined,
        });
    };

    /** Resolves a variable name to its corresponding declaration by searching the scope stack from innermost to outermost scope. */
    const resolve = (name: string): VariableDeclaration | undefined => {
        for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
            const scope = scopeStack[index];
            if (scope === undefined) {
                // This should never happen, but just to make TypeScript happy
                continue;
            }
            const declaration = scope.declarationsByName.get(name);
            if (declaration !== undefined) {
                return declaration;
            }
        }
        return undefined;
    };

    const visit = (node: ParseTree): void => {
        /**
         * A new variable scope is introduced by:
         * - Function declarations (introducing a new function scope)
         * - FLWOR expressions and statements (introducing a new FLWOR scope)
         * Each of these scopes can contain variable declarations that should not be visible outside of that scope, 
         *  so we push a new scope frame onto the stack when we enter these nodes, and pop it when we exit.
         */
        const newScopeNodeTypes = [FunctionDeclContext, FlowrExprContext, FlowrStatementContext];
        if (newScopeNodeTypes.some((type) => node instanceof type)) {
            pushScope();
        }

        if (node instanceof ParamContext) {
            declare(createVariableDeclaration(`$${node.qname().getText()}`, "parameter", node, node.qname(), document));
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
            declare(createVariableDeclaration(varRefName(varRef), "count", node, varRef, document));
        }

        // It's a variable reference
        if (node instanceof VarRefContext && !isDeclarationVarRef(node)) {
            const name = varRefName(node);
            const declaration = resolve(name);
            const reference = {
                name: varRefName(node),
                node,
                range: rangeFromNode(node, document),
                declaration,
            } satisfies VariableReference;

            references.push(reference);

            // If the declaration could be resolved, add this reference to the list of references for that declaration and to the occurrence index.
            if (declaration !== undefined) {
                const declarationReferences = referencesByDeclaration.get(declaration);
                if (declarationReferences !== undefined) {
                    declarationReferences.push(reference);
                }

                const referenceOffsets = offsetsFromRange(reference.range, document);
                occurrenceIndex.push({
                    startOffset: referenceOffsets.startOffset,
                    endOffset: referenceOffsets.endOffset,
                    declaration,
                    reference,
                });
            }
        }

        // Recursively visit all child nodes
        for (let index = 0; index < node.getChildCount(); index += 1) {
            const child = node.getChild(index);
            if (child !== null) {
                visit(child);
            }
        }

        // After visiting the children, if this node is a variable declaration, we add it to the current scope and to the list of declarations and occurrence index.
        // It's important that we do this after visiting the children, so that if there are references to this variable within its own initializer (e.g. let $x := $x + 1)
        if (node instanceof VarDeclContext) {
            const varRef = node.varRef();
            declare(createVariableDeclaration(varRefName(varRef), "declare-variable", node, varRef, document));
        }

        if (node instanceof LetVarContext) {
            const varRef = node.varRef();
            declare(createVariableDeclaration(varRefName(varRef), "let", node, varRef, document));
        }

        if (node instanceof ForVarContext) {
            const variableRefs = node.varRef();
            const boundVariable = variableRefs[0];
            if (boundVariable !== undefined) {
                declare(createVariableDeclaration(varRefName(boundVariable), "for", node, boundVariable, document));
            }
            const positionVariable = variableRefs[1];
            if (positionVariable !== undefined) {
                declare(createVariableDeclaration(varRefName(positionVariable), "for-position", node, positionVariable, document));
            }
        }

        if (node instanceof GroupByVarContext) {
            const varRef = node.varRef();
            declare(createVariableDeclaration(varRefName(varRef), "group-by", node, varRef, document));
        }

        /** 
         * After visiting the children of the current node, if this node introduced a new scope, 
         * we pop that scope to ensure variables declared in that scope are not visible outside of it. 
         * */
        if (newScopeNodeTypes.some((type) => node instanceof type)) {
            popScope();
        }
    };

    // Start the traversal from the root of the parse tree
    visit(parseResult.tree);

    // Sort occurrences by position to allow binary search lookup of variable occurrences by offset
    occurrenceIndex.sort((left, right) => {
        if (left.startOffset === right.startOffset) {
            return left.endOffset - right.endOffset;
        }
        return left.startOffset - right.startOffset;
    });

    return {
        declarations,
        references,
        referencesByDeclaration,
        occurrenceIndex,
    };
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
function createVariableDeclaration(
    name: string,
    kind: VariableDeclarationKind,
    declarationNode: ParserRuleContext,
    selectionNode: ParseTree,
    document: TextDocument,
): VariableDeclaration {
    return {
        name,
        kind,
        node: declarationNode,
        range: rangeFromNode(declarationNode, document),
        selectionRange: rangeFromNode(selectionNode, document),
    };
}

/**
 * Finds the variable occurrence (declaration or reference) at the given offset in the document, and returns the corresponding declaration and reference information.
 * This is used for features like "go to definition" and "find references" to determine which variable declaration or reference the user is trying to navigate to based on the cursor position in the editor.
 * @param analysis The variable scope analysis results for the document, which includes all variable declarations and references along with their positions in the source code
 * @param offset The offset in the document for which to find the corresponding variable occurrence (e.g. the position of the cursor in the editor)
 * @returns The variable occurrence at the given offset, including the corresponding declaration and reference information, or undefined if there is no variable occurrence at that offset
 */
export function findVariableOccurrenceAtOffset(
    analysis: JsoniqVariableScopeAnalysis,
    offset: number,
): VariableOccurrenceIndexEntry | undefined {
    const { occurrenceIndex } = analysis;
    let low = 0;
    let high = occurrenceIndex.length - 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const occurrence = occurrenceIndex[mid];

        if (occurrence === undefined) {
            break;
        }

        if (offset < occurrence.startOffset) {
            high = mid - 1;
            continue;
        }

        if (offset >= occurrence.endOffset) {
            low = mid + 1;
            continue;
        }

        return occurrence;
    }

    return undefined;
}

/**
 * Finds the variable occurrence (declaration or reference) **near** the given offset in the document, allowing for some tolerance when the cursor is not exactly on the variable name but is still close enough to be considered as trying to navigate to that variable.
 * @param analysis The variable scope analysis results for the document
 * @param offset The offset in the document for which to find the corresponding variable occurrence
 * @returns The variable occurrence near the given offset, including the corresponding declaration and reference information, or undefined if there is no variable occurrence near that offset
 */
export function findVariableOccurrenceNearOffset(
    analysis: JsoniqVariableScopeAnalysis,
    offset: number,
): VariableOccurrenceIndexEntry | undefined {
    const exact = findVariableOccurrenceAtOffset(analysis, offset);
    if (exact !== undefined) {
        return exact;
    }

    // If there is no occurrence at the exact offset, we check the previous and next offsets to see if there is an occurrence there. This allows for some tolerance when the cursor is not exactly on the variable name, but is still close enough to be considered as trying to navigate to that variable.
    if (offset > 0) {
        const previous = findVariableOccurrenceAtOffset(analysis, offset - 1);
        if (previous !== undefined) {
            return previous;
        }
    }

    return findVariableOccurrenceAtOffset(analysis, offset + 1);
}

/**
 * Calculates the start and end offsets of a given range in the document, which represent the position of a variable declaration or reference in terms of character offsets from the beginning of the document.
 * This is used to build the occurrence index for variable declarations and references, which allows for efficient lookup of variable occurrences by offset.
 * @param range The range in terms of line and character positions for which to calculate the corresponding offsets
 * @param document The TextDocument containing the source code, used to convert line and character positions to offsets
 * @returns An object containing the start and end offsets corresponding to the given range in the document
 */
function offsetsFromRange(range: Range, document: TextDocument): {
    startOffset: number;
    endOffset: number;
} {
    const startOffset = document.offsetAt(range.start);
    const endOffset = document.offsetAt(range.end);

    return {
        startOffset,
        endOffset: Math.max(endOffset, startOffset),
    };
}


/**
 * Extracts the variable name from a VarRefContext node, including the leading "$" character.
 * @param node The VarRefContext node representing the variable reference in the parse tree
 * @returns The variable name as a string, including the leading "$" (e.g. "$x")
 */
function varRefName(node: VarRefContext): string {
    return `$${node.qname().getText()}`;
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
    analysis: JsoniqVariableScopeAnalysis;
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
export function getAnalysis(document: TextDocument): JsoniqVariableScopeAnalysis {
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

