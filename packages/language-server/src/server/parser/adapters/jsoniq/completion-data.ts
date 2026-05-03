import { jsoniqParser } from "grammar/jsoniqParser.js";

export interface KeywordCompletion {
    tokenType: number;
    label: string;
    insertText?: string;
}

export const IGNORED_COMPLETION_TOKENS = new Set([
    jsoniqParser.ArgumentPlaceholder,
    jsoniqParser.Kplus,
    jsoniqParser.Kminus,
    jsoniqParser.Kasterisk,
    jsoniqParser.Kdiv,
    jsoniqParser.Klparen,
    jsoniqParser.Krparen,
    jsoniqParser.Klbrace,
    jsoniqParser.Krbrace,
    jsoniqParser.Kobject_start,
    jsoniqParser.Kobject_end,
    jsoniqParser.Klbracket,
    jsoniqParser.Krbracket,
    jsoniqParser.Kannotation,
    jsoniqParser.Kdot,
    jsoniqParser.Kbang,
    jsoniqParser.Kequal,
    jsoniqParser.Kor,
    jsoniqParser.Knot,
    jsoniqParser.Kless,
    jsoniqParser.Kless_or_equal,
    jsoniqParser.Kgreater,
    jsoniqParser.Kgreater_or_equal,
    jsoniqParser.Kcomma,
]);

export const PREFERRED_COMPLETION_RULES = new Set([
    jsoniqParser.RULE_declaredVarRef,
    jsoniqParser.RULE_declaredQName,
    jsoniqParser.RULE_varRef,
    jsoniqParser.RULE_qname,
    jsoniqParser.RULE_functionCall,
]);

export const KEYWORD_COMPLETIONS: KeywordCompletion[] = [
    keyword(jsoniqParser.Kdollar),
    ...[
        jsoniqParser.Kcopy,
        jsoniqParser.Kdelete,
        jsoniqParser.Kedit,
        jsoniqParser.Kevery,
        jsoniqParser.Kfor,
        jsoniqParser.Kif,
        jsoniqParser.Kinsert,
        jsoniqParser.Klet,
        jsoniqParser.Ksome,
        jsoniqParser.Kswitch,
        jsoniqParser.Ktry,
        jsoniqParser.Ktypeswitch,
        jsoniqParser.Ktrue,
        jsoniqParser.Kfalse,
    ].map((tokenType) => keyword(tokenType)),
    keyword(jsoniqParser.Kannotate),
    keyword(jsoniqParser.Kappend),
    keyword(jsoniqParser.Kcreate),
    keyword(jsoniqParser.Kordered),
    keyword(jsoniqParser.Krename),
    keyword(jsoniqParser.Kreplace),
    keyword(jsoniqParser.Ktruncate),
    keyword(jsoniqParser.Kunordered),
    keyword(jsoniqParser.NullLiteral, "null"),
    keyword(jsoniqParser.Kdeclare, "declare function", "declare function "),
    keyword(jsoniqParser.Kdeclare, "declare variable", "declare variable "),
    keyword(jsoniqParser.Kimport),
    keyword(jsoniqParser.Kjsoniq, "jsoniq version"),
    keyword(jsoniqParser.Kmodule),
    keyword(jsoniqParser.Kbreak, "break loop"),
    keyword(jsoniqParser.Kcontinue, "continue"),
    keyword(jsoniqParser.Kexit, "exit returning"),
    keyword(jsoniqParser.Kvariable),
    keyword(jsoniqParser.Kwhile),
    ...[
        jsoniqParser.Kallowing,
        jsoniqParser.Kas,
        jsoniqParser.Kat,
        jsoniqParser.Kcase,
        jsoniqParser.Kcatch,
        jsoniqParser.Kcount,
        jsoniqParser.Kdefault,
        jsoniqParser.Kelse,
        jsoniqParser.Kin,
        jsoniqParser.Knamespace,
        jsoniqParser.Kreturn,
        jsoniqParser.Kthen,
        jsoniqParser.Kvalidate,
        jsoniqParser.Kwhere,
    ].map((tokenType) => keyword(tokenType)),
    keyword(jsoniqParser.Kgroup, "group by"),
    keyword(jsoniqParser.Korder, "order by"),
];

function keyword(tokenType: number, label = tokenLabel(tokenType), insertText?: string): KeywordCompletion {
    return {
        tokenType,
        label,
        ...(insertText === undefined ? {} : { insertText }),
    };
}

function tokenLabel(tokenType: number): string {
    const literalName = jsoniqParser.literalNames[tokenType];
    return literalName?.replace(/^'|'$/g, "") ?? jsoniqParser.symbolicNames[tokenType] ?? tokenType.toString();
}
