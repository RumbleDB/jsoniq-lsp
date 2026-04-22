import { Position } from "vscode-languageserver";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VariableKind } from "./analysis.js";

export const WRAPPER_JAR_ENV_VARIABLE = "JSONIQ_RUMBLE_WRAPPER_JAR";

export const WRAPPER_JAR_NAME_PREFIX = "rumble-lsp-wrapper";

export const WRAPPER_JAR_PRODUCTION_FOLDER = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../wrapper"
);

export const WRAPPER_JAR_DEVELOPMENT_FOLDER = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../rumble-lsp-wrapper/target"
);

export interface WrapperVariableType {
    name: string;
    type: string;
    kind: VariableKind;
}

export interface WrapperFunctionType {
    position: Position;
    name: string;
    parameterTypes: Array<{
        name: string;
        type: string;
    }>
    returnType: string;
}

export interface WrapperTypeError {
    code: string;
    message: string;
    location: string;
    position: Position;
}

export interface WrapperBuiltinFunctionSignature {
    parameterTypes: string[];
    returnType: string;
}

type WrapperRequestType = "inferTypes" | "builtinFunctions";

type RequestPayloadByType = {
    inferTypes: {
        requestType: "inferTypes";
        body: string;
    };
    builtinFunctions: {
        requestType: "builtinFunctions";
    };
};

type ResponseByType = {
    inferTypes: QueryResponse;
    builtinFunctions: BuiltInFunctionListResponse;
};

interface WrapperDaemonRequest {
    id: number;
    requestType: WrapperRequestType;
    body?: string;
}

export interface QueryResponseBody {
    variableTypes: WrapperVariableType[];
    functionTypes: WrapperFunctionType[];
    typeErrors: WrapperTypeError[];
}

export interface BuiltInFunctionListResponseBody {
    builtinFunctions: Record<string, WrapperBuiltinFunctionSignature>;
}

type ResponseBodyByType = {
    inferTypes: QueryResponseBody;
    builtinFunctions: BuiltInFunctionListResponseBody;
};

export interface WrapperDaemonResponse<ResponseType extends WrapperRequestType = WrapperRequestType> {
    id: number;
    responseType: ResponseType;
    body: ResponseBodyByType[ResponseType];
    error: string | null;
}

export type QueryResponse = WrapperDaemonResponse<"inferTypes">;
export type BuiltInFunctionListResponse = WrapperDaemonResponse<"builtinFunctions">;

interface PendingRequest {
    expectedResponseType: WrapperRequestType;
    fallbackResponse: WrapperDaemonResponse;
    resolve: (response: WrapperDaemonResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

interface WrapperLaunchConfig {
    args: string[];
}

export class RumbleWrapperConnection {
    private child: ChildProcessWithoutNullStreams | undefined;
    private nextRequestId = 1;
    private stdoutBuffer = "";
    private readonly pending = new Map<number, PendingRequest>();

    public async inferTypes(query: string): Promise<QueryResponse> {
        const body = Buffer.from(query, "utf8").toString("base64");
        return this.sendRequest<"inferTypes">({
            requestType: "inferTypes",
            body,
        }, {
            id: -1,
            responseType: "inferTypes",
            body: {
                variableTypes: [],
                functionTypes: [],
                typeErrors: [],
            },
            error: "Wrapper request failed.",
        });
    }

    public async listBuiltinFunctions(): Promise<BuiltInFunctionListResponse> {
        return this.sendRequest<"builtinFunctions">({
            requestType: "builtinFunctions",
        }, {
            id: -1,
            responseType: "builtinFunctions",
            body: {
                builtinFunctions: {},
            },
            error: "Wrapper request failed.",
        });
    }

    private async sendRequest<RequestType extends WrapperRequestType>(
        requestPayload: RequestPayloadByType[RequestType],
        fallbackResponse: ResponseByType[RequestType],
    ): Promise<ResponseByType[RequestType]> {
        const id = this.nextRequestId;
        this.nextRequestId += 1;

        const request: WrapperDaemonRequest = {
            id,
            ...requestPayload,
        };
        const encodedRequest = JSON.stringify(request);
        const child = this.child;

        if (child === undefined) {
            return {
                ...fallbackResponse,
                id,
                error: "Wrapper process is not available.",
            };
        }

        return new Promise<ResponseByType[RequestType]>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error("Wrapper timed out."));
            }, 12_000);

            this.pending.set(id, {
                expectedResponseType: requestPayload.requestType,
                fallbackResponse,
                resolve: resolve as unknown as (response: WrapperDaemonResponse) => void,
                reject,
                timeout,
            });

            try {
                child.stdin.write(`${encodedRequest}\n`, "utf8", (error) => {
                    if (error !== undefined && error !== null) {
                        this.rejectPending(id, error);
                    }
                });
            } catch (error) {
                this.rejectPending(id, error instanceof Error ? error : new Error("Wrapper write failed."));
            }
        }).catch((error: unknown) => ({
            ...fallbackResponse,
            id,
            error: error instanceof Error ? error.message : "Wrapper request failed.",
        }) as ResponseByType[RequestType]);
    }

    public dispose(): void {
        for (const pendingRequest of this.pending.values()) {
            clearTimeout(pendingRequest.timeout);
            pendingRequest.reject(new Error("Wrapper client disposed."));
        }
        this.pending.clear();

        if (this.child !== undefined) {
            this.child.kill();
            this.child = undefined;
        }
    }

    public ensureProcess(): void {
        if (this.child !== undefined) {
            return;
        }

        const launchConfig = resolveWrapperLaunchConfig();
        console.log(`Launching wrapper with args: ${launchConfig.args.join(" ")}`);

        this.child = spawn("java", launchConfig.args, {
            stdio: "pipe",
        });

        this.child.stdout.setEncoding("utf8");
        this.child.stdout.on("data", (chunk: string) => {
            this.handleStdoutChunk(chunk);
        });

        this.child.on("error", (error) => {
            this.rejectAllPending(error);
            this.child = undefined;
            this.stdoutBuffer = "";
        });

        this.child.on("close", () => {
            this.rejectAllPending(new Error("Wrapper process closed."));
            this.child = undefined;
            this.stdoutBuffer = "";
        });
    }

    private handleStdoutChunk(chunk: string): void {
        this.stdoutBuffer += chunk;
        const lines = this.stdoutBuffer.split("\n");
        this.stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length === 0 || !trimmed.startsWith("{")) {
                continue;
            }
            this.handleResponseLine(trimmed);
        }
    }

    private handleResponseLine(line: string): void {
        let response: WrapperDaemonResponse;
        try {
            response = JSON.parse(line) as WrapperDaemonResponse;
        } catch {
            return;
        }

        if (typeof response.id !== "number") {
            return;
        }

        const pendingRequest = this.pending.get(response.id);
        if (pendingRequest === undefined) {
            return;
        }

        clearTimeout(pendingRequest.timeout);
        this.pending.delete(response.id);
        if (response.responseType !== pendingRequest.expectedResponseType) {
            pendingRequest.resolve({
                ...pendingRequest.fallbackResponse,
                id: response.id,
                error: `Wrapper returned responseType '${response.responseType}' for requestType '${pendingRequest.expectedResponseType}'.`,
            });
            return;
        }
        pendingRequest.resolve(response);
    }

    private rejectPending(id: number, error: Error): void {
        const pendingRequest = this.pending.get(id);
        if (pendingRequest === undefined) {
            return;
        }

        clearTimeout(pendingRequest.timeout);
        this.pending.delete(id);
        pendingRequest.reject(error);
    }

    private rejectAllPending(error: Error): void {
        for (const [id, pendingRequest] of this.pending.entries()) {
            clearTimeout(pendingRequest.timeout);
            pendingRequest.reject(error);
            this.pending.delete(id);
        }
    }
}

function resolveWrapperLaunchConfig(): WrapperLaunchConfig {
    /// 1. Check for explicitly configured wrapper jar path via environment variable.
    const configuredJarPath = process.env[WRAPPER_JAR_ENV_VARIABLE];
    if (configuredJarPath !== undefined && configuredJarPath.length > 0) {
        return {
            args: ["-jar", configuredJarPath, "--daemon"],
        };
    }

    /// 2. In the development environment, the wrapper jar is expected to be built by the user and available in the target directory.
    if (process.env.JSONIQ_LSP_DEBUG === "1") {
        const jarPath = pickLatestJarFromDirectory(WRAPPER_JAR_DEVELOPMENT_FOLDER);
        return {
            args: ["-jar", jarPath, "--daemon"],
        };
    }
    else {
        /// In production environment, the wrapper jar should be copied to ./dist/wrapper folder
        const jarPath = pickLatestJarFromDirectory(WRAPPER_JAR_PRODUCTION_FOLDER);

        return {
            args: ["-jar", jarPath, "--daemon"],
        };
    };
}

function pickLatestJarFromDirectory(directory: string): string {
    /// Try to pick the latest wrapper jar from the target directory, prioritizing non-all jar for development
    const files = fs.readdirSync(directory);
    const wrapperJars = files.filter((file) => file.startsWith(WRAPPER_JAR_NAME_PREFIX) && file.endsWith(".jar"))
        .map((file) => path.join(directory, file))
        .sort(
            (a, b) => {
                return fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime();
            }
        )

    if (wrapperJars.length === 0) {
        console.warn(`No wrapper jar found in directory '${directory}'.`);
    }
    return wrapperJars[0]!;
};

export const connection = new RumbleWrapperConnection();
