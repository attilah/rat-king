/* oxlint-disable promise/prefer-await-to-callbacks -- Effect error mapping and fallback lookups are not Promise callbacks. */
import {
  Console,
  Context,
  Data,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Predicate,
  Redacted,
  Result,
  Schema,
  Stdio,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";

import {
  Identity,
  ownIdentity,
  prepare,
  readerCannotRender,
  recordType,
  SendOutcomes,
} from "../../packages/mailbox-client/src/index.ts";
import type { SendOutcome } from "../../packages/mailbox-client/src/index.ts";
import {
  recordSummary,
  validateRecord,
} from "../../packages/pi-ratking/src/agentgraph.ts";
import {
  loadSettings,
  Settings,
} from "../../packages/pi-ratking/src/config.ts";
import {
  Directory,
  directoryLayer,
} from "../../packages/pi-ratking/src/directory.ts";
import type { Resolved } from "../../packages/pi-ratking/src/directory.ts";
import { reasonOf } from "../../packages/pi-ratking/src/errors.ts";
import {
  AgentName,
  canonicalName,
  didFor,
  nameFor,
} from "../../packages/pi-ratking/src/name.ts";
import {
  PayloadJson,
  SUMMARY_MAX,
} from "../../packages/pi-ratking/src/payload.ts";
import type { PayloadValue } from "../../packages/pi-ratking/src/payload.ts";
import {
  SecretStore,
  secretStoreLayer,
} from "../../packages/pi-ratking/src/secrets.ts";

export const SEND_TRIES = 10;

export const SendBackoff = Context.Reference<
  (count: number) => Duration.Duration
>("Nest.SendBackoff", {
  defaultValue: () => (count) =>
    Duration.seconds(Math.min(2 ** (count - 1), 15)),
});

export type Verdict = Data.TaggedEnum<{
  Delivered: {
    readonly id: string;
    readonly seq: number;
    readonly to: string;
  };
  Refused: { readonly code: string; readonly reason: string };
  Uncertain: { readonly reason: string; readonly sent: boolean };
}>;

export const Verdicts = Data.taggedEnum<Verdict>();

export const SendRequest = Schema.Struct({
  as: Schema.String.check(
    Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/u)
  ),
  body: Schema.String,
  cc: Schema.Array(AgentName),
  encrypt: Schema.optionalKey(Schema.Boolean),
  kind: Schema.optionalKey(Schema.Literal("data")),
  record: Schema.optionalKey(Schema.String),
  summary: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SUMMARY_MAX)
  ),
  to: AgentName,
  type: Schema.optionalKey(Schema.String),
});

export type SendRequestValue = typeof SendRequest.Type;

const isVerdict = (value: unknown): value is Verdict =>
  Predicate.isTagged(value, "Refused") ||
  Predicate.isTagged(value, "Uncertain") ||
  Predicate.isTagged(value, "Delivered");

const settle = (verdict: Verdict) => verdict;

export const refused = (
  code: string,
  reason: string
): Extract<Verdict, { readonly _tag: "Refused" }> =>
  Verdicts.Refused({ code, reason });

export const oneLine = (text: string) =>
  text.replaceAll(/\s+/gu, " ").trim().slice(0, 240);

export const render = (verdict: Verdict) =>
  Verdicts.$match(verdict, {
    Delivered: ({ id, seq, to }) => ({
      code: 0,
      stderr: undefined,
      stdout: JSON.stringify({ id, seq, to }),
    }),
    Refused: ({ code, reason }) => ({
      code: 2,
      stderr:
        code === "InvalidRecord" || code === "ReaderCannotRender"
          ? `NOT SENT: ${code}. ${reason}`
          : `NOT DELIVERED: ${code}. ${oneLine(reason)}`,
      stdout: undefined,
    }),
    Uncertain: ({ reason, sent }) => ({
      code: 3,
      stderr: sent
        ? `UNCERTAIN: ${oneLine(reason)}. The message may have landed; a resend can duplicate it.`
        : `NOT SENT: ${oneLine(reason)}. Nothing reached a mailbox; a retry is safe.`,
      stdout: undefined,
    }),
  });

const usage =
  "send --as <identity-secret> --to <name> [--cc <name>]... [--summary <line>] (--body <text | -> | --record <file.json> --type <nsid>) [--encrypt]";

export const parseSend = (
  argv: readonly string[]
): Result.Result<SendRequestValue, string> => {
  const values = new Map<string, string>();
  const cc: string[] = [];

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
      return Result.fail(`${flag ?? ""} needs a value. Usage: ${usage}`);
    }

    if (flag === "--cc") {
      cc.push(value);
    } else if (
      flag !== undefined &&
      ["--as", "--to", "--summary", "--body", "--record", "--type"].includes(
        flag
      ) &&
      !values.has(flag)
    ) {
      values.set(flag, value);
    } else {
      return Result.fail(`Unknown or repeated flag ${flag}. Usage: ${usage}`);
    }
  }

  if (
    values.has("--body") === values.has("--record") ||
    values.has("--record") !== values.has("--type")
  ) {
    return Result.fail(
      `Supply exactly one of --body or --record; --record requires --type. Usage: ${usage}`
    );
  }

  const input = {
    as: values.get("--as"),
    body: values.get("--body") ?? "",
    cc,
    summary: oneLine(
      values.get("--summary") ?? (values.has("--record") ? "record" : "")
    ),
    to: values.get("--to"),
  };

  if (encrypt) {
    Object.assign(input, { encrypt: true });
  }

  if (values.has("--record")) {
    Object.assign(input, {
      record: values.get("--record"),
      type: values.get("--type"),
    });
  }

  return Schema.decodeUnknownResult(SendRequest)(input).pipe(
    Result.mapError(
      () =>
        `Missing or invalid flag (names are project/row, summary 1-${SUMMARY_MAX} chars). Usage: ${usage}`
    )
  );
};

const rejection = (error: {
  readonly error?: string;
  readonly reason: string;
  readonly status?: number;
}): Verdict => {
  if (error.error === "Retired") {
    return refused("Retired", error.reason);
  }

  const detail = `${error.error ?? "Rejected"} (${error.status ?? "4xx"}): ${error.reason}`;

  return error.error === "AuthRequired" || error.error === "Forbidden"
    ? refused("Unauthorized", detail)
    : refused(error.error ?? "Rejected", detail);
};

const verdictOf = (outcome: SendOutcome): Option.Option<Verdict> =>
  SendOutcomes.$match(outcome, {
    Accepted: () => Option.none(),
    NotAttempted: ({ reason }) => Option.some(refused("NotAttempted", reason)),
    Rejected: ({ error }) => Option.some(rejection(error)),
    Uncertain: ({ error }) =>
      Option.some(
        Verdicts.Uncertain({
          reason: `Admission not confirmed after ${SEND_TRIES} tries: ${error.reason}`,
          sent: true,
        })
      ),
  });

const partial = (accepted: readonly string[], verdict: Verdict): Verdict =>
  accepted.length === 0
    ? verdict
    : Verdicts.$match(verdict, {
        Delivered: () => verdict,
        Refused: ({ code, reason }) =>
          refused(
            "Partial",
            `Accepted by ${accepted.join(", ")}; then ${code}: ${reason}. Do not resend to accepted recipients`
          ),
        Uncertain: ({ reason }) =>
          Verdicts.Uncertain({
            reason: `Accepted by ${accepted.join(", ")}; then ${reason}`,
            sent: true,
          }),
      });

export const leaseScriptIdentity = Effect.fn("Nest.leaseScriptIdentity")(
  function* leaseScriptIdentity(as: string) {
    const store = yield* SecretStore;

    const secret = yield* store
      .lease(as)
      .pipe(Effect.mapError((error) => refused("NoIdentity", error.reason)));

    const identity = yield* Schema.decodeEffect(
      Schema.fromJsonString(Identity)
    )(Redacted.value(secret)).pipe(
      Effect.mapError(() =>
        refused("NoIdentity", `Secret ${as} is not a Rat King identity`)
      )
    );

    return identity;
  }
);

export const prepareScript = Effect.fn("Nest.prepareScript")(
  function* prepareScript(request: Pick<SendRequestValue, "as" | "to" | "cc">) {
    const settings = yield* Settings;
    const directory = yield* Directory;
    const identity = yield* leaseScriptIdentity(request.as);

    const from = yield* Effect.fromOption(
      nameFor(settings.didTemplate, settings.reserved, identity.did)
    ).pipe(
      Effect.mapError(() =>
        refused(
          "NoIdentity",
          `${identity.did} maps to no Rat King name under this host's DID template`
        )
      )
    );

    const own = yield* ownIdentity(identity).pipe(
      Effect.mapError((error) => refused("NoIdentity", error.reason))
    );

    const lookup = (name: string) =>
      Effect.gen(function* lookupName() {
        const did = didFor(settings.didTemplate, settings.reserved, name);

        const client = yield* prepare({
          endpoint: settings.endpoint,
          own,
          peers: [],
          serviceDid: settings.serviceDid,
        });

        const document = yield* client.refresh(did);

        yield* directory.record(name, document).pipe(Effect.ignore);

        return { did, document, name };
      }).pipe(
        Effect.scoped,
        Effect.mapError((error) =>
          "status" in error &&
          error.status !== undefined &&
          error.status >= 400 &&
          error.status < 500
            ? refused(
                "UnknownName",
                `${name}: no Rat King identity has this name`
              )
            : Verdicts.Uncertain({
                reason: `Name lookup for ${name} failed: ${reasonOf(error)}`,
                sent: false,
              })
        )
      );

    const names = [
      ...new Set(
        [request.to, ...request.cc].map((name) =>
          canonicalName(settings.reserved, name)
        )
      ),
    ];

    if (names[0] === from) {
      return yield* Effect.fail(
        refused("Self", `${from} cannot message itself`)
      );
    }

    const targets: Resolved[] = [];

    for (const name of names) {
      const target = yield* directory
        .resolve(name)
        .pipe(Effect.catchTag("UnknownName", () => lookup(name)));

      if (target.did === identity.did) {
        if (name === names[0]) {
          return yield* Effect.fail(
            refused("Self", `${from} cannot message itself`)
          );
        }
      } else if (!targets.some((known) => known.did === target.did)) {
        targets.push(target);
      }
    }

    const [primary] = targets;

    if (primary === undefined) {
      return yield* Effect.fail(refused("NotAttempted", "No recipient"));
    }

    const client = yield* prepare({
      endpoint: settings.endpoint,
      own,
      peers: targets.map((target) => target.document),
      serviceDid: settings.serviceDid,
    });

    return { client, from, primary, targets };
  }
);

export const scriptSend = Effect.fn("Nest.scriptSend")(
  function* scriptSend(request: SendRequestValue) {
    const accepted: string[] = [];

    return yield* Effect.gen(function* sealAndSend() {
      const { client, from, primary, targets } = yield* prepareScript(request);

      if (request.kind === "data") {
        const type = recordType(request.body);

        for (const target of targets) {
          const presence = yield* client.presence(target.did).pipe(
            Effect.timeoutOption("2 seconds"),
            Effect.orElseSucceed(() => Option.none())
          );

          const cannot = readerCannotRender(
            target.name,
            type,
            Option.getOrUndefined(presence)
          );

          if (cannot !== undefined) {
            return yield* Effect.fail(
              refused(
                "ReaderCannotRender",
                cannot.replace("NOT SENT: ReaderCannotRender. ", "")
              )
            );
          }
        }
      }

      if (
        request.encrypt === true &&
        targets.some(
          (target) =>
            !target.document.keyAgreement.includes(`${target.did}#encryption`)
        )
      ) {
        return yield* Effect.fail(
          refused(
            "NoAgreementKey",
            "Encrypted send requires a recipient agreement key"
          )
        );
      }

      let json: string | undefined;

      const encodeForId = (id: string) => {
        if (json === undefined) {
          const payload: PayloadValue = {
            body: request.body,
            cc: targets.slice(1).map((target) => target.name),
            from,
            kind: request.kind ?? "message",
            summary: request.summary,
            thread: id,
            to: primary.name,
          };

          json = Schema.encodeSync(PayloadJson)(payload);
        }

        return json;
      };

      const envelopes = [];

      for (const target of targets) {
        envelopes.push(
          yield* client.seal(target.did, encodeForId, {
            encrypt: request.encrypt === true,
          })
        );
      }

      const backoff = yield* SendBackoff;
      let receipt: { readonly id: string; readonly seq: number } | undefined;

      for (const [index, envelope] of envelopes.entries()) {
        const target = targets[index] ?? primary;

        const attempt = (count: number): Effect.Effect<SendOutcome> =>
          client
            .send(envelope)
            .pipe(
              Effect.flatMap((outcome) =>
                SendOutcomes.$is("Uncertain")(outcome) && count < SEND_TRIES
                  ? Effect.sleep(backoff(count)).pipe(
                      Effect.andThen(attempt(count + 1))
                    )
                  : Effect.succeed(outcome)
              )
            );

        const outcome = yield* attempt(1);
        const failed = verdictOf(outcome);

        if (Option.isSome(failed)) {
          return yield* Effect.fail(partial(accepted, failed.value));
        }

        if (SendOutcomes.$is("Accepted")(outcome)) {
          accepted.push(`${target.name} (id ${envelope.aad.messageId})`);
          receipt ??= {
            id: envelope.aad.messageId,
            seq: outcome.receipt.seq,
          };
        }
      }

      if (receipt === undefined) {
        return yield* Effect.fail(refused("NotAttempted", "No delivery"));
      }

      return Verdicts.Delivered({ ...receipt, to: primary.name });
    }).pipe(
      Effect.scoped,
      Effect.mapError((error) =>
        isVerdict(error) ? error : refused("NotAttempted", reasonOf(error))
      )
    );
  },
  (effect) =>
    effect.pipe(
      Effect.match({ onFailure: settle, onSuccess: settle }),
      Effect.catchDefect(() =>
        Effect.succeed(
          Verdicts.Uncertain({
            reason: "Unexpected failure while sending",
            sent: true,
          })
        )
      )
    )
);

export const readBody = (body: string) =>
  body === "-"
    ? Stdio.Stdio.use((stdio) =>
        stdio.stdin.pipe(Stream.decodeText(), Stream.mkString)
      ).pipe(
        Effect.mapError(() =>
          refused("Usage", "Could not read the body from stdin")
        )
      )
    : Effect.succeed(body);

export const resolveSendRecord = Effect.fn("Nest.resolveSendRecord")(
  function* resolveSendRecord(
    request: SendRequestValue,
    explicitSummary: boolean
  ) {
    if (request.record === undefined) {
      return { ...request, body: yield* readBody(request.body) };
    }

    const fs = yield* FileSystem.FileSystem;

    const raw = yield* fs
      .readFileString(request.record)
      .pipe(
        Effect.mapError(() =>
          refused("InvalidRecord", "record: supply a readable JSON file")
        )
      );

    const json = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Json)
    )(raw).pipe(
      Effect.mapError(() =>
        refused("InvalidRecord", "record: supply valid JSON")
      )
    );

    const value = yield* validateRecord(request.type, json).pipe(
      Effect.mapError((error) => refused("InvalidRecord", error.reason))
    );

    return {
      ...request,
      body: JSON.stringify(value),
      kind: "data" as const,
      summary: explicitSummary ? request.summary : recordSummary(value),
    };
  }
);

export const sendCommand = Effect.fn("Nest.send")(function* sendCommand(
  argv: readonly string[]
) {
  const verdict = yield* Effect.gen(function* run() {
    const parsed = parseSend(argv);

    if (Result.isFailure(parsed)) {
      return yield* Effect.fail(refused("Usage", parsed.failure));
    }

    const request = yield* resolveSendRecord(
      parsed.success,
      argv.includes("--summary")
    );

    const settings = yield* loadSettings().pipe(
      Effect.mapError((error) => refused("NotConfigured", error.reason))
    );

    return yield* scriptSend(request).pipe(
      Effect.provide(
        Layer.mergeAll(directoryLayer, secretStoreLayer, FetchHttpClient.layer)
      ),
      Effect.provideService(Settings, settings)
    );
  }).pipe(Effect.match({ onFailure: settle, onSuccess: settle }));

  const shown = render(verdict);

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
