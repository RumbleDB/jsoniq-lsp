export type Prefix = string;
export type LocalName = string;

export type QName = {
    prefix?: Prefix;
    localName: LocalName;
};

export type VarName = {
    qname: QName;
};

export type FunctionName = {
    qname: QName;
    arity?: number;
};

export type NamespaceName = {
    prefix: Prefix;
};

export type DeclarationNameByKind = {
    namespace: NamespaceName;
    function: FunctionName;
    parameter: VarName;
    "declare-variable": VarName;
    let: VarName;
    for: VarName;
    "for-position": VarName;
    "group-by": VarName;
    count: VarName;
    "catch-variable": VarName;
    type: { qname: QName };
    "context-item": { label: "context item" };
};

export type ReferenceNameByKind = {
    function: FunctionName;
    variable: VarName;
};

export function qnameToString(qname: QName): string {
    return qname.prefix === undefined ? qname.localName : `${qname.prefix}:${qname.localName}`;
}

export function varNameToString(name: VarName): string {
    return `$${qnameToString(name.qname)}`;
}

export function functionNameToString(name: FunctionName): string {
    return `${qnameToString(name.qname)}#${name.arity ?? "?"}`;
}

export function referenceNameToString<K extends keyof ReferenceNameByKind>(
    name: ReferenceNameByKind[K],
    kind: K,
): string {
    switch (kind) {
        case "function":
            return functionNameToString(name as FunctionName);
        case "variable":
            return varNameToString(name as VarName);
        default:
            throw kind satisfies never;
    }
}
