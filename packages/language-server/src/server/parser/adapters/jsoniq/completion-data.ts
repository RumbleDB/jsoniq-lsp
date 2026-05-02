import { jsoniqParser } from "grammar/jsoniqParser.js";

export interface KeywordCompletion {
    tokenType: number;
    label: string;
    insertText?: string;
}

/**
 * Determines whether we are in a context where an expression can be expected, based on the syntax context.
 * This is used to filter keyword completions, e.g. we don't want to suggest "if" in a context where an expression cannot start.
 */
export const VARIABLE_DECLARATION_RULES = new Set([
    jsoniqParser.RULE_varDecl,
    jsoniqParser.RULE_varDeclForStatement,
    jsoniqParser.RULE_varDeclStatement,
    jsoniqParser.RULE_forClause,
    jsoniqParser.RULE_forVar,
    jsoniqParser.RULE_letClause,
    jsoniqParser.RULE_letVar,
    jsoniqParser.RULE_groupByClause,
    jsoniqParser.RULE_groupByVar,
    jsoniqParser.RULE_countClause,
    jsoniqParser.RULE_quantifiedExpr,
    jsoniqParser.RULE_quantifiedExprVar,
    jsoniqParser.RULE_caseClause,
    jsoniqParser.RULE_param,
    jsoniqParser.RULE_paramList,
]);

/**
 * These are the grammar rules that can contain variable binding occurrences in their header.
 * We use this to determine whether we are in a declaration-name context (e.g. the "$x" in "let $x := 1")
 * or a reference context (e.g. the "$x" in "let $y := $x + 1").
 * Note that we need to exclude contexts that are nested inside declaration constructs, e.g. the "$x" in
 * "let $x := <expr>" is not a declaration-name context, even though it is contained in a varDecl rule.
 */
export const VARIABLE_DECLARATION_NAME_RULES = new Set([
    jsoniqParser.RULE_qname,
    jsoniqParser.RULE_varRef,
    jsoniqParser.RULE_param,
    jsoniqParser.RULE_paramList,
]);

export const EXPRESSION_RULES = new Set([
    jsoniqParser.RULE_expr,
    jsoniqParser.RULE_exprSingle,
    jsoniqParser.RULE_exprSimple,
    jsoniqParser.RULE_flowrExpr,
    jsoniqParser.RULE_switchExpr,
    jsoniqParser.RULE_typeSwitchExpr,
    jsoniqParser.RULE_ifExpr,
    jsoniqParser.RULE_tryCatchExpr,
    jsoniqParser.RULE_quantifiedExpr,
    jsoniqParser.RULE_orExpr,
    jsoniqParser.RULE_andExpr,
    jsoniqParser.RULE_notExpr,
    jsoniqParser.RULE_comparisonExpr,
    jsoniqParser.RULE_stringConcatExpr,
    jsoniqParser.RULE_rangeExpr,
    jsoniqParser.RULE_additiveExpr,
    jsoniqParser.RULE_multiplicativeExpr,
    jsoniqParser.RULE_instanceOfExpr,
    jsoniqParser.RULE_isStaticallyExpr,
    jsoniqParser.RULE_treatExpr,
    jsoniqParser.RULE_castableExpr,
    jsoniqParser.RULE_castExpr,
    jsoniqParser.RULE_arrowExpr,
    jsoniqParser.RULE_unaryExpr,
    jsoniqParser.RULE_valueExpr,
    jsoniqParser.RULE_validateExpr,
    jsoniqParser.RULE_annotateExpr,
    jsoniqParser.RULE_simpleMapExpr,
    jsoniqParser.RULE_postFixExpr,
    jsoniqParser.RULE_pathExpr,
    jsoniqParser.RULE_primaryExpr,
]);

export const KEYWORD_COMPLETIONS: KeywordCompletion[] = [
    keyword(jsoniqParser.Kdollar, "$"),
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

export const EXPRESSION_KEYWORD_TOKENS = new Set([
    jsoniqParser.Kevery,
    jsoniqParser.Kfor,
    jsoniqParser.Kif,
    jsoniqParser.Klet,
    jsoniqParser.Ksome,
    jsoniqParser.Kswitch,
    jsoniqParser.Ktry,
    jsoniqParser.Ktypeswitch,
    jsoniqParser.Ktrue,
    jsoniqParser.Kfalse,
    jsoniqParser.NullLiteral,
]);

const EXPRESSION_START_TOKENS = new Set([
    jsoniqParser.Kdollar,
    jsoniqParser.Kif,
    jsoniqParser.Kfor,
    jsoniqParser.Klet,
    jsoniqParser.Ksome,
    jsoniqParser.Kevery,
    jsoniqParser.Kswitch,
    jsoniqParser.Ktypeswitch,
    jsoniqParser.Ktry,
    jsoniqParser.Ktrue,
    jsoniqParser.Kfalse,
    jsoniqParser.NullLiteral,
    jsoniqParser.Kannotate,
    jsoniqParser.Kordered,
    jsoniqParser.Kunordered,
]);

export const NON_DOLLAR_EXPRESSION_START_TOKENS = new Set(
    [...EXPRESSION_START_TOKENS.values()].filter((tokenType) => tokenType !== jsoniqParser.Kdollar),
);

export const FLOWR_CONTINUATION_TOKENS = new Set([
    jsoniqParser.Kwhere,
    jsoniqParser.Kgroup,
    jsoniqParser.Korder,
    jsoniqParser.Kreturn,
]);

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
