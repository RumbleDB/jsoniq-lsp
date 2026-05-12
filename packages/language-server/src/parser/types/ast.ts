import type { Range } from "vscode-languageserver";

import type { AnyAstDeclaration } from "./declaration.js";
import type { FunctionName, ReferenceNameByKind } from "./name.js";

export type AstNodeKind =
    | "module"
    | "functionDeclaration"
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

export interface FunctionDeclarationAstNode extends AstNodeBase<"functionDeclaration"> {
    readonly declaration: Extract<AnyAstDeclaration, { kind: "function" }>;
}

export interface FlowrExpressionAstNode extends AstNodeBase<"flowrExpression"> {}

export interface CatchClauseAstNode extends AstNodeBase<"catchClause"> {
    readonly declarations: Extract<AnyAstDeclaration, { kind: "catch-variable" }>[];
}

export interface DeclarationAstNode extends AstNodeBase<"declaration"> {
    readonly declaration: AnyAstDeclaration;
}

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
    | FunctionDeclarationAstNode
    | FlowrExpressionAstNode
    | CatchClauseAstNode
    | DeclarationAstNode
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
