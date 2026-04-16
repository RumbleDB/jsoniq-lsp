import { ParserRuleContext, type ParseTree } from "antlr4ng";
import { DocumentUri, type Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
    CountClauseContext,
    ForVarContext,
    GroupByVarContext,
    LetVarContext,
    ParamContext,
    VarDeclContext,
    VarRefContext,
} from "../grammar/jsoniqParser.js";
import { parseJsoniqDocument } from "./parser.js";
import { rangeFromNode, offsetsFromRange } from "./utils/range.js";
import { isNewScopeNode } from "./utils/scope.js";

type DefinitionKind =
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
export interface Definition {
    name: string;
    kind: DefinitionKind;
    node: ParseTree;

    /// Range = the entire range of the declaration
    /// For example, for a variable declaration like "let $x := 10", the range would cover the entire "let $x := 10" expression.
    range: Range;

    /// Selection range = the range of the variable name within the declaration, which should be used for features like "go to definition" to navigate to the variable name rather than the entire declaration.
    /// For example, for a variable declaration like "let $x := 10", the selection range would cover just the "$x" part of the expression.
    selectionRange: Range;

    /// Offset where this definition is not visible anymore
    scopeEndOffset: number;
}

/**
 * Represents a reference to a variable in the source code, along with a reference to the corresponding declaration (if it can be resolved).
 */
export interface Reference {
    name: string;
    node: VarRefContext;
    range: Range;
    declaration: Definition | undefined;
}

/**
 * Interface used for both variable declarations and references to enable efficient lookup of the declaration corresponding to a given reference offset.
 */
export interface OccurrenceIndexEntry {
    startOffset: number;
    endOffset: number;
    declaration: Definition;

    /** The reference corresponding to this occurrence, if it is a reference. Undefined for declaration occurrences. */
    reference: Reference | undefined;
}

/**
 * Results of variable scope analysis for a JSONiq document
*/
export interface JsoniqAnalysis {
    /** All variable declarations found in the document, sorted by declaration offset in source order. */
    definitions: Definition[];

    /** Map from variable declarations to the list of references that resolve to that declaration. */
    referencesByDeclaration: Map<Definition, Reference[]>;

    /** All variable references found in the document, in the order they were encountered during traversal. */
    references: Reference[];

    /** A sorted index of all variable occurrences (declarations and references) in the document, sorted by their position in the source code. */
    occurrenceIndex: OccurrenceIndexEntry[];
}

interface ScopeFrame {
    /** 
     * Map from variable names to their corresponding declarations within this scope frame. 
     * Because variable shadows can occur, we save all of them in a list, but only the nearest declaration (the last one in the list) is the one that should be resolved from references in this scope.
     * */
    definitionByName: Map<string, Array<Definition>>;
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
    const definitions: Definition[] = [];
    const references: Reference[] = [];
    const referencesByDeclaration = new Map<Definition, Reference[]>();
    const occurrenceIndex: OccurrenceIndexEntry[] = [];
    const scopeStack: ScopeFrame[] = [{ definitionByName: new Map() }];

    const pushScope = (): void => {
        scopeStack.push({ definitionByName: new Map() });
    };

    const popScope = (scopeEndOffset: number): void => {
        const scope = scopeStack.pop();
        if (scope !== undefined) {
            for (const definitions of scope.definitionByName.values()) {
                /// Only the last one ends at the scope boundary, because of variable shadowing.
                /// Previous declarations with the same name has smaller scopeEndOffset, updated when new variable with the same name is declared in the same scope.
                const lastDefinition = definitions[definitions.length - 1];
                if (lastDefinition !== undefined) {
                    lastDefinition.scopeEndOffset = scopeEndOffset;
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

    /** Declares a variable in the current scope and adds it to the list of declarations and occurrence index. */
    const declare = (newDef: Definition): void => {
        definitions.push(newDef);
        referencesByDeclaration.set(newDef, []);
        const scope = currentScope();

        if (!scope.definitionByName.has(newDef.name)) {
            scope.definitionByName.set(newDef.name, []);
        }

        const declarationOffsets = offsetsFromRange(newDef.range, document);
        const selectionOffsets = offsetsFromRange(newDef.selectionRange, document);

        const defWithSameName = scope.definitionByName.get(newDef.name)!;
        const lastDefWithSameName = defWithSameName[defWithSameName.length - 1];
        if (lastDefWithSameName !== undefined) {
            /// Because of shadowing, once our new declaration with the same name is declared in the same scope, 
            // the previous declaration with the same name is no longer visible from this point onward, 
            // so we update its scope end offset to be the position of the new declaration.
            lastDefWithSameName.scopeEndOffset = declarationOffsets.endOffset;
        }
        defWithSameName.push(newDef);

        occurrenceIndex.push({
            startOffset: selectionOffsets.startOffset,
            endOffset: selectionOffsets.endOffset,
            declaration: newDef,
            reference: undefined,
        });
    };

    /** Resolves a variable name to its corresponding declaration by searching the scope stack from innermost to outermost scope. */
    const resolve = (name: string): Definition | undefined => {
        for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
            const scope = scopeStack[index];
            const declarations = scope?.definitionByName.get(name);
            const declaration = declarations?.[declarations.length - 1];
            if (declaration !== undefined) {
                return declaration;
            }
        }
        return undefined;
    };

    const visit = (node: ParseTree): void => {
        if (isNewScopeNode(node)) {
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
            } satisfies Reference;

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
        if (isNewScopeNode(node)) {
            const scopeOffsets = offsetsFromRange(rangeFromNode(node, document), document);
            popScope(scopeOffsets.endOffset);
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

    const documentEndOffset = document.getText().length;
    for (const declaration of scopeStack[0]?.definitionByName.values() ?? []) {
        const lastDeclaration = declaration[declaration.length - 1];
        if (lastDeclaration !== undefined) {
            lastDeclaration.scopeEndOffset = documentEndOffset;
        }
    }

    definitions.sort((left, right) => {
        const leftOffsets = offsetsFromRange(left.range, document);
        const rightOffsets = offsetsFromRange(right.range, document);

        return leftOffsets.startOffset - rightOffsets.startOffset;
    });

    return {
        definitions,
        references,
        referencesByDeclaration,
        occurrenceIndex,
    };
}

/**
 * Returns all variable declarations visible at the given offset. Declarations with the same
 * name are de-duplicated so only the nearest in-scope declaration is returned.
 *
 * Strategy:
 * 1) `declarations` is pre-sorted by `declarationOffset` during analysis.
 * 2) Binary-search the insertion point for `offset`.
 * 3) Scan backward to prefer nearest declarations first, keeping one declaration per name.
 */
export function getVisibleDeclarationsAtOffset(document: TextDocument, offset: number): Definition[] {
    const analysis = getAnalysis(document);
    const visibleByName = new Map<string, Definition>();

    // Index = first declaration with declarationOffset > offset, so we start scanning backward from index - 1 to find declarations that are declared before the offset.
    // Between [0, index - 1], we need to check if scopeEndOffset is smaller than the offset to ensure the declaration is still valid
    // TODO: Find a better way to efficiently find the visible declarations at a given offset without having to scan backward through all declarations before that offset. 
    let index = upperBoundDeclarationOffset(analysis.definitions, offset, document) - 1;

    while (index >= 0) {
        const declaration = analysis.definitions[index];
        const declarationVisibleFromOffset = declaration !== undefined
            ? offsetsFromRange(declaration.range, document).endOffset
            : 0;

        // A declaration is visible iff the cursor is before the scope boundary. Because we scan
        // backward, the first declaration we keep for a name is the nearest (shadowing-aware).
        if (
            declaration !== undefined
            && declarationVisibleFromOffset < offset
            && offset <= declaration.scopeEndOffset
            && !visibleByName.has(declaration.name)
        ) {
            visibleByName.set(declaration.name, declaration);
        }

        index -= 1;
    }

    return [...visibleByName.values()];
}

/**
 * Find the index of the first declaration whose declaration offset is greater than the given offset, using binary search.
 * 
 * @returns The index of the first declaration whose declaration offset is **greater** than the given offset, or declarations.length if there is no such declaration.
*/
function upperBoundDeclarationOffset(definitions: Definition[], offset: number, document: TextDocument): number {
    let low = 0;
    let high = definitions.length;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);

        // Because mid is between 0 and definitions.length - 1, it should always be defined
        const definition = definitions[mid]!;
        const offsets = offsetsFromRange(definition.range, document);

        if (offsets.startOffset <= offset) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
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
    kind: DefinitionKind,
    declarationNode: ParserRuleContext,
    selectionNode: ParseTree,
    document: TextDocument,
): Definition {
    return {
        name,
        kind,
        node: declarationNode,
        range: rangeFromNode(declarationNode, document),
        selectionRange: rangeFromNode(selectionNode, document),
        scopeEndOffset: document.getText().length,
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
    analysis: JsoniqAnalysis,
    offset: number,
): OccurrenceIndexEntry | undefined {
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
    analysis: JsoniqAnalysis,
    offset: number,
): OccurrenceIndexEntry | undefined {
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
