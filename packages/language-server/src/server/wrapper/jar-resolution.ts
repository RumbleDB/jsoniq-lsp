import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WRAPPER_JAR_ENV_VARIABLE = "JSONIQ_RUMBLE_WRAPPER_JAR";

export const WRAPPER_JAR_NAME_PREFIX = "rumble-lsp-wrapper";

export const WRAPPER_JAR_PRODUCTION_FOLDER = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../wrapper"
);

export const WRAPPER_JAR_DEVELOPMENT_FOLDER = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../rumble-lsp-wrapper/target"
);

export const WRAPPER_RUNTIME_CLASSPATH_FILE = "runtime-classpath.txt";
export const WRAPPER_MAIN_CLASS = "org.jsoniq.lsp.rumble.Main";

export interface WrapperLaunchConfig {
    args: string[];
}

export function resolveWrapperLaunchConfig(): WrapperLaunchConfig {
    // 1. Check for explicitly configured wrapper jar path via environment variable.
    let jarPath = process.env[WRAPPER_JAR_ENV_VARIABLE];
    if (jarPath !== undefined && jarPath.length > 0) {
        return {
            args: ["-jar", jarPath, "--daemon"],
        };
    }

    // 2. In development, the wrapper jar is expected in the target directory.
    if (process.env.JSONIQ_LSP_DEBUG === "1") {
        const thinJarPath = pickLatestJarFromDirectory(WRAPPER_JAR_DEVELOPMENT_FOLDER, { preferThin: true });
        const classpathPath = path.join(WRAPPER_JAR_DEVELOPMENT_FOLDER, WRAPPER_RUNTIME_CLASSPATH_FILE);

        if (thinJarPath !== undefined && fs.existsSync(classpathPath)) {
            const runtimeClasspath = fs.readFileSync(classpathPath, "utf8").trim();
            const classpath = runtimeClasspath === ""
                ? thinJarPath
                : `${thinJarPath}${path.delimiter}${runtimeClasspath}`;

            return {
                args: ["-cp", classpath, WRAPPER_MAIN_CLASS, "--daemon"],
            };
        }

        console.warn(
            `Development wrapper launch requires both a thin jar and '${WRAPPER_RUNTIME_CLASSPATH_FILE}' in '${WRAPPER_JAR_DEVELOPMENT_FOLDER}'. Falling back to production jar launch.`,
        );
    }

    // 3. In production, the wrapper jar is expected to be copied to ./dist/wrapper.
    jarPath = pickLatestJarFromDirectory(WRAPPER_JAR_PRODUCTION_FOLDER, { preferFat: true })
        ?? pickLatestJarFromDirectory(WRAPPER_JAR_PRODUCTION_FOLDER);

    if (jarPath === undefined) {
        throw new Error(`No wrapper jar found in '${WRAPPER_JAR_PRODUCTION_FOLDER}'.`);
    }

    return {
        args: ["-jar", jarPath, "--daemon"],
    };
}

function pickLatestJarFromDirectory(
    directory: string,
    options?: {
        preferThin?: boolean;
        preferFat?: boolean;
    },
): string | undefined {
    if (!fs.existsSync(directory)) {
        console.warn(`Wrapper jar directory does not exist: '${directory}'.`);
        return undefined;
    }

    const files = fs.readdirSync(directory);
    const wrapperJars = files
        .filter((file) => file.startsWith(WRAPPER_JAR_NAME_PREFIX) && file.endsWith(".jar"))
        .map((file) => path.join(directory, file))
        .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());

    if (options?.preferThin === true) {
        const thinJar = wrapperJars.find((jarPath) => !jarPath.endsWith("-all.jar"));
        if (thinJar !== undefined) {
            return thinJar;
        }
    }

    if (options?.preferFat === true) {
        const fatJar = wrapperJars.find((jarPath) => jarPath.endsWith("-all.jar"));
        if (fatJar !== undefined) {
            return fatJar;
        }
    }

    if (wrapperJars.length === 0) {
        console.warn(`No wrapper jar found in directory '${directory}'.`);
    }

    return wrapperJars[0];
}
