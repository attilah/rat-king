import {
  Clock,
  DateTime,
  Console,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";
import { initialTransition, transition } from "xstate";

import { plaintextBody } from "../../packages/envelope/src/signed.ts";
/* oxlint-disable promise/prefer-await-to-callbacks -- Effect handlers are not Promise callbacks. */
import * as Defs from "../../packages/lexicon/src/defs.ts";
import type {
  Batch,
  OpenedMessage,
  RatKingMailbox,
} from "../../packages/mailbox-client/src/index.ts";
import {
  Identity,
  ownIdentity,
  prepare,
} from "../../packages/mailbox-client/src/index.ts";
import {
  loadSettings,
  Settings,
} from "../../packages/pi-ratking/src/config.ts";
import {
  Directory,
  directoryLayer,
} from "../../packages/pi-ratking/src/directory.ts";
import { nameFor } from "../../packages/pi-ratking/src/name.ts";
import {
  PayloadJson,
  RecordJson,
} from "../../packages/pi-ratking/src/payload.ts";
import {
  SecretStore,
  secretStoreLayer,
} from "../../packages/pi-ratking/src/secrets.ts";
import { DrainFailure } from "./drain-error.ts";
import { drainMachine } from "./drain-machine.ts";
import { executeBatch } from "./drain-process.ts";

export { DrainFailure } from "./drain-error.ts";

const failure = (code: 2 | 3 | 4, reason: string) =>
  new DrainFailure({ code, reason });

export const classify = (error: {
  readonly error?: string;
  readonly reason: string;
}) => {
  if (error.error === "LeaseHeld") {
    return failure(
      4,
      "Another reader owns this name. Stop that reader or retry after it releases; nothing was read."
    );
  }

  const code = [
    "Retired",
    "AuthRequired",
    "Forbidden",
    "InvalidRequest",
  ].includes(error.error ?? "")
    ? 2
    : 3;

  return failure(
    code,
    `${error.reason}. Retry transport failures; check identity and configuration for refusals.`
  );
};

export const DrainLine = Schema.Struct({
  $type: Schema.optionalKey(Schema.String),
  acceptedAt: Schema.optionalKey(Schema.String),
  body: Schema.String,
  cc: Schema.Array(Schema.String),
  did: Schema.String,
  from: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(["message", "reply", "data"]),
  messageId: Schema.String,
  replyTo: Schema.optionalKey(Schema.String),
  summary: Schema.String,
  thread: Schema.optionalKey(Schema.String),
  verified: Schema.Boolean,
});

export type Line = typeof DrainLine.Type;

interface OptionalLine {
  acceptedAt?: string;
  from?: string;
  replyTo?: string;
  thread?: string;
  $type?: string;
  kind: Line["kind"];
}

export const Request = Schema.Struct({
  as: Schema.String.check(
    Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u)
  ),
  exec: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  ids: Schema.Array(
    Schema.String.check(
      Schema.isPattern(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/u)
    )
  ),
  max: Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: 1 })),
  wait: Schema.Int.check(Schema.isBetween({ maximum: 86_400, minimum: 0 })),
});

export type RequestValue = typeof Request.Type;

const usage =
  "drain --as <identity-secret> [--max <n>] [--wait <seconds>] [--exec <cmd>] | ack --as <identity-secret> <messageId>…";

export const parseDrain = (mode: "drain" | "ack", argv: readonly string[]) => {
  const values = new Map<string, string>();
  const ids: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";

    if (mode === "ack" && !arg.startsWith("--")) {
      ids.push(arg);
      continue;
    }

    if (
      ![
        "--as",
        ...(mode === "drain" ? ["--max", "--wait", "--exec"] : []),
      ].includes(arg) ||
      values.has(arg) ||
      argv[i + 1] === undefined
    ) {
      return Result.fail(
        failure(
          2,
          `Unknown, repeated or incomplete flag ${arg}. Usage: ${usage}`
        )
      );
    }

    i += 1;
    values.set(arg, argv[i] ?? "");
  }

  if (mode === "ack" && ids.length === 0) {
    return Result.fail(
      failure(2, `Supply ids only after processing them. Usage: ${usage}`)
    );
  }

  const number = (flag: string, fallback: number) => {
    if (!values.has(flag)) {
      return fallback;
    }

    return /^\d+$/u.test(values.get(flag) ?? "")
      ? Number(values.get(flag))
      : Number.NaN;
  };

  const input = {
    as: values.get("--as"),
    ids,
    max: number("--max", 100),
    wait: number("--wait", 0),
  };

  if (values.has("--exec")) {
    Object.assign(input, { exec: values.get("--exec") });
  }

  return Schema.decodeUnknownResult(Request)(input).pipe(
    Result.mapError(() =>
      failure(2, `Invalid identity, id or bounds. Usage: ${usage}`)
    )
  );
};

export const unsettled = (events: Batch["events"]) => {
  const messages = new Map<string, Defs.MessageEventValue>();
  const states = new Map<string, string>();

  for (const event of events) {
    if (
      !Schema.is(Defs.MessageEvent)(event) &&
      !Schema.is(Defs.ReceiptEvent)(event)
    ) {
      continue;
    }

    const key = JSON.stringify([
      event.receipt.message.senderDid,
      event.receipt.message.messageId,
    ]);

    if (Schema.is(Defs.MessageEvent)(event)) {
      messages.set(key, event);
    }

    states.set(key, event.receipt.state);
  }

  const pending: Defs.MessageEventValue[] = [];

  for (const [key, event] of messages) {
    if (!["acked", "expired"].includes(states.get(key) ?? "")) {
      pending.push(event);
    }
  }

  return pending;
};

export const projectLine = (
  event: Defs.MessageEventValue,
  opened: Option.Option<OpenedMessage>,
  name: Option.Option<string>
): Effect.Effect<Line, DrainFailure> =>
  Effect.gen(function* project() {
    const acceptedAt = event.receipt.recordedAt;

    const body = Option.isSome(opened)
      ? opened.value.body
      : yield* plaintextBody(event.envelope).pipe(
          Effect.orElseSucceed(() => "")
        );

    const payload = Schema.decodeUnknownResult(PayloadJson)(body);
    const record = Schema.decodeUnknownResult(RecordJson)(body);
    const verified = Option.isSome(opened) && Option.isSome(name);

    const line: Line = {
      body: Result.isSuccess(payload) ? payload.success.body : body,
      cc: Result.isSuccess(payload) ? (payload.success.cc ?? []) : [],
      did: event.envelope.aad.senderDid,
      kind: "message",
      messageId: event.envelope.aad.messageId,
      summary: Result.isSuccess(payload) ? (payload.success.summary ?? "") : "",
      verified,
    };

    const optional: OptionalLine = { kind: "message" };

    if (Schema.is(Schema.String)(acceptedAt)) {
      optional.acceptedAt = acceptedAt;
    }

    if (verified && Option.isSome(name)) {
      optional.from = name.value;
    }

    if (Option.isSome(opened) && opened.value.replyTo !== undefined) {
      optional.replyTo = opened.value.replyTo.messageId;
    }

    if (Result.isSuccess(payload)) {
      if (payload.success.thread !== undefined) {
        optional.thread = payload.success.thread;
      }

      if (payload.success.kind === "reply") {
        optional.kind = "reply";
      }
    }

    if (Result.isSuccess(record)) {
      optional.$type = record.success.$type;
      optional.kind = "data";
    }

    return { ...line, ...optional };
  });

export interface DrainPorts {
  readonly mailbox: Pick<
    typeof RatKingMailbox.Service,
    "lease" | "poll" | "ack" | "deliver"
  >;
  readonly open: (
    event: Defs.MessageEventValue
  ) => Effect.Effect<Line, DrainFailure>;
  readonly print: (line: Line) => Effect.Effect<void, DrainFailure>;
  readonly exec: (
    command: string,
    lines: readonly Line[]
  ) => Effect.Effect<number, DrainFailure>;
}

export const runDrain = (
  mode: "drain" | "ack",
  request: RequestValue,
  did: string,
  ports: DrainPorts
) =>
  Effect.scoped(
    Effect.gen(function* drain() {
      const { mailbox } = ports;

      const expiry = Clock.currentTimeMillis.pipe(
        Effect.map((now) =>
          DateTime.formatIso(DateTime.makeUnsafe(now + 300_000))
        )
      );

      const lease = yield* Effect.acquireRelease(
        mailbox.lease
          .acquire({
            did,
            expiresAt: yield* expiry,
            harness: {
              $type: "sh.mschf.ratking.runtime.lease#pi",
              sessionId: "nest-drain",
            },
          })
          .pipe(Effect.mapError(classify)),
        (held) =>
          mailbox.lease
            .release({
              did,
              generation: held.generation,
              leaseId: held.leaseId,
            })
            .pipe(Effect.orDie)
      );

      const fence = {
        did,
        generation: lease.generation,
        leaseId: lease.leaseId,
      };

      const renew = Effect.gen(function* renewal() {
        while (true) {
          yield* Effect.sleep("60 seconds");
          yield* mailbox.lease
            .renew({ ...fence, expiresAt: yield* expiry })
            .pipe(Effect.mapError(classify));
        }
      });

      const work = Effect.gen(function* batch() {
        let [state] = initialTransition(drainMachine);

        const step = (type: string) => {
          [state] = transition(drainMachine, state, { type });
        };

        const deadline =
          (yield* Clock.currentTimeMillis) +
          (mode === "drain" ? request.wait : 0) * 1000;

        let { events } = yield* mailbox.poll(0).pipe(Effect.mapError(classify));
        let pending = unsettled(events);

        while (
          pending.length === 0 &&
          (yield* Clock.currentTimeMillis) < deadline
        ) {
          yield* Effect.sleep(
            Math.min(
              1000,
              Math.max(1, deadline - (yield* Clock.currentTimeMillis))
            )
          );
          ({ events } = yield* mailbox.poll(0).pipe(Effect.mapError(classify)));
          pending = unsettled(events);
        }

        const ack = (event: Defs.MessageEventValue) =>
          Effect.suspend(() => {
            if (!state.matches("acking")) {
              return Effect.fail(
                failure(
                  2,
                  "Ack requires completed processing. Drain and process before acknowledging."
                )
              );
            }

            return mailbox
              .ack({ ...fence, message: event.receipt.message })
              .pipe(Effect.mapError(classify));
          });

        if (mode === "ack") {
          const known = events.filter((event) =>
            Schema.is(Defs.MessageEvent)(event)
          );

          for (const id of new Set(request.ids)) {
            const event = known.find(
              (candidate) => candidate.envelope.aad.messageId === id
            );

            if (event === undefined) {
              return yield* failure(
                2,
                `Unknown message id ${id}. Drain this identity and use its messageId; no further ids were acked.`
              );
            }
          }

          const selected = pending.filter((event) =>
            request.ids.includes(event.envelope.aad.messageId)
          );

          // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach takes an effectful callback, not an Array thisArg.
          const lines = yield* Effect.forEach(selected, (event) =>
            ports.open(event)
          );

          step("ACK");

          for (const event of selected) {
            yield* ack(event);
          }

          step("DONE");

          return {
            code: 0,
            drained: selected.length,
            unverified: lines.filter((line) => !line.verified).length,
          };
        }

        const selected = pending.slice(0, request.max);
        const lines: Line[] = [];

        for (const event of selected) {
          const delivered = yield* mailbox
            .deliver({ ...fence, message: event.receipt.message })
            .pipe(Effect.mapError(classify));

          if (["acked", "expired"].includes(delivered.receipt.state)) {
            continue;
          }

          const line = yield* ports.open(event);

          if (request.exec === undefined) {
            yield* ports.print(line);
          }

          lines.push(line);
        }

        step("PRINTED");

        let code = 0;

        if (request.exec !== undefined && lines.length > 0) {
          step("EXEC");
          code = yield* ports.exec(request.exec, lines);
          step(code === 0 ? "SUCCESS" : "FAILURE");

          if (code === 0) {
            for (const event of selected.filter((candidate) =>
              lines.some(
                (line) => line.messageId === candidate.envelope.aad.messageId
              )
            )) {
              yield* ack(event);
            }
          }
        }

        step("DONE");

        return {
          code,
          drained: lines.length,
          unverified: lines.filter((line) => !line.verified).length,
        };
      });

      return yield* Effect.raceFirst(work, renew);
    })
  );

export const scriptDrain = (mode: "drain" | "ack", request: RequestValue) =>
  Effect.gen(function* script() {
    const settings = yield* Settings;
    const store = yield* SecretStore;
    const directory = yield* Directory;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const secret = yield* store
      .lease(request.as)
      .pipe(
        Effect.mapError(() =>
          failure(
            2,
            `Cannot lease ${request.as}. Provision the script identity in the secret store first.`
          )
        )
      );

    const identity = yield* Schema.decodeEffect(
      Schema.fromJsonString(Identity)
    )(Redacted.value(secret)).pipe(
      Effect.mapError(() =>
        failure(
          2,
          "Identity secret is invalid. Provision a Rat King script identity."
        )
      )
    );

    if (
      Option.isNone(
        nameFor(settings.didTemplate, settings.reserved, identity.did)
      )
    ) {
      return yield* failure(
        2,
        "Identity DID maps to no name. Check this host's DID template before retrying."
      );
    }

    const own = yield* ownIdentity(identity).pipe(Effect.mapError(classify));

    const client = yield* prepare({
      endpoint: settings.endpoint,
      own,
      peers: yield* directory.documents,
      serviceDid: settings.serviceDid,
    }).pipe(Effect.mapError(classify));

    return yield* runDrain(mode, request, identity.did, {
      exec: (command, lines) => executeBatch(spawner, command, lines),
      mailbox: client.mailbox,
      open: (event) =>
        Effect.gen(function* open() {
          yield* client
            .refresh(event.envelope.aad.senderDid)
            .pipe(Effect.mapError(classify));
          const opened = yield* client.open(event.envelope).pipe(Effect.option);
          const known = yield* directory.nameOf(event.envelope.aad.senderDid);

          const name = Option.orElse(known, () =>
            nameFor(
              settings.didTemplate,
              settings.reserved,
              event.envelope.aad.senderDid
            )
          );

          return yield* projectLine(event, opened, name);
        }),
      print: (line) => Console.log(JSON.stringify(line)),
    });
  });

export const drainCommand = (mode: "drain" | "ack", argv: readonly string[]) =>
  Effect.gen(function* command() {
    const outcome = yield* Effect.gen(function* run() {
      const parsed = parseDrain(mode, argv);

      if (Result.isFailure(parsed)) {
        return yield* parsed.failure;
      }

      const settings = yield* loadSettings().pipe(
        Effect.mapError(() =>
          failure(
            2,
            "Pi settings missing or invalid. Configure pi-ratking on this host first."
          )
        )
      );

      return yield* scriptDrain(mode, parsed.success).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            directoryLayer,
            secretStoreLayer,
            FetchHttpClient.layer
          )
        ),
        Effect.provideService(Settings, settings)
      );
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ code: error.code, error: error.reason }),
        onSuccess: (counts) => ({ ...counts, error: undefined }),
      }),
      Effect.catchDefect(() =>
        Effect.succeed({
          code: 3,
          error:
            "Drain or lease release was not confirmed. Retry; dedupe by messageId. No durable cursor is advanced.",
        })
      )
    );

    if (outcome.error !== undefined) {
      yield* Console.error(outcome.error);
    } else if ("drained" in outcome) {
      yield* Console.error(
        JSON.stringify({
          drained: outcome.drained,
          unverified: outcome.unverified,
        })
      );
    }

    yield* Effect.sync(() => {
      process.exitCode = outcome.code;
    });
  });
