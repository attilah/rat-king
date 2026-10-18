import type * as Status from "@rat-king/lexicon/attention.status";
import type { XrpcFailure } from "@rat-king/lexicon/xrpc-failure";
import { Context } from "effect";
import type { Effect, Option } from "effect";

export class AttentionDirectory extends Context.Service<
  AttentionDirectory,
  {
    readonly resolve: (
      name: string
    ) => Effect.Effect<Option.Option<string>, XrpcFailure>;
    readonly status: (
      did: string
    ) => Effect.Effect<Status.MainValue, XrpcFailure>;
  }
>()("mailbox/AttentionDirectory") {}

export const delegates = (status: Status.MainValue, now: number) =>
  (status.state === "busy" || status.state === "dnd") &&
  (status.until === undefined || Date.parse(status.until) > now);
