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

import { plaintext } from "../../packages/envelope/src/canonical.ts";
import * as Defs from "../../packages/lexicon/src/defs.ts";
import { lexString } from "../../packages/lexicon/src/runtime.ts";
import {
  ownIdentity,
  prepare,
  PreparedMailbox,
  seal,
  sendSealed,
  SendOutcomes,
  SUMMARY_MAX,
} from "../../packages/mailbox-client/src/index.ts";
import {
  loadSettings,
  Settings,
} from "../../packages/pi-ratking/src/config.ts";
import { directoryLayer } from "../../packages/pi-ratking/src/directory.ts";
import { reasonOf } from "../../packages/pi-ratking/src/errors.ts";
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
  encrypt: Schema.optionalKey(Schema.Boolean),
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
  "seal --as <identity-secret> --to <name> --body <text | -> [--summary <line>] [--thread <id>] [--reply-to <id>] [--encrypt]";

export const parseSeal = (argv: readonly string[]) => {
  const values = new Map<string, string>();
  let encrypt = false;

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];

    if (flag === "--encrypt" && !encrypt) {
      encrypt = true;
      index -= 1;
      continue;
    }

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

  if (encrypt) {
    Object.assign(raw, { encrypt: true });
  }

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
  const { client, primary } = yield* prepareScript({
    ...request,
    cc: [],
  });

  if (
    request.encrypt === true &&
    !primary.document.keyAgreement.includes(`${primary.did}#encryption`)
  ) {
    return yield* Effect.fail(
      refused(
        "NoAgreementKey",
        "Encrypted send requires a recipient agreement key"
      )
    );
  }

  const replyTo =
    request.replyTo === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(Schema.toType(Defs.MessageRef))({
          messageId: request.replyTo,
          senderDid: primary.did,
        });

  const options = { encrypt: request.encrypt === true };

  if (replyTo !== undefined) {
    Object.assign(options, { replyTo });
  }

  if (request.summary !== undefined) {
    Object.assign(options, { summary: request.summary });
  }

  if (request.thread !== undefined) {
    Object.assign(options, { thread: request.thread });
  }

  const { envelope, messageId } = yield* seal(
    primary.did,
    request.body,
    options
  ).pipe(Effect.provideService(PreparedMailbox, client));

  return {
    envelope: yield* Schema.encodeEffect(Defs.EncryptedEnvelope)(envelope),
    messageId,
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
  function* scriptSendSealed(
    as: string,
    text: string,
    requireEncrypted?: boolean
  ) {
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

      if (requireEncrypted === true && plaintext(envelope)) {
        return yield* Effect.fail(
          refused(
            "EncryptionRequired",
            "--encrypt refuses a plaintext sealed envelope"
          )
        );
      }

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

      const client = yield* prepare({
        endpoint: settings.endpoint,
        own: yield* ownIdentity(identity).pipe(
          Effect.mapError((error) => refused("NoIdentity", error.reason))
        ),
        peers: [],
        serviceDid: settings.serviceDid,
      }).pipe(Effect.mapError((error) => refused("NoIdentity", error.reason)));

      const decoded = yield* Schema.decodeEffect(Defs.EncryptedEnvelope)(
        envelope
      ).pipe(
        Effect.mapError(() => refused("Usage", "Invalid sealed envelope"))
      );

      const outcome = yield* sendSealed(decoded).pipe(
        Effect.provideService(PreparedMailbox, client)
      );

      return yield* SendOutcomes.$match(outcome, {
        Accepted: ({ receipt }) =>
          Effect.sync(() => {
            stdout.push(
              JSON.stringify({
                id: receipt.message.messageId,
                seq: receipt.seq,
              })
            );
          }),
        NotAttempted: ({ reason }) =>
          Effect.fail(refused("NotAttempted", reason)),
        Rejected: ({ error }) =>
          Effect.fail<SealedFailure>(
            error.status === 409
              ? new Conflict()
              : refused(
                  error.error === "AuthRequired" || error.error === "Forbidden"
                    ? "Unauthorized"
                    : (error.error ?? "Rejected"),
                  error.reason
                )
          ),
        Uncertain: ({ error }) =>
          Effect.fail<SealedFailure>(
            Verdicts.Uncertain({ reason: error.reason, sent: true })
          ),
      });
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
  const flags = argv.filter((flag) => flag !== "--encrypt");

  if (argv.filter((flag) => flag === "--encrypt").length > 1) {
    return Result.fail("Repeated --encrypt");
  }

  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    const value = flags[index + 1];

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

      return yield* scriptSendSealed(
        parsed.success,
        text,
        argv.includes("--encrypt")
      ).pipe(
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
