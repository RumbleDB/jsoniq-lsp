import type { Range } from "vscode-languageserver";

import type { AnyAstDeclaration } from "./declaration.js";
import type { FunctionName, ReferenceNameByKind } from "./name.js";

export type AstNodeKind =
    | "module"
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

export interface FunctionDeclarationAstNode extends AstNodeBase<"functionDeclaration"> {
    readonly declaration: Extract<AnyAstDeclaration, { kind: "function" }>;
}

export interface VariableDeclarationAstNode extends AstNodeBase<"variableDeclaration"> {
    readonly declaration: Extract<AnyAstDeclaration, { kind: "declare-variable" }>;
}

export interface ForBindingAstNode extends AstNodeBase<"forBinding"> {
    readonly declarations: Extract<AnyAstDeclaration, { kind: "for" | "for-position" }>[];
}

export interface LetBindingAstNode extends AstNodeBase<"letBinding"> {
    readonly declaration: Extract<AnyAstDeclaration, { kind: "let" }>;
}

export interface GroupByBindingAstNode extends AstNodeBase<"groupByBinding"> {
    readonly declaration: Extract<AnyAstDeclaration, { kind: "group-by" }>;
}

export interface CountClauseAstNode extends AstNodeBase<"countClause"> {
    readonly declaration: Extract<AnyAstDeclaration, { kind: "count" }>;
}

export interface FlowrExpressionAstNode extends AstNodeBase<"flowrExpression"> {}

export interface CatchClauseAstNode extends AstNodeBase<"catchClause"> {}

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
    | VariableDeclarationAstNode
    | ForBindingAstNode
    | LetBindingAstNode
    | GroupByBindingAstNode
    | CountClauseAstNode
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
