import { Context } from "effect";
import type { Effect } from "effect";
import type * as PutDidDocument from "./admin.putDidDocument.js";
import type * as GetPreferences from "./attention.getPreferences.js";
import type * as GetStatus from "./attention.getStatus.js";
import type * as PutPreferences from "./attention.putPreferences.js";
import type * as PutStatus from "./attention.putStatus.js";
import type * as Ack from "./mailbox.ack.js";
import type * as Deliver from "./mailbox.deliver.js";
import type * as List from "./mailbox.list.js";
import type * as Send from "./mailbox.send.js";
import type * as AcquireLease from "./runtime.acquireLease.js";
import type * as ReleaseLease from "./runtime.releaseLease.js";
import type * as RenewLease from "./runtime.renewLease.js";
import type * as ResolveLease from "./runtime.resolveLease.js";
import type { XrpcFailure } from "./xrpc-failure.js";
export interface HandlerInterface {
    readonly getPreferences: (params: GetPreferences.ParamsValue) => Effect.Effect<GetPreferences.OutputValue, XrpcFailure>;
    readonly getStatus: (params: GetStatus.ParamsValue) => Effect.Effect<GetStatus.OutputValue, XrpcFailure>;
    readonly putPreferences: (input: PutPreferences.InputValue) => Effect.Effect<PutPreferences.OutputValue, XrpcFailure>;
    readonly putStatus: (input: PutStatus.InputValue) => Effect.Effect<PutStatus.OutputValue, XrpcFailure>;
    readonly acquireLease: (input: AcquireLease.InputValue) => Effect.Effect<AcquireLease.OutputValue, XrpcFailure>;
    readonly renewLease: (input: RenewLease.InputValue) => Effect.Effect<RenewLease.OutputValue, XrpcFailure>;
    readonly releaseLease: (input: ReleaseLease.InputValue) => Effect.Effect<ReleaseLease.OutputValue, XrpcFailure>;
    readonly resolveLease: (params: ResolveLease.ParamsValue) => Effect.Effect<ResolveLease.OutputValue, XrpcFailure>;
    readonly deliver: (input: Deliver.InputValue) => Effect.Effect<Deliver.OutputValue, XrpcFailure>;
    readonly putDidDocument: (input: PutDidDocument.InputValue) => Effect.Effect<PutDidDocument.OutputValue, XrpcFailure>;
    readonly send: (input: Send.InputValue) => Effect.Effect<Send.OutputValue, XrpcFailure>;
    readonly ack: (input: Ack.InputValue) => Effect.Effect<Ack.OutputValue, XrpcFailure>;
    readonly list: (params: List.ParamsValue) => Effect.Effect<List.OutputValue, XrpcFailure>;
}
declare const MailboxHandlers_base: Context.ServiceClass<MailboxHandlers, "../lexicon/MailboxHandlers.js", HandlerInterface>;
export declare class MailboxHandlers extends MailboxHandlers_base {
}
export {};
