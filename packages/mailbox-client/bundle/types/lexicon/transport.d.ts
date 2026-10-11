import { Context } from "effect";
import type { Effect } from "effect";
import type * as Runtime from "./runtime.js";
import type { TransportFailure } from "./transport-failure.js";
export interface Request {
    readonly nsid: string;
    readonly method: "GET" | "POST";
    readonly params: Runtime.LexJsonMap | undefined;
    readonly input: Runtime.LexJson | undefined;
}
export type Response = {
    readonly kind: "json";
    readonly status: number;
    readonly body: Runtime.LexJson;
} | {
    readonly kind: "text";
    readonly status: number;
    readonly body: string;
};
declare const Transport_base: Context.ServiceClass<Transport, "../lexicon/Transport.js", {
    readonly request: (request: Request) => Effect.Effect<Response, TransportFailure>;
}>;
export declare class Transport extends Transport_base {
}
export {};
