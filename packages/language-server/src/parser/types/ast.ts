import type { Range } from "vscode-languageserver";

import type { FunctionName, Prefix, QName, ReferenceNameByKind, VarName } from "./name.js";

export type AstNodeKind =
    | "module"
    | "namespaceDeclaration"
    | "contextItemDeclaration"
    | "typeDeclaration"
    | "functionDeclaration"
    | "variableDeclaration"
    | "forBinding"
    | "letBinding"
    | "groupByBinding"
    | "countClause"
    | "flowrExpression"
    | "catchClause"
    | "declaration"
    | "reference"
    | "functionCall"
    | "namedFunctionReference"
    | "variableReference"
    | "contextItemExpression"
    | "unknown";

export interface AstNodeBase<K extends AstNodeKind> {
    readonly kind: K;
    readonly range: Range;
    readonly children: AstNode[];
    parent?: AstNode;
}

export interface ModuleAstNode extends AstNodeBase<"module"> {}

export interface NamespaceDeclarationAstNode extends AstNodeBase<"namespaceDeclaration"> {
    readonly prefix: Prefix;
    readonly namespaceUri: string;
    readonly selectionRange: Range;
}

export interface ContextItemDeclarationAstNode extends AstNodeBase<"contextItemDeclaration"> {
    readonly name: VarName;
    readonly selectionRange: Range;
}

export interface TypeDeclarationAstNode extends AstNodeBase<"typeDeclaration"> {
    readonly name: { qname: QName };
    readonly selectionRange: Range;
}

export interface AstParameter {
    readonly name: VarName;
    readonly range: Range;
    readonly selectionRange: Range;
}

export interface AstBinding {
    readonly name: VarName;
    readonly range: Range;
    readonly selectionRange: Range;
}

export interface ForBindingVariable extends AstBinding {
    readonly bindingKind: "for" | "for-position";
}

export interface FunctionDeclarationAstNode extends AstNodeBase<"functionDeclaration"> {
    readonly name: FunctionName;
    readonly nameRange: Range;
    readonly parameters: AstParameter[];
}

export interface VariableDeclarationAstNode extends AstNodeBase<"variableDeclaration"> {
    readonly binding: AstBinding;
    readonly completed: boolean;
}

export interface ForBindingAstNode extends AstNodeBase<"forBinding"> {
    readonly bindings: ForBindingVariable[];
}

export interface LetBindingAstNode extends AstNodeBase<"letBinding"> {
    readonly binding: AstBinding;
}

export interface GroupByBindingAstNode extends AstNodeBase<"groupByBinding"> {
    readonly binding: AstBinding;
}

export interface CountClauseAstNode extends AstNodeBase<"countClause"> {
    readonly binding: AstBinding;
}

export interface FlowrExpressionAstNode extends AstNodeBase<"flowrExpression"> {}

export interface CatchClauseAstNode extends AstNodeBase<"catchClause"> {}

export type ReferenceAstNode<K extends keyof ReferenceNameByKind = keyof ReferenceNameByKind> =
    K extends keyof ReferenceNameByKind
        ? AstNodeBase<"reference"> & {
              readonly name: ReferenceNameByKind[K];
              readonly referenceKind: K;
          }
        : never;

export interface FunctionCallAstNode extends AstNodeBase<"functionCall"> {
    readonly name: FunctionName;
    readonly nameRange: Range;
}

export interface NamedFunctionReferenceAstNode extends AstNodeBase<"namedFunctionReference"> {
    readonly name: FunctionName;
    readonly nameRange: Range;
}

export interface VariableReferenceAstNode extends AstNodeBase<"variableReference"> {
    readonly name: ReferenceNameByKind["variable"];
}

export interface ContextItemExpressionAstNode extends AstNodeBase<"contextItemExpression"> {
    readonly name: ReferenceNameByKind["variable"];
}

export interface UnknownAstNode extends AstNodeBase<"unknown"> {
    readonly reason: "unsupported-grammar" | "incomplete";
}

export type AstNode =
    | ModuleAstNode
    | NamespaceDeclarationAstNode
    | ContextItemDeclarationAstNode
    | TypeDeclarationAstNode
    | FunctionDeclarationAstNode
    | VariableDeclarationAstNode
    | ForBindingAstNode
    | LetBindingAstNode
    | GroupByBindingAstNode
    | CountClauseAstNode
    | FlowrExpressionAstNode
    | CatchClauseAstNode
    | ReferenceAstNode
    | FunctionCallAstNode
    | NamedFunctionReferenceAstNode
    | VariableReferenceAstNode
    | ContextItemExpressionAstNode
    | UnknownAstNode;

export type JsoniqAst = ModuleAstNode;

export function attachParents<T extends AstNode>(node: T, parent?: AstNode): T {
    if (parent !== undefined) {
        node.parent = parent;
    }
    for (const child of node.children) {
        attachParents(child, node);
    }
    return node;
}
