import { Context, Effect, Layer, Schema } from "effect";
import { MailboxHandlers } from "./mailbox-handlers.js";
import type { Request, Response } from "./transport.js";
export interface Route {
    readonly nsid: string;
    readonly path: string;
    readonly method: "GET" | "POST";
    readonly handle: (request: Request) => Effect.Effect<Response, Schema.SchemaError>;
}
declare const MailboxServer_base: Context.ServiceClass<MailboxServer, "../lexicon/MailboxServer.js", {
    readonly routes: ReadonlyMap<string, Route>;
}>;
export declare class MailboxServer extends MailboxServer_base {
}
export declare const serverLayer: Layer.Layer<MailboxServer, never, MailboxHandlers>;
export {};
