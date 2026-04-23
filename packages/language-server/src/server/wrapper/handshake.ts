import type { WrapperDaemonResponse } from "./protocol.js";

export const REQUEST_TYPE_HANDSHAKE = "handshake" as const;

export interface HandshakeRequestPayload {
    requestType: typeof REQUEST_TYPE_HANDSHAKE;
}

export interface HandshakeResponseBody {
    rumbleVersion: string;
}

export type HandshakeResponse = WrapperDaemonResponse<typeof REQUEST_TYPE_HANDSHAKE, HandshakeResponseBody>;

export const FALLBACK_HANDSHAKE_RESPONSE: HandshakeResponse = {
    id: -1,
    responseType: REQUEST_TYPE_HANDSHAKE,
    body: {
        rumbleVersion: "unknown",
    },
    error: "Wrapper handshake failed.",
};
