import { Context, Effect, Layer, Schema } from "effect";
import * as PutDidDocument from "./admin.putDidDocument.js";
import * as GetPreferences from "./attention.getPreferences.js";
import * as GetStatus from "./attention.getStatus.js";
import * as PutPreferences from "./attention.putPreferences.js";
import * as PutStatus from "./attention.putStatus.js";
import * as Ack from "./mailbox.ack.js";
import * as Deliver from "./mailbox.deliver.js";
import * as List from "./mailbox.list.js";
import * as Send from "./mailbox.send.js";
import * as AcquireLease from "./runtime.acquireLease.js";
import * as ReleaseLease from "./runtime.releaseLease.js";
import * as RenewLease from "./runtime.renewLease.js";
import * as ResolveLease from "./runtime.resolveLease.js";
import type { TransportFailure } from "./transport-failure.js";
import { Transport } from "./transport.js";
import { XrpcFailure } from "./xrpc-failure.js";
export interface MailboxInterface {
    readonly getPreferences: (params: GetPreferences.ParamsValue) => Effect.Effect<GetPreferences.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly getStatus: (params: GetStatus.ParamsValue) => Effect.Effect<GetStatus.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly putPreferences: (input: PutPreferences.InputValue) => Effect.Effect<PutPreferences.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly putStatus: (input: PutStatus.InputValue) => Effect.Effect<PutStatus.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly acquireLease: (input: AcquireLease.InputValue) => Effect.Effect<AcquireLease.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly renewLease: (input: RenewLease.InputValue) => Effect.Effect<RenewLease.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly releaseLease: (input: ReleaseLease.InputValue) => Effect.Effect<ReleaseLease.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly resolveLease: (params: ResolveLease.ParamsValue) => Effect.Effect<ResolveLease.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly deliver: (input: Deliver.InputValue) => Effect.Effect<Deliver.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly putDidDocument: (input: PutDidDocument.InputValue) => Effect.Effect<PutDidDocument.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly send: (input: Send.InputValue) => Effect.Effect<Send.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly ack: (input: Ack.InputValue) => Effect.Effect<Ack.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
    readonly list: (params: List.ParamsValue) => Effect.Effect<List.OutputValue, Schema.SchemaError | XrpcFailure | TransportFailure>;
}
declare const MailboxClient_base: Context.ServiceClass<MailboxClient, "../lexicon/MailboxClient.js", MailboxInterface>;
export declare class MailboxClient extends MailboxClient_base {
}
export declare const clientLayer: Layer.Layer<MailboxClient, never, Transport>;
export {};
