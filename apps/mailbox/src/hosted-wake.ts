import * as Send from "@rat-king/lexicon/mailbox.send";
import type { XrpcFailure } from "@rat-king/lexicon/xrpc-failure";
import { Effect, Schema } from "effect";

import type { Bindings } from "./bindings.ts";
import { failure } from "./failure.ts";

const scheduleWake = (
  context: Pick<ExecutionContext, "waitUntil">,
  wake: Effect.Effect<void, XrpcFailure>
) => {
  context.waitUntil(Effect.runPromise(wake.pipe(Effect.ignore)));
};

export const wakeHosted = Effect.fn("Mailbox.wakeHosted")(function* wakeHosted(
  env: Bindings,
  recipient: string,
  body: string,
  context?: Pick<ExecutionContext, "waitUntil">
) {
  if (env.AGENT === undefined) {
    return yield* Effect.void;
  }

  const hosts = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(Schema.String))
  )(env.HOSTED_AGENTS ?? "[]");

  if (!hosts.includes(recipient)) {
    return yield* Effect.void;
  }

  const admitted = yield* Schema.decodeEffect(
    Schema.fromJsonString(Send.Output)
  )(body);

  if (admitted.receipt.delegatedTo !== undefined) {
    return yield* Effect.void;
  }

  const agents = env.AGENT;

  const wake = Effect.gen(function* wakeAgent() {
    const agent = agents.getByName(recipient);
    const mailbox = env.MAILBOX.getByName(recipient);

    const outcome = yield* Effect.tryPromise({
      catch: () => failure("MailboxUnavailable", 503),
      try: agent.wake.bind(agent),
    }).pipe(
      Effect.match({
        onFailure: () => "unavailable" as const,
        onSuccess: () => "accepted" as const,
      })
    );

    yield* Effect.tryPromise({
      catch: () => failure("MailboxUnavailable", 503),
      try: mailbox.recordWake.bind(
        mailbox,
        admitted.receipt.message.senderDid,
        admitted.receipt.message.messageId,
        outcome
      ),
    });
  });

  if (context === undefined) {
    yield* wake;
  } else {
    scheduleWake(context, wake);
  }

  return yield* Effect.void;
});
