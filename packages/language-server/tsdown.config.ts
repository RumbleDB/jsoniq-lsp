import { defineConfig } from "tsdown";

export default defineConfig({
    entry: [
        "src/main.ts",
        "src/notifications/index.ts",
        "src/wrapper/executable/ensure-wrapper.ts",
    ],
    root: "src",
    outDir: "dist",

    format: "esm",
    platform: "node",

    dts: true,
    sourcemap: false,
    clean: true,
});
