import { defineConfig } from "vitest/config";
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        exclude: ["dist/**", "node_modules/**"],
    },
    plugins: [
        tsconfigPaths()
    ],
});
