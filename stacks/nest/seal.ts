import {
  Console,
  Data,
  Effect,
  Layer,
  Match,
  Predicate,
  Result,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/http";

import * as Defs from "../../packages/lexicon/src/defs.ts";
import * as Send from "../../packages/lexicon/src/mailbox.send.ts";
import { lexString } from "../../packages/lexicon/src/runtime.ts";
import { Transport } from "../../packages/lexicon/src/transport.ts";
import { transportLayer } from "../../packages/mailbox-client/src/transport.ts";
import {
  loadSettings,
  Settings,
} from "../../packages/pi-ratking/src/config.ts";
import { directoryLayer } from "../../packages/pi-ratking/src/directory.ts";
import { reasonOf } from "../../packages/pi-ratking/src/errors.ts";
import {
  PayloadJson,
  SUMMARY_MAX,
} from "../../packages/pi-ratking/src/payload.ts";
import type { PayloadValue } from "../../packages/pi-ratking/src/payload.ts";
import { secretStoreLayer } from "../../packages/pi-ratking/src/secrets.ts";
import {
  leaseScriptIdentity,
  oneLine,
  prepareScript,
  readBody,
  refused,
  render,
  SendRequest,
  Verdicts,
} from "./send.ts";
import type { Verdict } from "./send.ts";

const MessageId = lexString({ format: "tid", type: "string" });

export const SealRequest = Schema.Struct({
  as: SendRequest.fields.as,
  body: Schema.String,
  replyTo: Schema.optionalKey(MessageId),
  summary: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(SUMMARY_MAX))
  ),
  thread: Schema.optionalKey(MessageId),
  to: SendRequest.fields.to,
});

export const EnvelopeJson = Schema.fromJsonString(
  Schema.toEncoded(Defs.EncryptedEnvelope)
);

export const Sealed = Schema.Struct({
  envelope: Schema.toEncoded(Defs.EncryptedEnvelope),
  messageId: MessageId,
  to: SendRequest.fields.to,
});

export const SealedJson = Schema.fromJsonString(Sealed);

export type SealedValue = typeof Sealed.Type;

const sealUsage =
  "seal --as <identity-secret> --to <name> --body <text | -> [--summary <line>] [--thread <id>] [--reply-to <id>]";

export const parseSeal = (argv: readonly string[]) => {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (value === undefined) {
      return Result.fail(`${flag ?? ""} needs a value. Usage: ${sealUsage}`);
    }

    if (
      flag !== undefined &&
      [
        "--as",
        "--to",
        "--body",
        "--summary",
        "--thread",
        "--reply-to",
      ].includes(flag) &&
      !values.has(flag)
    ) {
      values.set(flag, value);
    } else {
      return Result.fail(
        `Unknown or repeated flag ${flag}. Usage: ${sealUsage}`
      );
    }
  }

  const raw = {
    as: values.get("--as"),
    body: values.get("--body"),
    to: values.get("--to"),
  };

  if (values.has("--summary")) {
    Object.assign(raw, { summary: oneLine(values.get("--summary") ?? "") });
  }

  if (values.has("--thread")) {
    Object.assign(raw, { thread: values.get("--thread") });
  }

  if (values.has("--reply-to")) {
    Object.assign(raw, { replyTo: values.get("--reply-to") });
  }

  return Schema.decodeUnknownResult(SealRequest)(raw).pipe(
    Result.mapError(() => `Missing or invalid flag. Usage: ${sealUsage}`)
  );
};

export const scriptSeal = Effect.fn("Nest.scriptSeal")(function* scriptSeal(
  request: typeof SealRequest.Type
) {
  const { client, from, primary } = yield* prepareScript({
    ...request,
    cc: [],
  });

  let json: string | undefined;

  const encodeForId = (id: string) => {
    if (json === undefined) {
      const payload: PayloadValue = {
        body: request.body,
        cc: [],
        from,
        kind: request.replyTo === undefined ? "message" : "reply",
        thread: request.thread ?? id,
        to: primary.name,
      };

      if (request.summary !== undefined) {
        Object.assign(payload, { summary: request.summary });
      }

      if (request.replyTo !== undefined) {
        Object.assign(payload, { replyTo: request.replyTo });
      }

      json = Schema.encodeSync(PayloadJson)(payload);
    }

    return json;
  };

  const replyTo =
    request.replyTo === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(Schema.toType(Defs.MessageRef))({
          messageId: request.replyTo,
          senderDid: primary.did,
        });

  const envelope = yield* client.seal(
    primary.did,
    encodeForId,
    replyTo === undefined ? { encrypt: false } : { encrypt: false, replyTo }
  );

  return {
    envelope: yield* Schema.encodeEffect(Defs.EncryptedEnvelope)(envelope),
    messageId: envelope.aad.messageId,
    to: primary.name,
  };
});

class Conflict extends Data.TaggedClass("Conflict") {}

type SealedFailure =
  | Exclude<Verdict, { readonly _tag: "Delivered" }>
  | { readonly _tag: "Conflict" };

export const CONFLICT_STDERR =
  "NOT DELIVERED: Conflict (409). Different bytes under an admitted tid; terminal caller bug. Do not re-seal or retry this envelope.";

const renderFailure = (failure: SealedFailure) =>
  Match.value(failure).pipe(
    Match.tag("Conflict", () => ({ code: 5, stderr: CONFLICT_STDERR })),
    Match.tag("Uncertain", ({ reason, sent }) => ({
      code: 3,
      stderr: `${sent ? "UNCERTAIN" : "NOT SENT"}: ${oneLine(reason)}. Retry later with the same sealed JSON; replay is safe.`,
    })),
    Match.tag("Refused", render),
    Match.exhaustive
  );

export const scriptSendSealed = Effect.fn("Nest.scriptSendSealed")(
  function* scriptSendSealed(as: string, text: string) {
    const stdout: string[] = [];

    const result = yield* Effect.gen(function* submitJournal() {
      const envelope = yield* Schema.decodeEffect(EnvelopeJson)(text).pipe(
        Effect.mapError(() =>
          refused(
            "Usage",
            "Invalid sealed envelope JSON; pass only nest seal's envelope value"
          )
        )
      );

      const settings = yield* Settings;
      const identity = yield* leaseScriptIdentity(as);

      if (envelope.aad.senderDid !== identity.did) {
        return yield* Effect.fail(
          refused(
            "Unauthorized",
            "Sender identity does not match sealed senderDid"
          )
        );
      }

      if (envelope.aad.recipientDid === identity.did) {
        return yield* Effect.fail(
          refused("Self", "Cannot submit a sealed message to itself")
        );
      }

      return yield* Effect.gen(function* sendEnvelope() {
        const transport = yield* Transport;

        const response = yield* transport
          .request({
            input: { envelope },
            method: "POST",
            nsid: Send.Method.nsid,
            params: undefined,
          })
          .pipe(
            Effect.mapError((): SealedFailure =>
              Verdicts.Uncertain({
                reason: "Service-auth HTTP call failed",
                sent: true,
              })
            )
          );

        if (response.status === 409) {
          return yield* Effect.fail<SealedFailure>(new Conflict());
        }

        if (response.status >= 400 && response.status < 500) {
          const error = Schema.decodeUnknownResult(Send.ErrorBody)(
            response.body
          );

          const code = Result.isSuccess(error)
            ? error.success.error
            : "Rejected";

          const reason = Result.isSuccess(error)
            ? (error.success.message ?? "Mailbox refused admission")
            : "Mailbox refused admission";

          return yield* Effect.fail(
            refused(
              code === "AuthRequired" || code === "Forbidden"
                ? "Unauthorized"
                : code,
              reason
            )
          );
        }

        if (response.status !== 200 || response.kind !== "json") {
          return yield* Effect.fail<SealedFailure>(
            Verdicts.Uncertain({
              reason: "Admission not confirmed",
              sent: true,
            })
          );
        }

        const receipt = yield* Schema.decodeUnknownEffect(Send.Output)(
          response.body
        ).pipe(
          Effect.mapError(() =>
            Verdicts.Uncertain({
              reason: "Invalid admission receipt",
              sent: true,
            })
          )
        );

        stdout.push(
          JSON.stringify({
            id: receipt.receipt.message.messageId,
            seq: receipt.receipt.seq,
          })
        );

        return yield* Effect.void;
      }).pipe(
        Effect.provide(
          transportLayer(
            settings.endpoint,
            `${settings.serviceDid.replace(/#mailbox$/u, "")}#mailbox`,
            identity
          )
        )
      );
    }).pipe(
      Effect.scoped,
      Effect.match({
        onFailure: renderFailure,
        onSuccess: () => ({ code: 0, stderr: undefined }),
      }),
      Effect.catchDefect(() =>
        Effect.succeed(
          renderFailure(
            Verdicts.Uncertain({
              reason: "Unexpected failure while submitting sealed JSON",
              sent: true,
            })
          )
        )
      )
    );

    return { ...result, stdout };
  }
);

export const sealedSendFlags = (argv: readonly string[]) => {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (
      (flag !== "--as" && flag !== "--sealed") ||
      value === undefined ||
      values.has(flag)
    ) {
      return Result.fail(
        "Usage: send --as <identity-secret> --sealed - (no other flags)"
      );
    }

    values.set(flag, value);
  }

  return values.get("--sealed") === "-"
    ? Schema.decodeUnknownResult(SendRequest.fields.as)(
        values.get("--as")
      ).pipe(Result.mapError(() => "Missing or invalid --as"))
    : Result.fail("--sealed must be - (stdin)");
};

export const sealCommand = Effect.fn("Nest.sealCommand")(function* sealCommand(
  argv: readonly string[]
) {
  const shown = yield* Effect.gen(function* sealFromCli() {
    const parsed = parseSeal(argv);

    if (Result.isFailure(parsed)) {
      return yield* Effect.fail(refused("Usage", parsed.failure));
    }

    const body = yield* readBody(parsed.success.body);

    const settings = yield* loadSettings().pipe(
      Effect.mapError((error) => refused("NotConfigured", error.reason))
    );

    const journal = yield* scriptSeal({ ...parsed.success, body }).pipe(
      Effect.scoped,
      Effect.mapError((error) =>
        Predicate.isTagged(error, "Refused") ||
        Predicate.isTagged(error, "Uncertain")
          ? error
          : refused("NotAttempted", reasonOf(error))
      ),
      Effect.provide(
        Layer.mergeAll(directoryLayer, secretStoreLayer, FetchHttpClient.layer)
      ),
      Effect.provideService(Settings, settings)
    );

    return {
      code: 0,
      stderr: undefined,
      stdout: yield* Schema.encodeEffect(SealedJson)(journal).pipe(
        Effect.mapError(() =>
          refused("NotAttempted", "Could not encode sealed JSON")
        )
      ),
    };
  }).pipe(Effect.match({ onFailure: render, onSuccess: (value) => value }));

  if (shown.stdout !== undefined) {
    yield* Console.log(shown.stdout);
  }

  if (shown.stderr !== undefined) {
    yield* Console.error(shown.stderr);
  }

  yield* Effect.sync(() => {
    process.exitCode = shown.code;
  });
});

export const sealedSendCommand = Effect.fn("Nest.sealedSendCommand")(
  function* sealedSendCommand(argv: readonly string[]) {
    const shown = yield* Effect.gen(function* sendFromCli() {
      const parsed = sealedSendFlags(argv);

      if (Result.isFailure(parsed)) {
        return yield* Effect.fail(refused("Usage", parsed.failure));
      }

      const text = yield* readBody("-");

      const settings = yield* loadSettings().pipe(
        Effect.mapError((error) => refused("NotConfigured", error.reason))
      );

      return yield* scriptSendSealed(parsed.success, text).pipe(
        Effect.provide(Layer.mergeAll(secretStoreLayer, FetchHttpClient.layer)),
        Effect.provideService(Settings, settings)
      );
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ ...render(error), stdout: [] }),
        onSuccess: (value) => value,
      })
    );

    for (const line of shown.stdout) {
      yield* Console.log(line);
    }

    if (shown.stderr !== undefined) {
      yield* Console.error(shown.stderr);
    }

    yield* Effect.sync(() => {
      process.exitCode = shown.code;
    });
  }
);
