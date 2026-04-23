import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { resolveWrapperLaunchConfig } from "./jar-resolution.js";
import { FALLBACK_HANDSHAKE_RESPONSE, REQUEST_TYPE_HANDSHAKE } from "./handshake.js";
import type {
    RequestPayloadByType,
    WrapperDaemonRequest,
    WrapperDaemonResponse,
    WrapperRequestType,
    WrapperResponseBodyByType,
} from "./protocol.js";

type ResponseByType = {
    [RequestType in WrapperRequestType]: WrapperDaemonResponse<RequestType, WrapperResponseBodyByType[RequestType]>;
};

type AnyWrapperResponse = ResponseByType[WrapperRequestType];

interface PendingRequest {
    expectedResponseType: WrapperRequestType;
    fallbackResponse: AnyWrapperResponse;
    resolve: (response: AnyWrapperResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

class RumbleWrapperClient {
    private child: ChildProcessWithoutNullStreams | undefined;
    private nextRequestId = 1;
    private stdoutBuffer = "";
    private readonly pending = new Map<number, PendingRequest>();
    private processReadyPromise: Promise<void> | undefined;
    private handshakeCompleted = false;
    private rumbleVersion: string | null = null;

    public async ensureProcess(): Promise<void> {
        if (this.child !== undefined && this.handshakeCompleted) {
            return;
        }

        if (this.processReadyPromise !== undefined) {
            await this.processReadyPromise;
            return;
        }

        this.processReadyPromise = this.startAndHandshake();
        try {
            await this.processReadyPromise;
        } finally {
            this.processReadyPromise = undefined;
        }
    }

    private async startAndHandshake(): Promise<void> {
        if (this.child === undefined) {
            const launchConfig = resolveWrapperLaunchConfig();
            console.log(`Launching wrapper with args: ${launchConfig.args.join(" ")}`);

            this.child = spawn("java", launchConfig.args, {
                stdio: "pipe",
            });

            this.handshakeCompleted = false;
            this.child.stdout.setEncoding("utf8");
            this.child.stdout.on("data", (chunk: string) => {
                this.handleStdoutChunk(chunk);
            });

            this.child.on("error", (error) => {
                this.rejectAllPending(error);
                this.child = undefined;
                this.stdoutBuffer = "";
                this.handshakeCompleted = false;
            });

            this.child.on("close", () => {
                this.rejectAllPending(new Error("Wrapper process closed."));
                this.child = undefined;
                this.stdoutBuffer = "";
                this.handshakeCompleted = false;
            });
        }

        const handshakeResponse = await this.sendRequest<typeof REQUEST_TYPE_HANDSHAKE>({
            requestType: REQUEST_TYPE_HANDSHAKE,
        }, FALLBACK_HANDSHAKE_RESPONSE);

        if (handshakeResponse.error !== null) {
            throw new Error(handshakeResponse.error);
        }

        this.rumbleVersion = handshakeResponse.body.rumbleVersion;
        this.handshakeCompleted = true;
    }

    public dispose(): void {
        this.handshakeCompleted = false;

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

    public async sendRequest<RequestType extends WrapperRequestType>(
        requestPayload: RequestPayloadByType[RequestType],
        fallbackResponse: ResponseByType[RequestType],
    ): Promise<ResponseByType[RequestType]> {
        await this.ensureProcess();

        const id = this.nextRequestId;
        this.nextRequestId += 1;

        const request: WrapperDaemonRequest<RequestType> = {
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
                resolve: resolve as unknown as (response: AnyWrapperResponse) => void,
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
        let response: AnyWrapperResponse;
        try {
            response = JSON.parse(line) as AnyWrapperResponse;
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

    public getRumbleVersion(): string | null {
        return this.rumbleVersion;
    }
}

// Singleton instance of the wrapper client used across the language server.
export const wrapperClient = new RumbleWrapperClient();
