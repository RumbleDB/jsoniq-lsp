import type { BuiltinFunctionsRequestPayload, REQUEST_TYPE_BUILTIN_FUNCTIONS } from "./builtin-functions.js";
import type { InferTypesRequestPayload, REQUEST_TYPE_INFER_TYPES } from "./type-inference.js";

export interface WrapperRequestPayloadByType {
    [REQUEST_TYPE_INFER_TYPES]: InferTypesRequestPayload;
    [REQUEST_TYPE_BUILTIN_FUNCTIONS]: BuiltinFunctionsRequestPayload;
}

export type WrapperRequestType = keyof WrapperRequestPayloadByType;

export type RequestPayloadByType = {
    [RequestType in WrapperRequestType]: WrapperRequestPayloadByType[RequestType];
};

export type WrapperRequestPayload<RequestType extends WrapperRequestType = WrapperRequestType> =
    WrapperRequestPayloadByType[RequestType];

export type WrapperDaemonRequest<RequestType extends WrapperRequestType = WrapperRequestType> =
    { id: number } & WrapperRequestPayloadByType[RequestType];

export type WrapperDaemonResponse<
    ResponseType extends WrapperRequestType,
    ResponseBody,
> = {
    id: number;
    responseType: ResponseType;
    body: ResponseBody;
    error: string | null;
};
