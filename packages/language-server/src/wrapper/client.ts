import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { createLogger } from "../utils/logger.js";
import { resolveWrapperLaunchConfig } from "./jar-resolution.js";
import { REQUEST_TYPE_HANDSHAKE } from "./handshake.js";
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
const logger = createLogger("wrapper:client");

interface PendingRequest {
    expectedResponseType: WrapperRequestType;
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

    public async connect(): Promise<void> {
        if (this.child !== undefined && this.handshakeCompleted) {
            return;
        }

        if (this.processReadyPromise !== undefined) {
            return await this.processReadyPromise;
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
            const launchConfig = await resolveWrapperLaunchConfig();
            logger.info(`Launching wrapper with args: ${launchConfig.args.join(" ")}`);

            this.child = spawn("java", launchConfig.args, {
                stdio: "pipe",
            });

            this.handshakeCompleted = false;
            this.child.stdout.setEncoding("utf8");
            this.child.stderr.setEncoding("utf8");
            this.child.stdout.on("data", (chunk: string) => {
                this.handleStdoutChunk(chunk);
            });
            this.child.stderr.on("data", (chunk: string) => {
                this.handleStderrChunk(chunk);
            });

            this.child.on("error", (error) => {
                logger.error("Wrapper process error:", error);
                this.rejectAllPending(error);
                this.child = undefined;
                this.stdoutBuffer = "";
                this.handshakeCompleted = false;
            });

            this.child.on("close", () => {
                logger.warn("Wrapper process closed.");
                this.rejectAllPending(new Error("Wrapper process closed."));
                this.child = undefined;
                this.stdoutBuffer = "";
                this.handshakeCompleted = false;
            });
        }

        try {
            const handshakeResponse = await this.sendRequestInternal<typeof REQUEST_TYPE_HANDSHAKE>({
                requestType: REQUEST_TYPE_HANDSHAKE,
            });

            this.rumbleVersion = handshakeResponse.body.rumbleVersion;
            this.handshakeCompleted = true;
            logger.info(`Handshake with wrapper successful. Response: ${JSON.stringify(handshakeResponse)}`);
        }
        catch (error) {
            logger.error("Handshake with wrapper failed:", error instanceof Error ? error : String(error));
            this.dispose();
            throw error instanceof Error ? error : new Error(String(error));
        }
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
        payload: RequestPayloadByType[RequestType]
    ): Promise<ResponseByType[RequestType]> {
        await this.connect();
        return this.sendRequestInternal(payload);
    }

    private async sendRequestInternal<RequestType extends WrapperRequestType>(
        payload: RequestPayloadByType[RequestType]
    ): Promise<ResponseByType[RequestType]> {
        const id = this.nextRequestId;
        this.nextRequestId += 1;

        const request: WrapperDaemonRequest<RequestType> = {
            id,
            ...payload,
        };
        const encodedRequest = JSON.stringify(request);
        const child = this.child;

        logger.debug(`Sending request to wrapper: ${encodedRequest}`);

        if (child === undefined) {
            throw new Error("Wrapper process is not available.");
        }

        return new Promise<ResponseByType[RequestType]>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error("Wrapper timed out."));
            }, 12_000);

            this.pending.set(id, {
                expectedResponseType: payload.requestType,
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
                logger.error("Failed to write to wrapper stdin:", error instanceof Error ? error : String(error));
                this.rejectPending(id, error instanceof Error ? error : new Error("Wrapper write failed."));
            }
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

    private handleStderrChunk(chunk: string): void {
        const lines = chunk
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        for (const line of lines) {
            logger.warn(`Wrapper stderr: ${line}`);
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

        logger.debug(`Received response from wrapper: ${JSON.stringify(response, null, 2)}`);

        if (response.responseType !== pendingRequest.expectedResponseType) {
            pendingRequest.reject(
                new Error(
                    `Wrapper returned responseType '${response.responseType}' for requestType '${pendingRequest.expectedResponseType}'.`,
                ),
            );
            return;
        }

        if (response.error !== null) {
            pendingRequest.reject(new Error(response.error));
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

let instance: RumbleWrapperClient | null = null;

export function getWrapperClient(): RumbleWrapperClient {
    if (instance === null) {
        instance = new RumbleWrapperClient();
    }
    return instance;
}
