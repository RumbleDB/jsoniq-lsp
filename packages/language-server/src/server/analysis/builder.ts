import { ParserRuleContext, type ParseTree } from "antlr4ng";
import {
    DocumentSymbol,
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
} from "../../grammar/jsoniqParser.js";
import { parseJsoniqDocument } from "../parser.js";
import { comparePositions } from "../utils/position.js";
import { rangeFromNode } from "../utils/range.js";
import { isNewScopeNode } from "../utils/scope.js";
import { functionNameWithArityOrNull, varRefNameOrNull } from "../utils/name.js";
import { findBuiltinFunctionDefinition } from "../wrapper/builtin-functions.js";
import {
    type Definition,
    type JsoniqAnalysis,
    type OccurrenceIndexEntry,
    type Reference,
    type ResolvedReference,
    type SourceDefinition,
    type SourceDefinitionKind,
    type SourceFunctionDefinition,
    type SourceParameterDefinition,
    type SourceVariableDefinition,
    type VariableKind,
    isSourceDefinition,
} from "./model.js";

interface ScopeFrame {
    definitionByName: Map<string, Array<SourceDefinition>>;
}

interface SymbolTraversalState {
    childSymbols: DocumentSymbol[];
    declarationContainerSymbol?: DocumentSymbol;
    declarationChildSymbols?: DocumentSymbol[];
}

export function buildAnalysis(document: TextDocument): JsoniqAnalysis {
    const parseResult = parseJsoniqDocument(document);
    const definitions: SourceDefinition[] = [];
    const references: ResolvedReference[] = [];
    const unresolvedReferences: Reference[] = [];
    const occurrenceIndex: OccurrenceIndexEntry[] = [];
    const documentSymbols: DocumentSymbol[] = [];
    const scopeStack: ScopeFrame[] = [{ definitionByName: new Map() }];
    const functionStack: SourceFunctionDefinition[] = [];

    const pushScope = (): void => {
        scopeStack.push({ definitionByName: new Map() });
    };

    const popScope = (scopeEnd: Position): void => {
        const scope = scopeStack.pop();
        if (scope !== undefined) {
            for (const scopedDefinitions of scope.definitionByName.values()) {
                const lastDefinition = scopedDefinitions[scopedDefinitions.length - 1];
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

    const declare = (newDef: SourceDefinition): void => {
        definitions.push(newDef);
        const scope = currentScope();

        if (!scope.definitionByName.has(newDef.name)) {
            scope.definitionByName.set(newDef.name, []);
        }

        const defsWithSameName = scope.definitionByName.get(newDef.name)!;
        const lastDefWithSameName = defsWithSameName[defsWithSameName.length - 1];
        if (lastDefWithSameName !== undefined) {
            lastDefWithSameName.scopeEnd = newDef.range.end;
        }
        defsWithSameName.push(newDef);

        occurrenceIndex.push({
            range: newDef.selectionRange,
            declaration: newDef,
            reference: undefined,
        });
    };

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

    const declareVariable = (kind: VariableKind, node: ParserRuleContext, varRef: VarRefContext): void => {
        const name = varRefNameOrNull(varRef);
        if (name === null) {
            return;
        }

        declare(createDefinition(name, kind, node, varRef, document));
    };

    const recordReference = (name: string, node: ParseTree, range: Range): void => {
        const declaration = resolve(name);
        if (declaration === undefined) {
            unresolvedReferences.push({
                name,
                node,
                range,
            });
            return;
        }

        const reference = {
            name,
            node,
            range,
            declaration,
        } satisfies ResolvedReference;

        references.push(reference);

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
                const declaration = createDefinition(name, "function", node, node._fn_name ?? node.qname(), document);
                declare(declaration);
                functionStack.push(declaration);
            }
        }
    };

    const collectDefinitionsBeforeChildren = (node: ParseTree): void => {
        if (node instanceof ParamContext) {
            const qname = node.qname();
            const name = qname?.getText().trim();
            if (name !== undefined && name !== "") {
                const containingFunction = functionStack[functionStack.length - 1];
                if (containingFunction === undefined) {
                    return;
                }

                const declaration = createDefinition(`$${name}`, "parameter", node, qname, document, containingFunction);
                const dollarRange = rangeFromNode(node.Kdollar(), document);
                declaration.selectionRange = {
                    start: dollarRange.start,
                    end: declaration.selectionRange.end,
                };
                declare(declaration);
                containingFunction.parameters.push(declaration);
            }
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
        if (node instanceof VarDeclContext) {
            declareVariable("declare-variable", node, node.varRef());
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
        } else if (node instanceof LetVarContext) {
            declareVariable("let", node, node.varRef());
        } else if (node instanceof GroupByVarContext) {
            declareVariable("group-by", node, node.varRef());
        } else if (node instanceof CountClauseContext) {
            declareVariable("count", node, node.varRef());
        }

        if (node instanceof FunctionDeclContext) {
            functionStack.pop();
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

        if (isNewScopeNode(node)) {
            popScope(rangeFromNode(node, document).end);
        }
    };

    visit(parseResult.tree, documentSymbols);

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
        unresolvedReferences,
        occurrenceIndex,
        documentSymbols,
    };
}

function createDocumentSymbol(
    name: string,
    kind: SymbolKind,
    declarationNode: ParserRuleContext,
    selectionNode: ParserRuleContext | ParseTree,
    document: TextDocument,
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

function sanitizeSymbolName(name: string): string | null {
    const trimmed = name.trim();
    const isValid = trimmed !== "" && trimmed !== "$";
    return isValid ? trimmed : null;
}

function createDefinition(
    name: string,
    kind: "function",
    declarationNode: ParserRuleContext,
    selectionNode: ParseTree,
    document: TextDocument,
): SourceFunctionDefinition;
function createDefinition(
    name: string,
    kind: "parameter",
    declarationNode: ParserRuleContext,
    selectionNode: ParseTree,
    document: TextDocument,
    containingFunction: SourceFunctionDefinition,
): SourceParameterDefinition;
function createDefinition(
    name: string,
    kind: VariableKind,
    declarationNode: ParserRuleContext,
    selectionNode: ParseTree,
    document: TextDocument,
): SourceVariableDefinition;
function createDefinition(
    name: string,
    kind: SourceDefinitionKind,
    declarationNode: ParserRuleContext,
    selectionNode: ParseTree,
    document: TextDocument,
    containingFunction?: SourceFunctionDefinition,
): SourceDefinition {
    const result = {
        name,
        node: declarationNode,
        range: rangeFromNode(declarationNode, document),
        selectionRange: rangeFromNode(selectionNode, document),
        scopeEnd: { line: 0, character: 0 },
        references: [],
        isBuiltin: false as const,
    };

    if (kind === "function") {
        return {
            ...result,
            kind: "function",
            parameters: [],
        } satisfies SourceFunctionDefinition;
    }

    if (kind === "parameter") {
        if (containingFunction === undefined) {
            throw new Error("Parameter declaration must belong to a function.");
        }

        return {
            ...result,
            kind: "parameter",
            function: containingFunction,
        } satisfies SourceParameterDefinition;
    }

    return {
        ...result,
        kind,
    } satisfies SourceVariableDefinition;
}

function isDeclarationVarRef(node: VarRefContext): boolean {
    const parent = node.parent;

    if (parent instanceof VarDeclContext || parent instanceof LetVarContext || parent instanceof GroupByVarContext || parent instanceof CountClauseContext) {
        return parent.varRef() === node;
    }

    if (parent instanceof ForVarContext) {
        return parent.varRef().some((entry) => entry === node);
    }

    return false;
}
