import { TextDocument } from "vscode-languageserver-textdocument";

const JSONIQ_MAGIC_PATTERN = /^%%jsoniq\b.*(?:\r?\n|$)/;
const NOTEBOOK_CELL_URI_PREFIX = "vscode-notebook-cell:";

export function getDocumentText(document: TextDocument): string {
    const source = document.getText();

    if (!document.uri.startsWith(NOTEBOOK_CELL_URI_PREFIX)) {
        /// For regular documents, return the text as-is
        return source;
    }

    const magicLine = source.match(JSONIQ_MAGIC_PATTERN)?.[0];
    if (magicLine === undefined) {
        return source;
    }

    /// In case of notebook cells with magic string, replace it with whitespace to prevent the parser from producing errors
    /// We don't remove it directly because then line offset will be different
    const maskedMagicLine = magicLine.replace(/[^\r\n]/g, " ");
    return `${maskedMagicLine}${source.slice(magicLine.length)}`;
}
