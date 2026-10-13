/* oxlint-disable eslint/max-classes-per-file, eslint/no-redeclare -- Effect service, Schema errors and the reader state enum share their owning port. */
import * as Defs from "@rat-king/lexicon/defs";
import * as Retire from "@rat-king/lexicon/identity.retireName";
import * as Runtime from "@rat-king/lexicon/runtime";
import { Transport } from "@rat-king/lexicon/transport";
import {
  ownIdentity,
  prepare,
  readerCannotRender,
  recordType,
  SendOutcomes,
  transportLayer,
} from "@rat-king/mailbox-client";
import type {
  MailboxClientError,
  ConsumeOptions,
  IdentityValue,
  LeaseFence,
  MessageMeta,
  OpenedMessage,
  PeerDocument,
  SendOutcome,
} from "@rat-king/mailbox-client";
import {
  Clock,
  Context,
  Data,
  DateTime,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Match,
  Option,
  Path,
  Ref,
  Result,
  Schedule,
  Schema,
  Semaphore,
} from "effect";
import type { Scope } from "effect";
import { HttpClient } from "effect/http";

import { AskJournal, askAge, openAsks } from "./asks.ts";
import type { AsksApi, PendingAskValue } from "./asks.ts";
import { AskAimedAtCc, ccLint, ccRefusal } from "./cc-lint.ts";
import { Settings } from "./config.ts";
import { recipientLevels } from "./delivery.ts";
import type { RecipientLevelValue } from "./delivery.ts";
import { Directory, writePrivateJson } from "./directory.ts";
import type { Listed, Resolved } from "./directory.ts";
import { reasonOf } from "./errors.ts";
import { claimName, ensureIdentity } from "./identity.ts";
import type { SessionFacts } from "./identity.ts";
import { Issuer } from "./issuer.ts";
import {
  AgentName,
  addressedElsewhere,
  canonicalName,
  didFor,
  isReserved,
  provisionLabel,
  verifiedSender,
} from "./name.ts";
import {
  decodePayload,
  decodeRecord,
  PayloadJson,
  RecordJson,
  replyRef,
  SUMMARY_MAX,
} from "./payload.ts";
import type {
  Inbound,
  InboundRecord,
  KindValue,
  LexiconRecordValue,
  PayloadValue,
} from "./payload.ts";
import { digestFor } from "./pending.ts";
import { PRESENCE_TTL_MS, PresenceTimeout, presenceLine } from "./presence.ts";
import type { PresenceValue } from "./presence.ts";
import { quarantined, recover } from "./quarantine.ts";
import type { Quarantined } from "./quarantine.ts";
import { errorTag, HEARTBEAT_EVERY, HeartbeatJson } from "./reader-health.ts";
import type { ReaderHeartbeatValue } from "./reader-health.ts";
import { RENDERS } from "./record-visibility.ts";
import {
  copiesOutbound,
  openRelay,
  deliverRelay,
  RelayHandled,
  RelayJournal,
  transferCustody,
} from "./relay.ts";
import type { RelayOutboundValue } from "./relay.ts";
import { SecretStore } from "./secrets.ts";
import { replyRecipients, Threads, threadsLayer } from "./threads.ts";
import type { Received, Reply } from "./threads.ts";

export const NotDeliveredCode = Schema.Literals([
  "NotConfigured",
  "NoIdentity",
  "UnknownName",
  "Self",
  "NotAttempted",
  "Rejected",
  "Uncertain",
  "Refused",
  "Partial",
  "Retired",
  "ReaderCannotRender",
  "AskAimedAtCc",
]);

export class NotDelivered extends Schema.TaggedError<NotDelivered>()(
  "NotDelivered",
  {
    addressed: Schema.optionalKey(AskAimedAtCc),
    code: NotDeliveredCode,
    reason: Schema.String,
  }
) {}

export class AskFailed extends Schema.TaggedError<AskFailed>()("AskFailed", {
  code: Schema.Literals(["NoReply", "NoReader", "NoSuchMessage"]),
  reason: Schema.String,
}) {}

export type ReaderState = Data.TaggedEnum<{
  Starting: { readonly reason: string };
  Minting: { readonly name: string };
  Acquiring: { readonly name: string; readonly did: string };
  Live: {
    readonly name: string;
    readonly did: string;
    readonly generation: number;
    readonly expiresAt: string;
  };
  Retrying: {
    readonly name: Option.Option<string>;
    readonly attempt: number;
    readonly reason: string;
  };
  Refused: { readonly name: string; readonly reason: string };
  SendOnly: { readonly name: string; readonly reason: string };
}>;

export const ReaderState = Data.taggedEnum<ReaderState>();

export const ADMISSION_TRIES = 10;

export const admissionBackoff = (count: number) =>
  Duration.seconds(Math.min(2 ** (count - 1), 15));

export const AdmissionBackoff = Context.Reference<
  (count: number) => Duration.Duration
>("RatKing.AdmissionBackoff", {
  defaultValue: () => admissionBackoff,
});

export interface Self {
  readonly name: string;
  readonly did: string;
  readonly identity: IdentityValue;
  readonly label?: () => Option.Option<string>;
}

interface Admitted {
  readonly id: string;
  readonly seq: number;
  readonly to: string;
  readonly did: string;
}

export interface HandledAck {
  readonly acked: true;
  readonly id: string;
}

export interface Delivered extends Admitted {
  readonly presence?: string;
  readonly recipients?: readonly RecipientLevelValue[];
}

interface FrontLoops {
  readonly answered: (
    names: readonly string[]
  ) => Effect.Effect<void, NotDelivered>;
  readonly handled: (id: string) => Effect.Effect<void, NotDelivered>;
}

interface Sent {
  readonly from: string;
  readonly to: string;
  readonly cc: readonly string[];
  readonly body: string;
  readonly encrypted: boolean;
  readonly kind: KindValue;
  readonly thread: string;
  readonly replyTo: string | null;
  readonly summary: string | null;
}

const oneLineSummary = (text: string) =>
  text.replaceAll(/\s+/gu, " ").trim().slice(0, SUMMARY_MAX);

export interface SendOptions {
  readonly ccOnPurpose?: boolean;
  readonly encrypt?: boolean;
  readonly kind?: KindValue;
  readonly replyTo?: { readonly messageId: string; readonly senderDid: string };
  readonly summary?: string;
  readonly cc?: readonly string[];
  readonly thread?: string;
}

export type AskOptions = Pick<
  SendOptions,
  "ccOnPurpose" | "encrypt" | "cc" | "summary"
> & {
  readonly dueBy?: number;
  readonly wait?: boolean;
};

export interface Asked {
  readonly delivered: Delivered;
  readonly reply?: Reply;
}

interface RelayRoute {
  readonly message: (
    inbound: Inbound,
    settled: boolean,
    encrypted: boolean,
    redelivered: boolean
  ) => Effect.Effect<void, NotDelivered>;
  readonly record: (
    inbound: InboundRecord
  ) => Effect.Effect<void, NotDelivered>;
}

export type Deliver = (
  inbound: Inbound | InboundRecord,
  settled: boolean,
  ack?: Effect.Effect<void>
) => Effect.Effect<void>;

export interface Status {
  readonly reader: ReaderState;
  readonly self: Option.Option<{ readonly name: string; readonly did: string }>;
  readonly endpoint: string;
  readonly quarantine: Quarantined;
}

export class RatKing extends Context.Service<
  RatKing,
  {
    readonly run: (
      facts: SessionFacts,
      deliver: Deliver
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly send: (
      to: string,
      body: string | LexiconRecordValue,
      options?: SendOptions
    ) => Effect.Effect<Delivered, NotDelivered>;
    readonly ask: (
      to: string,
      body: string,
      timeout?: Duration.Input,
      options?: AskOptions
    ) => Effect.Effect<Asked, NotDelivered | AskFailed>;
    readonly reply: (
      id: string,
      body: string | LexiconRecordValue,
      options?: Pick<
        SendOptions,
        "ccOnPurpose" | "encrypt" | "kind" | "summary"
      > & {
        readonly replyAll?: boolean;
        readonly to?: string | undefined;
      }
    ) => Effect.Effect<Delivered, NotDelivered | AskFailed>;
    readonly handled: (
      id: string
    ) => Effect.Effect<Delivered | HandledAck, NotDelivered | AskFailed>;
    readonly pending: Effect.Effect<readonly Received[]>;
    readonly list: Effect.Effect<readonly Listed[]>;
    readonly retire: (
      successor: Option.Option<string>
    ) => Effect.Effect<Retire.OutputValue, NotDelivered>;
    readonly status: Effect.Effect<Status>;
  }
>()("pi-ratking/RatKing") {}

const Cursor = Schema.Struct({ afterSeq: Schema.Int });

const SavedLease = Schema.Struct({
  did: Schema.String,
  generation: Schema.Int,
  leaseId: Schema.String,
});

const peersOf = (documents: readonly PeerDocument[]) => [
  ...new Map(documents.map((document) => [document.id, document])).values(),
];

const instant = (millis: number) => DateTime.makeUnsafe(millis);

const backoff = (attempt: number) =>
  Duration.millis(Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));

export const makeRatKing = Effect.gen(function* makeRatKing() {
  const settings = yield* Settings;
  const lifetime = yield* Effect.scope;
  const directory = yield* Directory;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const store = yield* SecretStore;
  const issuer = yield* Issuer;
  const threads = yield* Threads;

  const replyFor = Effect.fn("RatKing.replyRef")(function* replyFor(
    parent: SendOptions["replyTo"]
  ) {
    if (parent === undefined) {
      return Option.none();
    }

    const stored = yield* threads.lookup(parent.messageId);

    return Option.some(
      Option.match(stored, {
        onNone: () => replyRef(parent.messageId),
        onSome: (record) =>
          replyRef(parent.messageId, record.reply?.root ?? record.thread),
      })
    );
  });

  const asks = yield* Deferred.make<AsksApi<NotDelivered>>();

  const state = yield* Ref.make<ReaderState>(
    ReaderState.Starting({ reason: "Rat King is starting" })
  );

  const health = yield* Ref.make({
    lastConsumeOk: Option.none<number>(),
    lastError: Option.none<string>(),
    leaseHeldSince: Option.none<number>(),
  });

  const session = yield* Ref.make(Option.none<SessionFacts>());

  const heartbeat = yield* Ref.make(
    Option.none<{ readonly name: string; readonly startedAt: number }>()
  );

  const beatLock = yield* Semaphore.make(1);
  let closing = false;

  const attempts = yield* Ref.make(0);
  const self = yield* Deferred.make<Self, NotDelivered>();
  const established = yield* Ref.make(Option.none<Self>());
  const fence = yield* Ref.make(Option.none<LeaseFence>());
  const lastLease = yield* Ref.make(Option.none<LeaseFence>());

  const front = yield* Ref.make(Option.none<FrontLoops>());
  const seen = new Set<string>();
  const acknowledgments = new Map<string, MessageMeta["ack"]>();

  const displayAck = (id: string) =>
    acknowledgments.get(id)?.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          acknowledgments.delete(id);
        })
      ),
      Effect.catchTag("MailboxClientError", (failure) =>
        Effect.logWarning("Rat King display acknowledgment failed", failure)
      )
    );

  const relayed = new Map<string, string>();

  const consumeAck = (id: string) =>
    (displayAck(id) ?? Effect.void).pipe(Effect.forkIn(lifetime));

  const presences = new Map<
    string,
    { readonly at: number; readonly value: Option.Option<PresenceValue> }
  >();

  const services = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(Settings, settings),
      Effect.provideService(Directory, directory),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(SecretStore, store),
      Effect.provideService(Issuer, issuer)
    );

  const cursorFile = (name: string) =>
    path.join(settings.state, "cursors", `${provisionLabel(name)}.json`);

  const leaseFile = (name: string) =>
    path.join(settings.state, "leases", `${provisionLabel(name)}.json`);

  const readLease = (name: string, did: string) =>
    fs
      .readFileString(leaseFile(name))
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.fromJsonString(SavedLease))
        ),
        Effect.option,
        Effect.map(Option.filter((saved) => saved.did === did))
      );

  const writeLease = (name: string, saved: LeaseFence) =>
    Schema.encodeEffect(Schema.fromJsonString(SavedLease))(saved).pipe(
      Effect.flatMap((json) => writePrivateJson(leaseFile(name), json)),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.tapError(() => Effect.logWarning("Rat King lease not saved")),
      Effect.ignore
    );

  const readCursor = (name: string) =>
    fs.readFileString(cursorFile(name)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Cursor))),
      Effect.map((cursor) => cursor.afterSeq),
      Effect.option
    );

  const heartbeatFile = (name: string) =>
    path.join(settings.state, "readers", `${provisionLabel(name)}.json`);

  const publish = beatLock
    .withPermits(1)(
      Effect.gen(function* publishHeartbeat() {
        const beat = yield* Ref.get(heartbeat);
        const facts = yield* Ref.get(session);

        if (closing || Option.isNone(beat) || Option.isNone(facts)) {
          return;
        }

        const now = yield* Clock.currentTimeMillis;
        const reader = yield* Ref.get(state);
        const current = yield* Ref.get(health);

        const value: ReaderHeartbeatValue = {
          lastConsumeOk: current.lastConsumeOk.pipe(
            Option.map(instant),
            Option.getOrNull
          ),
          lastError: Option.getOrNull(current.lastError),
          leaseHeldSince: current.leaseHeldSince.pipe(
            Option.map(instant),
            Option.getOrNull
          ),
          name: beat.value.name,
          pid: facts.value.pid,
          startedAt: instant(beat.value.startedAt),
          state: reader._tag,
          updatedAt: instant(now),
        };

        const owner = (facts.value.owner ?? Option.none()).pipe(
          Option.filter(Schema.is(AgentName))
        );

        if (Option.isSome(owner)) {
          Object.assign(value, { owner: owner.value });
        }

        const json = yield* Schema.encodeEffect(HeartbeatJson)(value);
        const file = heartbeatFile(beat.value.name);

        const temp = path.join(
          path.dirname(file),
          `.${path.basename(file)}.${facts.value.pid}.tmp`
        );

        yield* fs.makeDirectory(path.dirname(file), {
          mode: 0o700,
          recursive: true,
        });
        yield* fs.writeFileString(temp, json, { mode: 0o600 });
        yield* fs.rename(temp, file);
      })
    )
    .pipe(
      Effect.tapError(() =>
        Effect.logWarning("Rat King reader heartbeat not written")
      ),
      Effect.ignore
    );

  const retireHeartbeat = beatLock.withPermits(1)(
    Effect.gen(function* retireHeartbeat() {
      closing = true;

      const beat = yield* Ref.get(heartbeat);
      const facts = yield* Ref.get(session);

      if (Option.isNone(beat) || Option.isNone(facts)) {
        return;
      }

      const file = heartbeatFile(beat.value.name);

      const written = yield* fs
        .readFileString(file)
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(HeartbeatJson)),
          Effect.option
        );

      if (Option.exists(written, (saved) => saved.pid === facts.value.pid)) {
        yield* fs.remove(file).pipe(Effect.ignore);
      }
    })
  );

  const setState = (next: ReaderState) =>
    Ref.set(state, next).pipe(
      Effect.andThen(Ref.get(session)),
      Effect.flatMap((facts) =>
        Effect.try(() => {
          if (Option.isSome(facts)) {
            facts.value.onState?.(next);
          }
        }).pipe(Effect.ignore)
      ),
      Effect.andThen(publish)
    );

  const consumed = Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      Ref.update(health, (current) => ({
        ...current,
        lastConsumeOk: Option.some(now),
      }))
    )
  );

  const quarantineDir = (name: string) =>
    path.join(settings.state, "quarantine", provisionLabel(name));

  const writeCursor = (name: string, afterSeq: number) =>
    Schema.encodeEffect(Schema.fromJsonString(Cursor))({ afterSeq }).pipe(
      Effect.flatMap((json) => writePrivateJson(cursorFile(name), json)),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.tapError(() => Effect.logWarning("Rat King cursor not written")),
      Effect.ignore
    );

  const supervise = <A, E extends { readonly _tag: string }, R>(
    name: Option.Option<string>,
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, never, R> =>
    Effect.gen(function* loop() {
      const result = yield* Effect.result(effect);

      if (Result.isSuccess(result)) {
        return result.success;
      }

      const attempt = yield* Ref.updateAndGet(attempts, (count) => count + 1);

      yield* Ref.update(health, (current) => ({
        ...current,
        lastError: Option.some(errorTag(result.failure)),
      }));

      yield* setState(
        ReaderState.Retrying({
          attempt,
          name,
          reason: reasonOf(result.failure),
        })
      );

      yield* Effect.sleep(backoff(attempt));

      return yield* supervise(name, effect);
    });

  const intake =
    (own: Self, route: RelayRoute) =>
    (message: OpenedMessage, meta: MessageMeta) =>
      Effect.gen(function* takeIn() {
        const checkpoint = yield* Deferred.make<boolean>();

        if (!seen.has(message.tid)) {
          acknowledgments.set(
            message.tid,
            Deferred.await(checkpoint).pipe(Effect.andThen(meta.ack))
          );
          const payload = yield* decodePayload(message.body);
          const known = yield* directory.nameOf(message.senderDid);

          const claimed = Option.match(payload, {
            onNone: () => Option.getOrElse(known, () => message.senderDid),
            onSome: (value) => canonicalName(settings.reserved, value.from),
          });

          const verified = verifiedSender({
            claimed,
            did: message.senderDid,
            known,
            reserved: settings.reserved,
            template: settings.didTemplate,
          });

          const inbound: Inbound = {
            body: Option.match(payload, {
              onNone: () => message.body,
              onSome: (value) => value.body,
            }),
            cc:
              message.cc !== undefined ||
              Option.exists(payload, (value) => (value.cc?.length ?? 0) > 0),
            did: message.senderDid,
            from: claimed,
            id: message.tid,
            kind: Option.getOrElse(
              Option.flatMapNullishOr(payload, (value) => value.kind),
              (): KindValue => "message"
            ),
            label: Option.flatMapNullishOr(payload, (value) => value.label),
            replyTo: Option.orElse(
              Option.flatMapNullishOr(
                payload,
                (value) => value.reply?.parent ?? value.replyTo
              ),
              () => Option.fromNullishOr(message.replyTo?.messageId)
            ),
            summary: Option.flatMapNullishOr(payload, (value) => value.summary),
            verified,
          };

          if (Option.isSome(payload)) {
            if (payload.value.reply !== undefined) {
              Object.assign(inbound, { reply: payload.value.reply });
            }

            if (payload.value.cc !== undefined) {
              Object.assign(inbound, { ccNames: payload.value.cc });
            }

            if (payload.value.to !== undefined) {
              const copy = addressedElsewhere(
                settings.reserved,
                payload.value.to,
                own.name
              );

              Object.assign(inbound, { copy, to: payload.value.to });

              const digest = digestFor(
                settings.ccDigestMinutes ?? {},
                own.name
              );

              if (copy && Option.isSome(digest)) {
                Object.assign(inbound, { digestMinutes: digest.value });
              }
            }

            if (payload.value.thread !== undefined) {
              Object.assign(inbound, { thread: payload.value.thread });
            }
          }

          const record = Option.isNone(payload)
            ? yield* decodeRecord(message.body)
            : Option.none<LexiconRecordValue>();

          if (Option.isSome(record)) {
            yield* threads.remember(inbound);
            yield* route.record({
              did: inbound.did,
              from: inbound.from,
              id: inbound.id,
              record: record.value,
              replyTo: inbound.replyTo,
              verified: inbound.verified,
            });
          } else {
            const journal = yield* Deferred.await(asks);
            const original = yield* journal.match(inbound);

            if (Option.isSome(original)) {
              Object.assign(inbound, {
                askSummary: original.value.summary,
                copy: false,
                kind: "reply",
              });
              const acknowledgment = acknowledgments.get(inbound.id);

              if (acknowledgment !== undefined) {
                acknowledgments.set(
                  inbound.id,
                  acknowledgment.pipe(
                    Effect.andThen(
                      journal
                        .ack(original.value.id)
                        .pipe(
                          Effect.catchTag("NotDelivered", (failure) =>
                            Effect.logWarning(
                              "Rat King ask acknowledgment not saved",
                              failure
                            )
                          )
                        )
                    )
                  )
                );
              }
            }

            const settled = yield* threads.settle(inbound);

            yield* threads.remember(inbound);

            yield* route.message(
              inbound,
              settled,
              message.encrypted ?? true,
              meta.redelivered
            );
          }

          seen.add(message.tid);
        }

        yield* writeCursor(own.name, meta.seq);
        yield* consumed;
        yield* Deferred.succeed(checkpoint, true);
      });

  const consumeOnce = (own: Self, facts: SessionFacts, route: RelayRoute) =>
    Effect.gen(function* consumeLease() {
      yield* setState(ReaderState.Acquiring({ did: own.did, name: own.name }));

      const handle = yield* ownIdentity(own.identity);

      const client = yield* prepare({
        endpoint: settings.endpoint,
        own: handle,
        peers: peersOf(yield* directory.documents),
        serviceDid: settings.serviceDid,
      });

      const saved = yield* readCursor(own.name);

      const afterSeq = Option.isSome(saved) ? saved.value : yield* client.head;

      if (Option.isNone(saved)) {
        yield* writeCursor(own.name, afterSeq);
      }

      const options: ConsumeOptions = {
        ackOnReturn: false,
        afterSeq,
        harness: {
          $type: "sh.mschf.ratking.runtime.lease#pi",
          sessionId: facts.session,
        },
        onLease: (lease) =>
          Ref.get(lastLease).pipe(
            Effect.tap((previous) =>
              Effect.sync(() => {
                if (
                  !Option.exists(
                    previous,
                    (held) => held.generation === lease.generation
                  )
                ) {
                  seen.clear();
                  acknowledgments.clear();
                  relayed.clear();
                }
              })
            ),
            Effect.andThen(
              Effect.all([
                Ref.set(attempts, 0),
                Clock.currentTimeMillis.pipe(
                  Effect.flatMap((now) =>
                    Ref.update(health, (current) => ({
                      ...current,
                      lastConsumeOk: Option.some(now),
                      leaseHeldSince: Option.orElseSome(
                        current.leaseHeldSince,
                        () => now
                      ),
                    }))
                  )
                ),
                Ref.set(
                  fence,
                  Option.some({
                    did: own.did,
                    generation: lease.generation,
                    leaseId: lease.leaseId,
                  })
                ),
                Ref.set(
                  lastLease,
                  Option.some({
                    did: own.did,
                    generation: lease.generation,
                    leaseId: lease.leaseId,
                  })
                ),
                writeLease(own.name, {
                  did: own.did,
                  generation: lease.generation,
                  leaseId: lease.leaseId,
                }),
                setState(
                  ReaderState.Live({
                    did: own.did,
                    expiresAt: lease.expiresAt,
                    generation: lease.generation,
                    name: own.name,
                  })
                ),
              ])
            ),
            Effect.asVoid
          ),
        onSkip: ({ messageId, reason, senderDid, seq }) =>
          Effect.logWarning("Rat King skipped a delivery", {
            messageId,
            reason,
            recipient: own.name,
            senderDid,
            seq,
          }).pipe(
            Effect.andThen(writeCursor(own.name, seq)),
            Effect.andThen(consumed)
          ),
        renders: RENDERS,
        unopenable: (event, error) =>
          recover(quarantineDir(own.name), client)(event, error).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path)
          ),
      };

      const savedLease = yield* readLease(own.name, own.did);

      yield* client.consume(
        intake(own, route),
        Option.match(
          Option.orElse(yield* Ref.get(lastLease), () => savedLease),
          {
            onNone: () => options,
            onSome: (resume): ConsumeOptions => ({
              ...options,
              resume: {
                did: resume.did,
                generation: resume.generation,
                leaseId: resume.leaseId,
              },
            }),
          }
        )
      );
    }).pipe(
      Effect.ensuring(
        Effect.all([
          Ref.set(fence, Option.none()),
          Ref.update(health, (current) => ({
            ...current,
            leaseHeldSince: Option.none(),
          })),
        ])
      ),
      Effect.scoped,
      Effect.provideService(HttpClient.HttpClient, http)
    );

  const awaitSelf = Deferred.await(self).pipe(
    Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () =>
        Ref.get(state).pipe(
          Effect.flatMap((reader) =>
            Effect.fail(
              new NotDelivered({
                code: "NoIdentity",
                reason: ReaderState.$match(reader, {
                  Acquiring: () => "Identity not ready",
                  Live: () => "Identity not ready",
                  Minting: ({ name }) => `Still minting ${name}`,
                  Refused: ({ reason }) => reason,
                  Retrying: ({ reason }) => reason,
                  SendOnly: () => "Identity not ready",
                  Starting: ({ reason }) => reason,
                }),
              })
            )
          )
        ),
    })
  );

  const refused = (code: typeof NotDeliveredCode.Type) => (reason: string) =>
    new NotDelivered({ code, reason });

  const presenceOf = (
    did: string,
    lookup: Effect.Effect<PresenceValue, MailboxClientError>
  ) =>
    Effect.gen(function* presenceLineFor() {
      const now = yield* Clock.currentTimeMillis;
      const cached = presences.get(did);

      const value =
        cached !== undefined && now - cached.at < PRESENCE_TTL_MS
          ? cached.value
          : yield* lookup.pipe(
              Effect.timeoutOption(yield* PresenceTimeout),
              Effect.orElseSucceed(() => Option.none<PresenceValue>()),
              Effect.tap((fresh) =>
                Effect.sync(() => {
                  presences.set(did, { at: now, value: fresh });
                })
              )
            );

      return value;
    }).pipe(
      Effect.catchCause(() => Effect.succeed(Option.none<PresenceValue>()))
    );

  const lookup = Effect.fn("RatKing.lookup")(function* lookup(
    identity: Parameters<typeof ownIdentity>[0],
    requested: string
  ) {
    const name = canonicalName(settings.reserved, requested);

    if (!Schema.is(AgentName)(name)) {
      return yield* refused("UnknownName")(name);
    }

    const did = didFor(settings.didTemplate, settings.reserved, name);

    const document = yield* Effect.gen(function* fetchDocument() {
      const client = yield* prepare({
        endpoint: settings.endpoint,
        own: yield* ownIdentity(identity),
        peers: [],
        serviceDid: settings.serviceDid,
      });

      return yield* client.refresh(did);
    }).pipe(Effect.scoped, Effect.provideService(HttpClient.HttpClient, http));

    yield* directory.record(name, document).pipe(Effect.ignore);

    return { did, document, name };
  });

  const recalled = (id: string, asker: string): Received => {
    const from = canonicalName(settings.reserved, asker);

    return {
      answered: false,
      ask: true,
      did: didFor(settings.didTemplate, settings.reserved, from),
      from,
      id,
      preview: "",
    };
  };

  const transmit = Effect.fn("RatKing.transmit")(function* transmit<B>(
    to: string,
    body: string | LexiconRecordValue,
    options: SendOptions,
    before: (id: string, did: string) => Effect.Effect<B, NotDelivered>
  ) {
    const own = yield* awaitSelf;

    const names = [
      ...new Set(
        [to, ...(options.cc ?? [])].map((name) =>
          canonicalName(settings.reserved, name)
        )
      ),
    ];

    const targets: Resolved[] = [];

    for (const name of names) {
      const target = yield* directory
        .resolve(name)
        .pipe(
          Effect.catchTag("UnknownName", (error) =>
            lookup(own.identity, name).pipe(
              Effect.mapError(() =>
                refused("UnknownName")(`${error.name}: ${error.reason}`)
              )
            )
          )
        );

      if (target.did === own.did) {
        if (name === names[0]) {
          return yield* refused("Self")("Cannot message this Pi's own name");
        }

        continue;
      }

      if (!targets.some((known) => known.did === target.did)) {
        targets.push(target);
      }
    }

    const [primary] = targets;

    if (primary === undefined) {
      return yield* refused("NotAttempted")("No recipient");
    }

    const addressed = ccLint({
      body: Option.liftPredicate(body, Schema.is(Schema.String)),
      ccOnPurpose: options.ccOnPurpose,
      kind: options.kind,
      names: targets.map((target) => target.name),
      summary: options.summary,
    });

    if (Option.isSome(addressed)) {
      return yield* new NotDelivered({
        addressed: addressed.value,
        code: "AskAimedAtCc",
        reason: ccRefusal(addressed.value),
      });
    }

    const accepted: Admitted[] = [];

    const checkReaders = Effect.fn("RatKing.checkReaders")(
      function* checkReaders(
        type: string,
        presence: (
          did: string
        ) => Effect.Effect<PresenceValue, MailboxClientError>
      ) {
        for (const target of targets) {
          const current = yield* presenceOf(target.did, presence(target.did));

          const reason = readerCannotRender(
            target.name,
            type,
            Option.getOrUndefined(current)
          );

          if (reason !== undefined) {
            return yield* refused("ReaderCannotRender")(reason);
          }
        }

        return yield* Effect.void;
      }
    );

    return yield* Effect.gen(function* sealAndSend() {
      const client = yield* prepare({
        endpoint: settings.endpoint,
        own: yield* ownIdentity(own.identity),
        peers: targets.map((target) => target.document),
        serviceDid: settings.serviceDid,
      });

      const textBody = Match.value(body).pipe(
        Match.when(Match.string, (text) => Option.some(text)),
        Match.orElse(() => Option.none<string>())
      );

      const encrypt =
        options.encrypt ?? (Option.isSome(textBody) ? settings.encrypt : true);

      const replyTo =
        options.replyTo === undefined
          ? undefined
          : yield* Schema.decodeUnknownEffect(Schema.toType(Defs.MessageRef))(
              options.replyTo
            );

      const reply = Option.getOrUndefined(yield* replyFor(options.replyTo));

      let json = yield* Match.value(body).pipe(
        Match.when(Match.string, () => Effect.succeed(Option.none<string>())),
        Match.orElse((record) =>
          Schema.encodeEffect(RecordJson)(record).pipe(Effect.map(Option.some))
        )
      );

      const encodeForId = (id: string) => {
        if (Option.isSome(json)) {
          return json.value;
        }

        const payload: PayloadValue = {
          body: Option.getOrElse(textBody, () => ""),
          cc: targets.slice(1).map((target) => target.name),
          from: own.name,
          thread: options.thread ?? id,
          to: primary.name,
        };

        const label = (own.label?.() ?? Option.none<string>()).pipe(
          Option.map((text) => text.trim().slice(0, 256)),
          Option.filter((text) => text !== "")
        );

        if (Option.isSome(label)) {
          Object.assign(payload, { label: label.value });
        }

        if (options.kind !== undefined) {
          Object.assign(payload, { kind: options.kind });
        }

        if (reply !== undefined) {
          Object.assign(payload, {
            reply,
            replyTo: reply.parent,
            thread: reply.root,
          });
        }

        const summary = oneLineSummary(options.summary ?? "");

        if (summary !== "") {
          Object.assign(payload, { summary });
        }

        const text = Schema.encodeSync(PayloadJson)(payload);
        json = Option.some(text);

        return text;
      };

      if (options.kind === "data" || Option.isNone(textBody)) {
        const type = recordType(
          Option.getOrElse(json, () => Option.getOrElse(textBody, () => ""))
        );

        yield* checkReaders(type, client.presence);
      }

      const envelopes: Defs.EncryptedEnvelopeValue[] = [];

      for (const target of targets) {
        envelopes.push(
          yield* client.seal(
            target.did,
            encodeForId,
            replyTo === undefined ? { encrypt } : { encrypt, replyTo }
          )
        );
      }

      const [first] = envelopes;

      if (first === undefined) {
        return yield* refused("NotAttempted")("No envelope");
      }

      const extra = yield* before(first.aad.messageId, primary.did);

      for (const envelope of envelopes) {
        const target = targets.find(
          (entry) => entry.did === envelope.aad.recipientDid
        );

        if (target === undefined) {
          return yield* refused("NotAttempted")("Missing sealed recipient");
        }

        const attempt = (count: number): Effect.Effect<SendOutcome> =>
          Ref.get(fence).pipe(
            Effect.flatMap((held) =>
              Option.match(held, {
                onNone: () => client.send(envelope),
                onSome: (current) => client.send(envelope, { fence: current }),
              })
            ),
            Effect.flatMap((outcome) =>
              (SendOutcomes.$is("Uncertain")(outcome) ||
                (SendOutcomes.$is("Rejected")(outcome) &&
                  outcome.error.error === "LeaseMismatch")) &&
              count < ADMISSION_TRIES
                ? Effect.gen(function* retryAdmission() {
                    const delay = yield* AdmissionBackoff;

                    yield* Effect.sleep(delay(count));

                    return yield* attempt(count + 1);
                  })
                : Effect.succeed(outcome)
            )
          );

        const outcome = yield* attempt(1);

        const delivered = yield* SendOutcomes.$match(outcome, {
          Accepted: ({ receipt }) =>
            Effect.succeed({
              did: target.did,
              id: envelope.aad.messageId,
              seq: receipt.seq,
              to: target.name,
            }),
          NotAttempted: ({ reason }) =>
            Effect.fail(refused("NotAttempted")(reason)),
          Rejected: ({ error }) =>
            Effect.fail(
              error.error === "Retired"
                ? refused("Retired")(error.reason)
                : refused("Rejected")(
                    `${error.error ?? "Rejected"} (${error.status ?? "4xx"}): ${error.reason}`
                  )
            ),
          Uncertain: ({ error }) =>
            Effect.fail(
              refused("Uncertain")(
                `Admission not confirmed after ${ADMISSION_TRIES} tries over about 90 s: ${error.reason}`
              )
            ),
        });

        accepted.push(delivered);
      }

      const [admitted] = accepted;

      if (admitted === undefined) {
        return yield* refused("NotAttempted")("No delivery");
      }

      const now = yield* Clock.currentTimeMillis;

      const line = (yield* presenceOf(
        admitted.did,
        client.presence(admitted.did)
      )).pipe(Option.flatMap((presence) => presenceLine(presence, now)));

      const recipients = recipientLevels(
        primary.name,
        targets.slice(1).map((target) => target.name),
        options.kind ?? "message"
      );

      const delivered: Delivered = Option.match(line, {
        onNone: () => ({ ...admitted, recipients }),
        onSome: (presence) => ({ ...admitted, presence, recipients }),
      });

      const summary = oneLineSummary(options.summary ?? "");

      const sent: Sent = {
        body: Option.getOrElse(textBody, () =>
          Option.getOrElse(json, () => "")
        ),
        cc: targets.slice(1).map((target) => target.name),
        encrypted: encrypt,
        from: own.name,
        kind: options.kind ?? "message",
        replyTo: options.replyTo?.messageId ?? null,
        summary: Option.isSome(textBody) && summary !== "" ? summary : null,
        thread: Option.match(Option.fromNullishOr(reply), {
          onNone: () => options.thread ?? first.aad.messageId,
          onSome: (ref) => ref.root,
        }),
        to: primary.name,
      };

      return { delivered, extra, sent };
    }).pipe(
      Effect.scoped,
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.mapError((error) => {
        if (accepted.length > 0) {
          return refused("Partial")(
            `Accepted by ${accepted.map((entry) => `${entry.to} (id ${entry.id})`).join(", ")}; remaining delivery failed: ${reasonOf(error)}. Do not resend to accepted recipients.`
          );
        }

        return Schema.is(NotDelivered)(error)
          ? error
          : refused("NotAttempted")(reasonOf(error));
      })
    );
  });

  const routing = (
    own: Self,
    deliver: Deliver
  ): Effect.Effect<RelayRoute, NotDelivered, Scope.Scope> =>
    Effect.gen(function* routeReader() {
      const config = settings.relays.find(
        (relay) => relay.name === own.name || relay.to === own.name
      );

      if (config === undefined) {
        return {
          message: (inbound: Inbound, settled: boolean) =>
            deliver(inbound, settled),
          record: (inbound: InboundRecord) => deliver(inbound, false),
        } satisfies RelayRoute;
      }

      if (config.to === own.name) {
        return {
          message: (inbound: Inbound, settled: boolean) =>
            deliver(inbound, settled),
          record: (inbound: InboundRecord) =>
            Effect.gen(function* staffRecord() {
              const accepted = yield* deliverRelay(config, own.name, inbound, {
                deliver: (received, settled) =>
                  Effect.sync(() => {
                    relayed.set(received.id, inbound.id);
                  }).pipe(
                    Effect.andThen(
                      deliver(received, settled, displayAck(inbound.id))
                    )
                  ),
                remember: threads.remember,
              });

              if (!accepted) {
                yield* deliver(inbound, false);
              }
            }),
        } satisfies RelayRoute;
      }

      const scope = yield* Effect.scope;

      const file = path.join(
        settings.state,
        "relay",
        `${provisionLabel(own.name)}.json`
      );

      const persistenceError = (error: { readonly _tag: string }) =>
        new NotDelivered({
          code: "NotAttempted",
          reason: `Relay journal: ${reasonOf(error)}`,
        });

      const relay = yield* openRelay(config, {
        inject: deliver,
        load: fs.exists(file).pipe(
          Effect.flatMap((exists) =>
            exists
              ? fs
                  .readFileString(file)
                  .pipe(
                    Effect.flatMap(
                      Schema.decodeEffect(Schema.fromJsonString(RelayJournal))
                    )
                  )
              : Effect.succeed([])
          ),
          Effect.mapError(persistenceError)
        ),
        now: Clock.currentTimeMillis,
        save: (entries) =>
          Schema.encodeEffect(Schema.fromJsonString(RelayJournal))(
            entries
          ).pipe(
            Effect.flatMap((json) => writePrivateJson(file, json)),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.mapError(persistenceError)
          ),
      });

      for (const original of yield* relay.originals) {
        if (Option.isNone(yield* threads.lookup(original.id))) {
          yield* threads.remember(original);
        }
      }

      yield* Ref.set(front, Option.some(relay));
      yield* Effect.addFinalizer(() => Ref.set(front, Option.none()));

      const recoverRelay = Clock.currentTimeMillis.pipe(
        Effect.flatMap(relay.recover)
      );

      yield* recoverRelay;
      yield* recoverRelay.pipe(
        Effect.tapError(() =>
          Effect.logWarning("Rat King relay recovery failed")
        ),
        Effect.ignore,
        Effect.repeat(Schedule.spaced("1 second")),
        Effect.forkIn(scope)
      );

      return {
        message: (inbound, settled, encrypted, redelivered) =>
          Effect.gen(function* routeMessage() {
            if (inbound.noReply === true || inbound.askSummary !== undefined) {
              yield* deliver(inbound, settled);

              return;
            }

            const record = yield* relay.receive(
              inbound,
              settled,
              encrypted,
              yield* Clock.currentTimeMillis,
              redelivered
            );

            if (Option.isSome(record)) {
              const send = transmit(
                config.to,
                record.value,
                { encrypt: encrypted },
                () => Effect.void
              );

              const forward =
                config.mode === "copy"
                  ? send
                  : transferCustody(
                      send,
                      relay.forwarded(inbound.id),
                      displayAck(inbound.id) ?? Effect.void
                    );

              yield* forward.pipe(
                Effect.catch((error) =>
                  Effect.logWarning(
                    "Rat King relay forward failed",
                    error.code
                  ).pipe(Effect.andThen(relay.failed(inbound.id)))
                ),
                Effect.tapError(() =>
                  Effect.logWarning("Rat King relay fallback journal failed")
                ),
                Effect.ignore,
                Effect.forkIn(scope)
              );
            } else if (
              (yield* relay.transferred(inbound.id)) ||
              (yield* relay.closed(inbound.id))
            ) {
              yield* consumeAck(inbound.id);
            }
          }),
        record: (inbound) =>
          Effect.gen(function* routeRecord() {
            const handled = Schema.decodeUnknownOption(RelayHandled)(
              inbound.record
            );

            yield* config.mode === "front" &&
            inbound.verified &&
            inbound.from === config.to &&
            Option.isSome(handled)
              ? relay
                  .handled(handled.value.id)
                  .pipe(Effect.andThen(consumeAck(inbound.id)))
              : deliver(inbound, false);
          }),
      } satisfies RelayRoute;
    });

  const loop = Effect.fn("RatKing.run")(function* loop(
    facts: SessionFacts,
    deliver: Deliver,
    startedAt: number
  ) {
    const claimed = yield* supervise(
      Option.none(),
      claimName(facts).pipe(services)
    );

    if (settings.refuse.includes(claimed.name)) {
      const reason = `${claimed.name} is held by another reader (refuse list in the Rat King config); no reader started`;

      yield* setState(ReaderState.Refused({ name: claimed.name, reason }));

      return yield* Deferred.fail(
        self,
        new NotDelivered({ code: "Refused", reason })
      ).pipe(Effect.asVoid);
    }

    if (facts.reads !== false) {
      yield* Ref.set(heartbeat, Option.some({ name: claimed.name, startedAt }));
    }

    const own = yield* supervise(
      Option.some(claimed.name),
      Effect.gen(function* establish() {
        yield* setState(ReaderState.Minting({ name: claimed.name }));

        const identity = yield* ensureIdentity(claimed.name);

        return {
          did: identity.did,
          identity,
          label: facts.label ?? (() => facts.pane),
          name: claimed.name,
        };
      }).pipe(services)
    );

    const file = path.join(
      settings.state,
      "asks",
      `${provisionLabel(own.name)}.json`
    );

    const journal = yield* supervise(
      Option.some(own.name),
      openAsks({
        load: fs.exists(file).pipe(
          Effect.flatMap((exists) =>
            exists
              ? fs
                  .readFileString(file)
                  .pipe(
                    Effect.flatMap(
                      Schema.decodeEffect(Schema.fromJsonString(AskJournal))
                    )
                  )
              : Effect.succeed([])
          ),
          Effect.mapError((error) =>
            refused("NotAttempted")(`Ask journal: ${reasonOf(error)}`)
          )
        ),
        now: Clock.currentTimeMillis,
        save: (entries) =>
          Schema.encodeEffect(Schema.fromJsonString(AskJournal))(entries).pipe(
            Effect.flatMap((json) => writePrivateJson(file, json)),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.mapError((error) =>
              refused("NotAttempted")(`Ask journal: ${reasonOf(error)}`)
            )
          ),
      })
    );

    yield* Deferred.succeed(asks, journal);
    yield* Ref.set(established, Option.some(own));
    yield* Deferred.succeed(self, own);

    if (facts.reads === false) {
      return yield* setState(
        ReaderState.SendOnly({
          name: own.name,
          reason:
            "Non-interactive Pi: send-only, no reader and no lease. Set RATKING_PRINT_NAME to read a name",
        })
      );
    }

    const route = yield* supervise(
      Option.some(own.name),
      routing(own, (inbound, settled, ack) =>
        deliver(inbound, settled, ack ?? displayAck(inbound.id))
      )
    );

    yield* journal.nudges.pipe(
      Effect.flatMap((overdue) =>
        Effect.forEach(
          overdue,
          (ask) =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) =>
                deliver(
                  {
                    body: `🐀 no reply from ${ask.to} · ${ask.id.slice(0, 8)} · ${askAge(ask, now)}\nThe ask remains open; a late reply still arrives.`,
                    cc: false,
                    copy: true,
                    did: ask.did,
                    from: ask.to,
                    id: `no-reply:${ask.id}`,
                    kind: "message",
                    label: Option.none(),
                    noReply: true,
                    replyTo: Option.some(ask.id),
                    summary: Option.none(),
                    verified: true,
                  },
                  false
                )
              )
            ),
          { discard: true }
        )
      ),
      Effect.tapError((error) =>
        Effect.logWarning("Rat King ask nudge failed", error)
      ),
      Effect.ignore,
      Effect.repeat(Schedule.spaced("1 minute")),
      Effect.forkScoped
    );

    return yield* supervise(
      Option.some(own.name),
      consumeOnce(own, facts, route).pipe(
        Effect.andThen(
          Effect.fail(
            new NotDelivered({
              code: "Uncertain",
              reason: "Reader stopped; restarting",
            })
          )
        )
      )
    ).pipe(Effect.forever);
  });

  const run = (facts: SessionFacts, deliver: Deliver) =>
    Effect.gen(function* start() {
      const startedAt = yield* Clock.currentTimeMillis;

      yield* Ref.set(session, Option.some(facts));
      yield* loop(facts, deliver, startedAt).pipe(Effect.forkScoped);
      yield* publish.pipe(
        Effect.repeat(Schedule.spaced(HEARTBEAT_EVERY)),
        Effect.forkScoped
      );
      yield* Effect.addFinalizer(() => retireHeartbeat);
    });

  const awaitLive = Ref.get(state).pipe(
    Effect.flatMap((reader) =>
      ReaderState.$is("Live")(reader)
        ? Effect.void
        : Effect.fail(
            new AskFailed({
              code: "NoReader",
              reason: ReaderState.$is("SendOnly")(reader)
                ? `${reader.reason}; nothing sent`
                : "This Pi's Rat King reader holds no lease, so a reply could not reach it; nothing sent",
            })
          )
    ),
    Effect.retry(
      Schedule.spaced("250 millis").pipe(
        Schedule.upTo({ duration: "30 seconds" }),
        Schedule.while(
          ({ input }: { readonly input: AskFailed }) =>
            !input.reason.startsWith("Non-interactive")
        )
      )
    )
  );

  const copyOut = (delivered: Delivered, sent: Sent) => {
    const config = settings.relays.find((relay) => relay.name === sent.from);

    if (!copiesOutbound(config, sent.from, [sent.to, ...sent.cc])) {
      return Effect.void;
    }

    const record: RelayOutboundValue = {
      $type: "sh.mschf.ratking.relay#outbound",
      body: sent.body,
      cc: sent.cc,
      encrypted: sent.encrypted,
      id: delivered.id,
      kind: sent.kind,
      replyTo: sent.replyTo,
      summary: sent.summary,
      thread: sent.thread,
      to: sent.to,
    };

    return transmit(
      config.to,
      record,
      { encrypt: sent.encrypted, kind: "data" },
      () => Effect.void
    ).pipe(
      Effect.tapError((failure) =>
        Effect.logWarning("Rat King outbound copy failed", failure.code)
      ),
      Effect.ignore,
      Effect.forkIn(lifetime),
      Effect.asVoid
    );
  };

  const closeLoops = (sent: Sent, original?: string) =>
    Ref.get(front).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (relay) =>
            (original === undefined
              ? Effect.void
              : relay.handled(original)
            ).pipe(Effect.andThen(relay.answered([sent.to, ...sent.cc]))),
        })
      ),
      Effect.tapError((failure) =>
        Effect.logWarning("Rat King relay handled journal failed", failure.code)
      ),
      Effect.ignore
    );

  const confirmHandled = Effect.fn("RatKing.confirmHandled")(
    function* confirmHandled(id: string) {
      const record = yield* threads.lookup(id);

      if (Option.isNone(record) || record.value.relay === undefined) {
        const open = relayed.get(id);

        if (open !== undefined && acknowledgments.has(open)) {
          relayed.delete(id);
          yield* consumeAck(open);

          return { acked: true, id } satisfies HandledAck;
        }

        return yield* new AskFailed({
          code: "NoSuchMessage",
          reason: `No relayed message ${id} reached this Pi`,
        });
      }

      const own = yield* awaitSelf;
      const relayName = record.value.relay.name;

      const config = settings.relays.find(
        (relay) => relay.to === own.name && relay.name === relayName
      );

      if (config === undefined) {
        return yield* refused("NotAttempted")(
          "Handled confirmation is available only on the configured EA"
        );
      }

      const target = yield* directory
        .resolve(config.name)
        .pipe(
          Effect.mapError(() => refused("UnknownName")("Relay desk is unknown"))
        );

      if (target.did !== record.value.relay.did) {
        return yield* refused("NotAttempted")(
          "Relay desk DID changed; no confirmation sent"
        );
      }

      const { delivered } = yield* transmit(
        config.name,
        { $type: "sh.mschf.ratking.relay#handled", id },
        { encrypt: record.value.relay.encrypted, kind: "data" },
        () => Effect.void
      );

      yield* threads.answer(id);

      const open = relayed.get(id);

      if (open !== undefined) {
        relayed.delete(id);
        yield* consumeAck(open);
      }

      return delivered;
    }
  );

  return RatKing.of({
    ask: Effect.fn("RatKing.ask")(function* ask(to, body, timeout, options) {
      yield* awaitLive;

      const pending = yield* Ref.make(Option.none<string>());
      const journal = yield* Deferred.await(asks);

      return yield* Effect.gen(function* askAndWait() {
        const { delivered, extra, sent } = yield* transmit(
          to,
          body,
          { ...options, kind: "ask" },
          (id, did) =>
            Effect.gen(function* registerAsk() {
              const entry: PendingAskValue = {
                did,
                id,
                sentAt: yield* Clock.currentTimeMillis,
                state: "pending",
                summary: oneLineSummary(options?.summary ?? body),
                to: canonicalName(settings.reserved, to),
              };

              if (options?.dueBy !== undefined) {
                Object.assign(entry, { dueBy: options.dueBy });
              }

              yield* journal.record(entry);
              yield* Ref.set(pending, Option.some(id));

              if (options?.wait !== true) {
                return Option.none<Deferred.Deferred<Reply>>();
              }

              return Option.some(yield* threads.wait(id, did));
            })
        );

        yield* copyOut(delivered, sent);
        yield* closeLoops(sent);

        if (Option.isNone(extra)) {
          return { delivered };
        }

        const bound = Duration.millis(
          Math.min(
            600_000,
            Math.max(
              1,
              Duration.toMillis(
                Duration.fromInputUnsafe(timeout ?? "10 minutes")
              )
            )
          )
        );

        const reply = yield* Deferred.await(extra.value).pipe(
          Effect.timeoutOrElse({
            duration: bound,
            orElse: () =>
              Effect.fail(
                new AskFailed({
                  code: "NoReply",
                  reason: `No reply from ${delivered.to} to ${delivered.id} within ${Duration.format(Duration.fromInputUnsafe(bound))}. The ask was delivered; a late answer arrives as a normal message.${delivered.presence === undefined ? "" : ` ${delivered.presence}`}`,
                })
              ),
          })
        );

        return { delivered, reply };
      }).pipe(
        Effect.tapError((failure) => {
          if (
            !Schema.is(NotDelivered)(failure) ||
            failure.code === "Partial" ||
            failure.code === "Uncertain"
          ) {
            return Effect.void;
          }

          return Ref.get(pending).pipe(
            Effect.flatMap((id) =>
              Option.match(id, {
                onNone: () => Effect.void,
                onSome: (value) =>
                  journal.ack(value).pipe(
                    Effect.tapError((error) =>
                      Effect.logWarning(
                        "Rat King rejected ask not closed",
                        error
                      )
                    ),
                    Effect.ignore
                  ),
              })
            )
          );
        }),
        Effect.ensuring(
          Ref.get(pending).pipe(
            Effect.flatMap((id) =>
              Option.match(id, {
                onNone: () => Effect.void,
                onSome: threads.forget,
              })
            )
          )
        )
      );
    }),
    handled: confirmHandled,
    list: Effect.gen(function* list() {
      const remote = yield* issuer.names.pipe(
        Effect.tapError(() =>
          Effect.logWarning("Rat King issuer directory unavailable")
        ),
        Effect.orElseSucceed((): readonly Resolved[] => [])
      );

      const known = new Set((yield* directory.list).map((entry) => entry.name));

      for (const entry of remote) {
        if (
          !known.has(entry.name) &&
          !isReserved(settings.reserved, entry.name) &&
          entry.document.id === entry.did
        ) {
          yield* directory.record(entry.name, entry.document).pipe(
            Effect.tapError(() =>
              Effect.logWarning("Rat King directory entry not recorded")
            ),
            Effect.ignore
          );
        }
      }

      return yield* directory.list;
    }),
    pending: Effect.gen(function* pendingAsks() {
      if (Option.isNone(yield* Ref.get(established))) {
        return yield* threads.pending;
      }

      const journal = yield* Deferred.await(asks);
      const outbound = yield* journal.pending;

      return [
        ...(yield* threads.pending),
        ...outbound.map((entry): Received => ({
          answered: false,
          ask: true,
          did: entry.did,
          from: entry.to,
          id: entry.id,
          outbound: entry,
          preview: entry.summary,
        })),
      ];
    }),
    reply: Effect.fn("RatKing.reply")(function* reply(id, body, options) {
      const stored = yield* threads.lookup(id);

      const record = Option.isSome(stored)
        ? stored
        : Option.map(Option.fromNullishOr(options?.to), (asker) =>
            recalled(id, asker)
          );

      if (Option.isNone(record)) {
        return yield* new AskFailed({
          code: "NoSuchMessage",
          reason: `No message ${id} reached this Pi since its reader started; pass to with the asker's name to answer it as a thread, or use send`,
        });
      }

      const claimed = Option.liftPredicate(
        record.value.from,
        (from) =>
          Schema.is(AgentName)(from) &&
          didFor(settings.didTemplate, settings.reserved, from) ===
            record.value.did
      );

      const sender = Option.orElse(
        yield* directory.nameOf(record.value.did),
        () => claimed
      );

      if (Option.isNone(sender)) {
        return yield* refused("UnknownName")(
          `Sender ${record.value.did} is not in the Rat King directory`
        );
      }

      const own = yield* awaitSelf;

      const recipients = replyRecipients(
        { ...record.value, from: sender.value },
        own.name,
        options?.replyAll ?? true
      );

      const [target] = recipients;

      if (target === undefined) {
        return yield* refused("Self")("No other thread participant");
      }

      const replyOptions: SendOptions = {
        ...options,
        cc: recipients.slice(1),
        kind: options?.kind === "data" ? "data" : "reply",
        replyTo: { messageId: id, senderDid: record.value.did },
        thread: record.value.thread ?? id,
      };

      if (record.value.relay !== undefined && options?.encrypt === undefined) {
        Object.assign(replyOptions, { encrypt: record.value.relay.encrypted });
      }

      const { delivered, sent } = yield* transmit(
        target,
        body,
        replyOptions,
        () => Effect.void
      );

      yield* copyOut(delivered, sent);
      yield* closeLoops(sent, id);
      yield* threads.answer(id);

      if (
        record.value.relay !== undefined &&
        settings.relays.some(
          (relay) =>
            relay.name === record.value.relay?.name && relay.mode === "front"
        )
      ) {
        yield* confirmHandled(id).pipe(
          Effect.mapError((error) =>
            refused("Partial")(
              `Reply accepted by ${delivered.to} (id ${delivered.id}); handled confirmation failed: ${reasonOf(error)}. Use handled to retry only the confirmation.`
            )
          )
        );
      }

      return delivered;
    }),
    retire: Effect.fn("RatKing.retire")(function* retire(successor) {
      const own = yield* awaitSelf;

      const input = yield* Schema.decodeUnknownEffect(
        Schema.toEncoded(Runtime.Data)
      )(
        Option.match(successor, {
          onNone: () => ({ name: own.name }),
          onSome: (next) => ({ name: own.name, successor: next }),
        })
      ).pipe(Effect.mapError(() => refused("NotAttempted")("Invalid name")));

      const response = yield* Transport.use((transport) =>
        transport.request({
          input,
          method: "POST",
          nsid: Retire.Method.nsid,
          params: undefined,
        })
      ).pipe(
        Effect.provide(
          transportLayer(
            settings.endpoint,
            `${settings.serviceDid.replace(/#mailbox$/u, "")}#mailbox`,
            own.identity
          )
        ),
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.mapError(() =>
          refused("Uncertain")("Name authority is unreachable")
        )
      );

      if (response.status !== 200) {
        const error = Schema.decodeUnknownOption(
          Schema.Struct({
            error: Schema.String,
            message: Schema.optionalKey(Schema.String),
          })
        )(response.body);

        return yield* refused(
          response.status >= 500 ? "Uncertain" : "Rejected"
        )(
          Option.match(error, {
            onNone: () => `Name authority answered HTTP ${response.status}`,
            onSome: (body) =>
              body.message === undefined || body.message === body.error
                ? body.error
                : `${body.error}: ${body.message}`,
          })
        );
      }

      return yield* Schema.decodeUnknownEffect(Retire.Output)(
        response.body
      ).pipe(
        Effect.mapError(() =>
          refused("Uncertain")("Name authority answered with an invalid body")
        )
      );
    }),
    run,
    send: Effect.fn("RatKing.send")(function* send(to, body, options) {
      const { delivered, sent } = yield* transmit(
        to,
        body,
        options ?? {},
        () => Effect.void
      );

      yield* copyOut(delivered, sent);
      yield* closeLoops(sent);

      return delivered;
    }),

    status: Effect.gen(function* status() {
      const current = yield* Ref.get(established);

      return {
        endpoint: settings.endpoint,
        quarantine: yield* Option.match(current, {
          onNone: () =>
            Effect.succeed<Quarantined>({ count: 0, latest: Option.none() }),
          onSome: ({ name }) =>
            quarantined(quarantineDir(name)).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path)
            ),
        }),
        reader: yield* Ref.get(state),
        self: current.pipe(Option.map(({ did, name }) => ({ did, name }))),
      };
    }),
  });
});

export const ratKingLayer = Layer.effect(RatKing, makeRatKing).pipe(
  Layer.provide(threadsLayer)
);
