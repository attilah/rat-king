/* oxlint-disable typescript/promise-function-async, promise/prefer-await-to-callbacks -- fast-check commands and asyncModelRun are Promise boundaries; Effect HttpClient test adapter. */
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Defs from "@rat-king/lexicon/defs";
import { layer, RatKingMailbox } from "@rat-king/mailbox-client";
import {
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Predicate,
  Redacted,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { render, scriptSend, SendBackoff } from "../../../stacks/nest/send.ts";
import { document, identity } from "../../mailbox-client/test/identity.ts";
import { Settings } from "../src/config.ts";
import { Directory, directoryLayer } from "../src/directory.ts";
import { AgentName, didFor, nameFor } from "../src/name.ts";
import { PayloadJson } from "../src/payload.ts";
import { SecretStore } from "../src/secrets.ts";

const TEMPLATE = "did:web:{agent}.agents.example.invalid";

const SENDER = "acme/alert-cron";

const SECRET = "rat_king_script_acme-alert-cron_identity";

const ENDPOINT = "https://mailbox.example.invalid";

const SERVICE = "did:web:mailbox.example.invalid";

const Printed = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, seq: Schema.Int, to: Schema.String })
);

const ALLOWED = new Set([
  "sh.mschf.ratking.mailbox.getPeerDocument",
  "sh.mschf.ratking.mailbox.send",
]);

const Peer = Schema.Literals(["alpha", "beta", "proj/gamma"]);

const Name = Schema.Literals(["alpha", "beta", "proj/gamma", "ghost"]);

const Step = Schema.Union([
  Schema.TaggedStruct("Send", {
    cc: Schema.Array(Name).check(Schema.isMaxLength(2)),
    to: Name,
  }),
  Schema.TaggedStruct("Retire", {
    name: Peer,
    successor: Schema.Literals(["acme/desk-2", "proj/row-9"]),
  }),
  Schema.TaggedStruct("Outage", { down: Schema.Boolean }),
]);

type StepValue = typeof Step.Type;

interface Model {
  readonly cached: Set<string>;
  readonly retired: Map<string, string>;
  down: boolean;
  seq: number;
}

interface Server {
  readonly retired: Map<string, string>;
  down: boolean;
  seq: number;
  readonly nsids: Set<string>;
  readonly envelopes: Defs.EncryptedEnvelopeValue[];
}

type Expected =
  | { readonly exit: 0; readonly to: string; readonly seq: number }
  | { readonly exit: 2; readonly code: string; readonly mention: string }
  | {
      readonly exit: 3;
      readonly mention: string;
      readonly sent: boolean;
    };

const expectSend = (
  model: Model,
  to: string,
  cc: readonly string[]
): Expected => {
  const names = [...new Set([to, ...cc])];

  for (const name of names) {
    if (!model.cached.has(name)) {
      if (model.down) {
        return { exit: 3, mention: name, sent: false };
      }

      if (name === "ghost") {
        return { code: "UnknownName", exit: 2, mention: "ghost" };
      }

      model.cached.add(name);
    }
  }

  const accepted: string[] = [];
  let first = 0;

  for (const name of names) {
    if (model.down) {
      return {
        exit: 3,
        mention: accepted[0] ?? "Admission not confirmed",
        sent: true,
      };
    }

    const successor = model.retired.get(name);

    if (successor !== undefined) {
      return accepted.length === 0
        ? { code: "Retired", exit: 2, mention: `current row is ${successor}` }
        : { code: "Partial", exit: 2, mention: `Accepted by ${accepted[0]}` };
    }

    model.seq += 1;
    first = first === 0 ? model.seq : first;
    accepted.push(name);
  }

  return { exit: 0, seq: first, to };
};

const fakeMailbox = (
  server: Server,
  documents: ReadonlyMap<string, Defs.DidDocumentValue>
) =>
  HttpClient.make((request) =>
    Effect.gen(function* mailbox() {
      const url = new URL(request.url);
      const nsid = url.pathname.split("/").at(-1) ?? "";
      server.nsids.add(nsid);

      if (server.down) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({ error: "MailboxUnavailable" }, { status: 503 })
        );
      }

      if (nsid === "sh.mschf.ratking.mailbox.getPeerDocument") {
        const found = documents.get(url.searchParams.get("did") ?? "");

        return HttpClientResponse.fromWeb(
          request,
          found === undefined
            ? Response.json({ error: "NotFound" }, { status: 404 })
            : Response.json({ document: found })
        );
      }

      if (!Predicate.isTagged(request.body, "Uint8Array")) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({ error: "InvalidRequest" }, { status: 400 })
        );
      }

      const input = yield* Schema.decodeEffect(
        Schema.fromJsonString(
          Schema.Struct({
            envelope: Defs.EncryptedEnvelope,
            leaseId: Schema.optionalKey(Schema.String),
          })
        )
      )(new TextDecoder().decode(request.body.body));

      expect(input.leaseId).toBeUndefined();
      const { recipientDid } = input.envelope.aad;
      const successor = server.retired.get(recipientDid);

      if (successor !== undefined) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            {
              error: "Retired",
              message: `name was retired at 2026-01-01T00:00:00.000Z; current row is ${successor}`,
            },
            { status: 410 }
          )
        );
      }

      server.seq += 1;
      server.envelopes.push(input.envelope);

      return HttpClientResponse.fromWeb(
        request,
        Response.json({
          receipt: {
            message: {
              messageId: input.envelope.aad.messageId,
              senderDid: input.envelope.aad.senderDid,
            },
            recipientDid,
            seq: server.seq,
            state: "accepted",
          },
        })
      );
    }).pipe(Effect.orDie)
  );

it.live.prop(
  "a script send prints {id, seq, to} and exits 0 when delivered, exits 2 naming the refusal (and the successor of a retired name), exits 3 when transport fails, and never presents a lease",
  [Schema.Array(Step).check(Schema.isMaxLength(8))],
  ([steps]) =>
    Effect.gen(function* scriptSendModel() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const did = (name: string) => didFor(TEMPLATE, {}, name);
      const sender = yield* identity(did(SENDER));
      const peers = new Map<string, typeof sender>();
      const documents = new Map<string, Defs.DidDocumentValue>();

      for (const name of Peer.literals) {
        const peer = yield* identity(did(name));
        peers.set(name, peer);
        documents.set(peer.did, yield* document(peer));
      }

      documents.set(sender.did, yield* document(sender));

      const server: Server = {
        down: false,
        envelopes: [],
        nsids: new Set(),
        retired: new Map(),
        seq: 0,
      };

      const services = Layer.mergeAll(
        directoryLayer,
        Layer.succeed(
          SecretStore,
          SecretStore.of({
            add: () => Effect.void,
            exists: (name) => Effect.succeed(name === SECRET),
            lease: () => Effect.succeed(Redacted.make(JSON.stringify(sender))),
          })
        ),
        Layer.succeed(HttpClient.HttpClient, fakeMailbox(server, documents)),
        Layer.succeed(SendBackoff, () => Duration.zero)
      ).pipe(
        Layer.provideMerge(
          Layer.succeed(
            Settings,
            Settings.of({
              askTimeoutMs: 1000,
              didTemplate: TEMPLATE,
              directory: `${state}/directory.json`,
              documents: [],
              encrypt: false,
              endpoint: ENDPOINT,
              issuer: Option.none(),
              refuse: [],
              relays: [],
              reserved: {},
              secretsCommand: "secrets",
              serviceDid: SERVICE,
              state,
            })
          )
        ),
        Layer.provideMerge(NodeServices.layer)
      );

      const context = yield* Layer.build(services);
      const outer = yield* Effect.context();

      const alpha = yield* document(peers.get("alpha") ?? sender);

      yield* Directory.use((directory) =>
        directory.record("alpha", alpha)
      ).pipe(Effect.provide(context));

      const open = (envelope: Defs.EncryptedEnvelopeValue, name: string) =>
        RatKingMailbox.use((mailbox) => mailbox.open(envelope)).pipe(
          Effect.provide(
            layer({
              documents: [...documents.values()],
              endpoint: ENDPOINT,
              identity: peers.get(name) ?? sender,
              serviceDid: SERVICE,
            })
          ),
          Effect.provide(context)
        );

      const command = (step: StepValue): AsyncCommand<Model, Server> => ({
        check: () => true,
        run: (model, real) => {
          const operation = Effect.gen(function* stepCommand() {
            if (Predicate.isTagged(step, "Retire")) {
              model.retired.set(step.name, step.successor);
              real.retired.set(did(step.name), step.successor);

              return;
            }

            if (Predicate.isTagged(step, "Outage")) {
              model.down = step.down;
              real.down = step.down;

              return;
            }

            const before = real.envelopes.length;
            const expected = expectSend(model, step.to, step.cc);

            const shown = render(
              yield* scriptSend({
                as: SECRET,
                body: "disk 91% on the example host",
                cc: step.cc,
                summary: "disk alarm",
                to: step.to,
              }).pipe(Effect.provide(context))
            );

            expect(shown.code).toBe(expected.exit);

            if (expected.exit === 0) {
              const printed = yield* Schema.decodeEffect(Printed)(
                shown.stdout ?? ""
              );

              expect(printed).toMatchObject({
                seq: expected.seq,
                to: expected.to,
              });

              const envelope = real.envelopes[before];

              if (envelope === undefined) {
                throw new Error("Delivered without an admitted envelope");
              }

              expect(envelope.aad.messageId).toBe(printed.id);

              const payload = yield* Schema.decodeEffect(PayloadJson)(
                (yield* open(envelope, expected.to)).body
              );

              expect(payload).toMatchObject({
                from: SENDER,
                summary: "disk alarm",
                thread: printed.id,
                to: expected.to,
              });
            } else if (expected.exit === 2) {
              expect(shown.stderr).toMatch(
                new RegExp(`^NOT DELIVERED: ${expected.code}\\. `, "u")
              );
              expect(shown.stderr).toContain(expected.mention);
            } else {
              expect(shown.stderr).toMatch(
                expected.sent ? /^UNCERTAIN: /u : /^NOT SENT: /u
              );
              expect(shown.stderr).toContain(expected.mention);
            }

            expect(real.seq).toBe(model.seq);
            expect(
              [...real.nsids].filter((nsid) => !ALLOWED.has(nsid))
            ).toEqual([]);
          });

          // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- asyncModelRun needs a Promise per command; reuse the test services.
          return Effect.runPromiseWith(outer)(operation);
        },
        toString: () => JSON.stringify(step),
      });

      yield* Effect.promise(() =>
        asyncModelRun(
          () => ({
            model: {
              cached: new Set(["alpha"]),
              down: false,
              retired: new Map(),
              seq: 0,
            },
            real: server,
          }),
          steps.map(command)
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 25 }, timeout: 120_000 }
);

it.prop(
  "a send-only identity's name is the one its DID was minted for",
  [AgentName],
  ([name]) => {
    expect(nameFor(TEMPLATE, {}, didFor(TEMPLATE, {}, name))).toEqual(
      Option.some(name)
    );
  }
);
