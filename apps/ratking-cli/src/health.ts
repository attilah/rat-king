import { Identity, ownIdentity, prepare } from "@rat-king/mailbox-client";
import { healthVerdict } from "@rat-king/mailbox-client/health";
import type { HealthFacts } from "@rat-king/mailbox-client/health";
import { Settings } from "@rat-king/ratking-client/config";
import { provisionLabel } from "@rat-king/ratking-client/name";
import { runCommand } from "@rat-king/ratking-client/process";
import { Inbox, NotDelivered } from "@rat-king/ratking-client/ratking";
import {
  HeartbeatJson,
  readerVerdict,
} from "@rat-king/ratking-client/reader-health";
import { SecretStore } from "@rat-king/ratking-client/secrets";
import {
  Clock,
  DateTime,
  Effect,
  FileSystem,
  Option,
  Path,
  Redacted,
  Schema,
} from "effect";
import { Argument, Command } from "effect/cli";

import { Header } from "../../../packages/pi-ratking/src/ui/header.ts";
import { Party } from "../../../packages/pi-ratking/src/ui/party.ts";
import { Text, oneLine } from "../../../packages/pi-ratking/src/ui/text.ts";
import { conclude, commonFlags } from "./session.ts";

const plain = {
  bold: (text: string) => text,
  fg: (_colour: string, text: string) => text,
};

const at = (time: number | null) =>
  time === null ? "unknown" : DateTime.formatIso(DateTime.makeUnsafe(time));

export const healthScreen = (
  name: string,
  facts: HealthFacts,
  now: number,
  width = 80,
  reader: string = facts.reader,
  pane = "unknown (not observed locally)",
  turn = "unknown (encrypted or absent)"
) => {
  const { lease } = facts;
  const wake = facts.oldestWake;

  return [
    Header({
      party: Party({ name, theme: plain }),
      theme: plain,
      variant: "call",
      verb: "health",
    }),
    `lease: ${lease === null ? "unknown" : lease.holder}`,
    `generation: ${lease?.generation ?? "unknown"}`,
    `expires: ${at(lease?.expiresAt ?? null)}`,
    `reader: ${reader}`,
    `last ack: ${at(facts.lastAck)}`,
    `oldest wake: ${wake === null ? "none observed" : `${wake.id} · ${Math.max(0, Math.floor((now - wake.at) / 1000))}s`}`,
    `sender: ${wake?.sender ?? "none observed"}`,
    `quiet copies unacked: ${facts.complete ? "" : ">="}${facts.quietUnacked}${facts.complete ? "" : " (incomplete)"}`,
    `last turn: ${turn}`,
    `pane: ${pane}`,
    `verdict: ${healthVerdict(facts, now)}`,
  ].map((text) => Text({ text: oneLine(text), width }));
};

export const healthCommand = Command.make(
  "health",
  {
    ...commonFlags,
    name: Argument.String("name"),
  },
  (args) =>
    conclude(
      "health",
      args,
      Effect.gen(function* health() {
        const settings = yield* Settings;
        const inbox = yield* Inbox;
        const located = yield* inbox.locate(args.name);

        const signer = yield* inbox.locate(
          Option.getOrElse(args.as, () => "operator")
        );

        const store = yield* SecretStore;

        const identity = yield* Schema.decodeEffect(
          Schema.fromJsonString(Identity)
        )(Redacted.value(yield* store.lease(signer.secret)));

        if (identity.did !== signer.did) {
          return yield* new NotDelivered({
            code: "NoIdentity",
            reason: "Health key does not match the requested name",
          });
        }

        const client = yield* prepare({
          endpoint: settings.endpoint,
          own: yield* ownIdentity(identity),
          peers: [],
          serviceDid: settings.serviceDid,
        });

        const mailbox = yield* client.health(located.did, located.name).pipe(
          Effect.orElseSucceed(() => ({
            complete: false,
            lastAck: null,
            lease: null,
            oldestWake: null,
            quietUnacked: 0,
          }))
        );

        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const now = yield* Clock.currentTimeMillis;

        const beat = yield* fs
          .readFileString(
            path.join(
              settings.state,
              "readers",
              `${provisionLabel(located.name)}.json`
            )
          )
          .pipe(
            Effect.flatMap(Schema.decodeEffect(HeartbeatJson)),
            Effect.option
          );

        const local = beat.pipe(
          Option.filter(
            (value) =>
              value.name === located.name &&
              value.session === mailbox.lease?.holder &&
              value.generation === mailbox.lease?.generation
          )
        );

        const alive = Option.isSome(local)
          ? yield* Effect.try({
              catch: () => false,
              try: () => process.kill(local.value.pid, 0),
            }).pipe(Effect.orElseSucceed(() => false))
          : false;

        const reader = Option.match(local, {
          onNone: () => "unknown" as const,
          onSome: (value) => {
            const verdict = readerVerdict(value, alive, now);

            return verdict === "stale" ? "unknown" : verdict;
          },
        });

        const facts = { ...mailbox, reader };

        const readerDetail = Option.match(local, {
          onNone: () => "unknown (no heartbeat matching lease on this machine)",
          onSome: (value) =>
            `${value.state} · ${reader} · updated ${at(DateTime.toEpochMillis(value.updatedAt))}`,
        });

        const turn =
          mailbox.lease === null
            ? null
            : yield* client
                .turnHealth(located.did, located.name, mailbox.lease.holder)
                .pipe(Effect.orElseSucceed(() => null));

        const turnDetail =
          turn === null
            ? "unknown (encrypted or absent)"
            : `${turn.state} · ${turn.at} · ${turn.turnId}`;

        const pane =
          Option.isNone(local) ||
          mailbox.lease?.pane === null ||
          mailbox.lease === null
            ? null
            : yield* runCommand([
                "herdr",
                "pane",
                "get",
                mailbox.lease.pane,
              ]).pipe(
                Effect.timeout("3 seconds"),
                Effect.flatMap((result) =>
                  Schema.decodeEffect(
                    Schema.fromJsonString(
                      Schema.Struct({
                        result: Schema.Struct({
                          pane: Schema.Struct({
                            agent_status: Schema.String,
                            pane_id: Schema.String,
                          }),
                        }),
                      })
                    )
                  )(result.stdout)
                ),
                Effect.orElseSucceed(() => null)
              );

        const paneDetail =
          pane === null
            ? "unknown (not observed locally)"
            : `${pane.result.pane.pane_id} · ${pane.result.pane.agent_status}`;

        return {
          document: {
            name: located.name,
            ...facts,
            pane: paneDetail,
            turn,
            verdict: healthVerdict(facts, now),
          },
          lines: healthScreen(
            located.name,
            facts,
            now,
            80,
            readerDetail,
            paneDetail,
            turnDetail
          ),
        };
      }).pipe(
        Effect.scoped,
        Effect.orElseSucceed(() => {
          const facts: HealthFacts = {
            complete: false,
            lastAck: null,
            lease: null,
            oldestWake: null,
            quietUnacked: 0,
            reader: "unknown",
            unavailable: "operator credentials or observations unavailable",
          };

          return {
            document: {
              name: args.name,
              ...facts,
              verdict: healthVerdict(facts, 0),
            },
            lines: healthScreen(args.name, facts, 0),
          };
        })
      )
    )
).pipe(
  Command.withDescription(
    "Read lease, reader and delivered wake health. Uses operator credentials by default (--as to override). Never takes a lease or acknowledges mail."
  )
);
