import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";

import type { FunctionEntry } from "../src/function-doc/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_DIR = path.join(__dirname, "..", "docs", "functions");
const OUTPUT_FILE_PATH = path.join(
    __dirname,
    "..",
    "assets",
    "function-doc",
    "custom-functions.json",
);

const TEXT_FIELDS = ["rules", "errors", "notes", "examples"] as const;
type TextFieldName = (typeof TEXT_FIELDS)[number];

function appendText(target: Partial<FunctionEntry>, field: TextFieldName, value: unknown): void {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
        return;
    }

    target[field] = target[field] ? `${target[field]}\n\n${text}` : text;
}

function appendProperties(entry: Partial<FunctionEntry>, properties: string[] | undefined): void {
    if (!properties || properties.length === 0) {
        return;
    }

    entry.properties = [...(entry.properties ?? []), ...properties];
}

function toOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    return String(value);
}

function parseProperties(content: string): string[] {
    return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => line.replace(/^[-*+]\s+/, "").trim())
        .filter((line) => line.length > 0);
}

function parseMarkdownSections(content: string, filePath: string): Partial<FunctionEntry> {
    const entry: Partial<FunctionEntry> = {};
    const lines = content.split(/\r?\n/);
    const preamble: string[] = [];
    let currentSection: string | undefined;
    let buffer: string[] = [];

    function flushSection() {
        const body = buffer.join("\n").trim();
        buffer = [];

        if (!currentSection || !body) {
            return;
        }

        if (currentSection === "properties") {
            appendProperties(entry, parseProperties(body));
            return;
        }

        if (TEXT_FIELDS.includes(currentSection as TextFieldName)) {
            appendText(entry, currentSection as TextFieldName, body);
            return;
        }

        console.warn(`Ignoring unknown function doc section "${currentSection}" in ${filePath}.`);
    }

    for (const line of lines) {
        const headingMatch = line.match(/^#{2,3}\s+(.+?)\s*$/);
        if (headingMatch) {
            flushSection();
            currentSection = headingMatch[1]?.trim().replace(/:$/, "").toLowerCase();
            continue;
        }

        if (currentSection) {
            buffer.push(line);
        } else {
            preamble.push(line);
        }
    }

    flushSection();

    const preambleText = preamble.join("\n").trim();
    if (preambleText.length > 0) {
        console.warn(
            `Found unsectioned markdown in ${filePath}; treating it as additional rules content.`,
        );
        entry.rules = entry.rules ? `${preambleText}\n\n${entry.rules}` : preambleText;
    }

    return entry;
}

function getMarkdownFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }
    const files: string[] = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            files.push(...getMarkdownFiles(fullPath));
        } else if (item.isFile() && item.name.endsWith(".md")) {
            files.push(fullPath);
        }
    }
    return files;
}

function main() {
    console.log(`Compiling function docs from ${DOCS_DIR}...`);

    const docs: Record<string, FunctionEntry> = {};
    const files = getMarkdownFiles(DOCS_DIR);

    if (files.length === 0) {
        console.log("No custom markdown files found. Writing empty custom function docs.");
    }

    for (const file of files) {
        try {
            const fileContent = fs.readFileSync(file, "utf-8");
            const { data, content } = matter(fileContent);

            const name = data.name;
            const prefix = data.prefix || "fn";
            if (!name) {
                console.warn(`Skipping ${file}: 'name' is missing in frontmatter.`);
                continue;
            }

            const key = `${prefix}:${name}`;

            const entry: FunctionEntry = {
                name,
                prefix,
                summary: toOptionalString(data.summary) ?? "",
                signatures: Array.isArray(data.signatures) ? data.signatures : [],
            };

            const sections = parseMarkdownSections(content, file);

            appendText(entry, "rules", sections.rules);
            appendText(entry, "errors", data.errors);
            appendText(entry, "errors", sections.errors);
            appendText(entry, "notes", data.notes);
            appendText(entry, "notes", sections.notes);
            appendText(entry, "examples", data.examples);
            appendText(entry, "examples", sections.examples);
            if (Array.isArray(data.properties)) {
                entry.properties = data.properties.map(String);
            }
            appendProperties(entry, sections.properties);

            if (docs[key]) {
                console.warn("Found duplicated entries: ", key);
                docs[key].signatures.push(...entry.signatures);
                if (entry.summary && !docs[key].summary) {
                    docs[key].summary = entry.summary;
                }
                for (const field of TEXT_FIELDS) {
                    appendText(docs[key], field, entry[field]);
                }
                appendProperties(docs[key], entry.properties);
            } else {
                docs[key] = entry;
            }
        } catch (err) {
            console.error(`Failed to parse ${file}:`, err);
        }
    }

    const assetsDir = path.dirname(OUTPUT_FILE_PATH);
    if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE_PATH, JSON.stringify(docs, null, 4), "utf-8");

    console.log(
        `Successfully compiled ${Object.keys(docs).length} custom function entries to ${OUTPUT_FILE_PATH}`,
    );
}

main();
