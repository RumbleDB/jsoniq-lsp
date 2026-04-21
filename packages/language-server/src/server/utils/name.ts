import { FunctionCallContext, FunctionDeclContext, NamedFunctionRefContext, VarRefContext } from "../../grammar/jsoniqParser.js";

/**
 * Extracts the variable name from a VarRefContext node, including the leading "$" character.
 * @param node The VarRefContext node representing the variable reference in the parse tree
 * @returns The variable name as a string, including the leading "$" (e.g. "$x")
 */
export function varRefName(node: VarRefContext): string {
    return `$${node.qname().getText()}`;
}

export function varRefNameOrNull(node: VarRefContext): string | null {
    const qname = node.qname();
    const name = qname?.getText().trim();
    return name === undefined || name === "" ? null : `$${name}`;
}

export function functionName(node: FunctionDeclContext | FunctionCallContext | NamedFunctionRefContext): string {
    return (node._fn_name?.getText() ?? node.qname().getText()).trim();
}

export function functionNameWithArity(node: FunctionDeclContext | FunctionCallContext | NamedFunctionRefContext): string {
    return `${functionName(node)}#${functionArity(node)}`;
}

export function functionNameWithArityOrNull(node: FunctionDeclContext | FunctionCallContext | NamedFunctionRefContext): string | null {
    const name = functionName(node);
    if (name === undefined || name === "") {
        return null;
    }

    return `${name}#${functionArity(node)}`;
}

function functionArity(node: FunctionDeclContext | FunctionCallContext | NamedFunctionRefContext): number {
    if (node instanceof FunctionDeclContext) {
        return node.paramList()?.param().length ?? 0;
    } else if (node instanceof FunctionCallContext) {
        return node.argumentList().argument().length;
    } else if (node instanceof NamedFunctionRefContext) {
        return Number.parseInt(node._arity?.text ?? node.Literal().getText(), 10);
    }
    throw new Error("Unsupported node type for function arity extraction");
}
