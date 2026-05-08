import { defineConfig } from "tsdown";

/// Create a bundled build of the language server, which inlines all dependencies.
/// Useful for VSCode extension, which expects all dependencies to be bundled in the extension package.
export default defineConfig({
    entry: "src/main.ts",
    root: "src",
    outDir: "dist/bundled",

    format: "esm",
    platform: "node",

    dts: true,
    sourcemap: false,
    clean: true,
    minify: true,

    deps: {
        alwaysBundle: [
            "antlr-ng",
            "antlr4-c3",
            "antlr4ng",
            "vscode-languageserver",
            "vscode-languageserver-textdocument",
        ],
    },
});
