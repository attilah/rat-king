import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Defs from "@rat-king/lexicon/defs";
import { layer, RatKingMailbox } from "@rat-king/mailbox-client";
import { Directory } from "@rat-king/ratking-client/directory";
import { secretName } from "@rat-king/ratking-client/name";
import { PayloadJson } from "@rat-king/ratking-client/payload";
import { RatKing, ReaderState } from "@rat-king/ratking-client/ratking";
import {
  Arbitrary,
  ConfigProvider,
  Duration,
  Effect,
  FileSystem,
  Path,
  Match,
  Option,
  Predicate,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { expect } from "vitest";

import { document, identity } from "../../mailbox-client/test/identity.ts";
import { collectFacts } from "../src/extension.ts";
import type { NameEntryValue } from "../src/name.ts";
import { harness } from "./harness.ts";

const DESK = "desk";

const DESK_KEY = secretName(DESK);

const facts = {
  alive: () => false,
  env: Option.none<string>(),
  nameless: true,
  pane: Option.none<string>(),
  pid: 1,
  session: "nameless-session",
};

const Env = Schema.Struct({
  RATKING_NAME: Schema.optionalKey(Schema.Literal("alpha")),
  RATKING_PRINT_NAME: Schema.optionalKey(Schema.Literal("beta")),
});

const nobody = HttpClient.make(() => Effect.die("Unexpected HTTP"));

it.effect.prop(
  "a Pi gets a name only from an explicit setting, whether interactive or headless",
  [Arbitrary.schema(Env), Arbitrary.schema(Schema.Boolean)],
  ([env, interactive]) =>
    Effect.gen(function* proof() {
      const explicit = interactive ? env.RATKING_NAME : env.RATKING_PRINT_NAME;

      const collected = yield* collectFacts(
        "any-session",
        undefined,
        interactive,
        []
      ).pipe(
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...env } }))
        )
      );

      expect(collected.nameless).toBe(explicit === undefined);
      expect(Option.getOrUndefined(collected.env)).toBe(explicit);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "a session that already holds a default name keeps it",
  [Arbitrary.schema(Schema.Boolean)],
  ([interactive]) =>
    Effect.gen(function* proof() {
      const entries: NameEntryValue[] = [
        { name: "pi-live", session: "old-session", source: "default" },
      ];

      const collected = yield* collectFacts(
        "old-session",
        undefined,
        interactive,
        entries
      ).pipe(
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))
        )
      );

      expect(collected.nameless).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.live.prop(
  "a nameless Pi mints and registers nothing; it sends as its desk when this machine holds the desk key, else refuses in three parts",
  [Arbitrary.schema(Schema.Boolean), Arbitrary.schema(Schema.Boolean)],
  ([hasOwner, holdsKey]) =>
    Effect.gen(function* proof() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const store = new Map<string, string>();

      const deskIdentity = yield* identity(
        "did:web:desk.agents.example.invalid"
      );

      if (holdsKey) {
        store.set(DESK_KEY, JSON.stringify(deskIdentity));
      }

      const before = new Map(store);

      yield* Effect.gen(function* run() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record(DESK, yield* document(deskIdentity));

        const registered = (yield* directory.list).length;

        yield* ratking.run(
          {
            ...facts,
            owner: hasOwner ? Option.some(DESK) : Option.none<string>(),
          },
          () => Effect.void
        );

        const sent = yield* ratking.send(DESK, "hello").pipe(
          Effect.flip,
          Effect.timeout(Duration.seconds(10)),
          Effect.flatMap((failure) => Effect.succeed(failure.reason)),
          Effect.catchTag("TimeoutError", () => Effect.succeed("timeout"))
        );

        const status = yield* ratking.status;

        expect(new Map(store)).toEqual(before);
        expect((yield* directory.list).length).toBe(registered);

        if (hasOwner && holdsKey) {
          expect(ReaderState.$is("SendOnly")(status.reader)).toBe(true);
          expect(status.self.pipe(Option.map((self) => self.did))).toEqual(
            Option.some(deskIdentity.did)
          );
          expect(sent).not.toContain("no Rat King name");
        } else {
          expect(ReaderState.$is("Refused")(status.reader)).toBe(true);
          expect(Option.isNone(status.self)).toBe(true);
          expect(sent).toContain("no Rat King name");
          expect(sent).toContain("dead mailboxes");
          expect(sent).toContain("RATKING_PRINT_NAME");
        }
      }).pipe(
        Effect.provide(harness(state, nobody, [], { secrets: store })),
        Effect.scoped
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  60_000
);

const SESSION = "0123456789abcdef";

const VIA = "lane (01234567)";

const LABELLED = { ...facts, session: SESSION, via: () => VIA };

interface Wire {
  readonly calls: string[];
  readonly envelopes: Defs.EncryptedEnvelopeValue[];
}

const mailbox = (wire: Wire) =>
  HttpClient.make((request) =>
    Effect.gen(function* fakeMailbox() {
      wire.calls.push(request.url);

      if (
        !request.url.endsWith("sh.mschf.ratking.mailbox.send") ||
        !Predicate.isTagged(request.body, "Uint8Array")
      ) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({ error: "MailboxUnavailable" }, { status: 503 })
        );
      }

      const input = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({ envelope: Defs.EncryptedEnvelope })
        )
      )(new TextDecoder().decode(request.body.body)).pipe(Effect.orDie);

      wire.envelopes.push(input.envelope);

      return HttpClientResponse.fromWeb(
        request,
        Response.json({
          receipt: {
            message: {
              messageId: input.envelope.aad.messageId,
              senderDid: input.envelope.aad.senderDid,
            },
            recipientDid: input.envelope.aad.recipientDid,
            seq: wire.envelopes.length,
            state: "accepted",
          },
        })
      );
    })
  );

const SUMMARY = Schema.String.check(Schema.isPattern(/^[a-z]{1,40}$/u));

it.live.prop(
  "a nameless desk send arrives from the desk, marked in body and summary as sent via the headless Pi; a named Pi's send is unmarked",
  [
    Arbitrary.schema(SUMMARY),
    Arbitrary.schema(SUMMARY),
    Arbitrary.schema(Schema.Boolean),
  ],
  ([text, summary, named]) =>
    Effect.gen(function* attribution() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const wire: Wire = { calls: [], envelopes: [] };

      const deskIdentity = yield* identity(
        "did:web:desk.agents.example.invalid"
      );

      const peer = yield* identity("did:web:peer.agents.example.invalid");

      const documents = yield* Effect.gen(function* run() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record(DESK, yield* document(deskIdentity));
        yield* directory.record("peer", yield* document(peer));
        yield* ratking.run(
          named
            ? { ...LABELLED, env: Option.some(DESK), nameless: false }
            : { ...LABELLED, owner: Option.some(DESK) },
          () => Effect.void
        );
        yield* ratking.send("peer", text, { summary });

        return yield* directory.documents;
      }).pipe(
        Effect.provide(
          harness(state, mailbox(wire), [], {
            secrets: new Map([[DESK_KEY, JSON.stringify(deskIdentity)]]),
          })
        )
      );

      const [envelope] = wire.envelopes;

      if (envelope === undefined) {
        throw new Error("Missing envelope");
      }

      const opened = yield* RatKingMailbox.use((client) =>
        client.open(envelope)
      ).pipe(
        Effect.provide(
          layer({
            documents: yield* Schema.decodeUnknownEffect(
              Schema.Array(Schema.toType(Defs.DidDocument))
            )(documents),
            endpoint: "https://mailbox.example.invalid",
            identity: peer,
            serviceDid: "did:web:mailbox.example.invalid",
          })
        ),
        Effect.provideService(HttpClient.HttpClient, mailbox(wire))
      );

      const payload = yield* Schema.decodeEffect(PayloadJson)(opened.body);

      expect(envelope.aad.senderDid).toBe(deskIdentity.did);
      expect(payload.from).toBe(DESK);
      expect(payload.body).toBe(
        named ? text : `↳ via headless Pi ${VIA}\n\n${text}`
      );
      expect(payload.summary).toBe(named ? summary : `via lane · ${summary}`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 }, timeout: 60_000 }
);

it.live.prop(
  "a nameless desk send refuses ask, reply and handled in three parts, without touching the mailbox",
  [Arbitrary.schema(Schema.Literals(["ask", "ask-kind", "reply", "handled"]))],
  ([action]) =>
    Effect.gen(function* askRefusal() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const wire: Wire = { calls: [], envelopes: [] };

      const deskIdentity = yield* identity(
        "did:web:desk.agents.example.invalid"
      );

      const failure = yield* Effect.gen(function* run() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record(DESK, yield* document(deskIdentity));
        yield* ratking.run(
          { ...LABELLED, owner: Option.some(DESK) },
          () => Effect.void
        );
        wire.calls.length = 0;

        return yield* Match.value(action).pipe(
          Match.when("ask", () => ratking.ask(DESK, "q")),
          Match.when("ask-kind", () =>
            ratking.send(DESK, "q", { kind: "ask" })
          ),
          Match.when("reply", () => ratking.reply("some-id", "a")),
          Match.orElse(() => ratking.handled("some-id")),
          Effect.flip
        );
      }).pipe(
        Effect.provide(
          harness(state, mailbox(wire), [], {
            secrets: new Map([[DESK_KEY, JSON.stringify(deskIdentity)]]),
          })
        )
      );

      const reason = Schema.is(Schema.Struct({ reason: Schema.String }))(
        failure
      )
        ? failure.reason
        : "";

      expect(reason).toContain("no Rat King name");
      expect(reason).toContain("nobody waiting");
      expect(reason).toContain("RATKING_PRINT_NAME");
      expect(wire.calls).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 8 }, timeout: 60_000 }
);

it.effect.prop(
  "the via label is the session name, else the cwd basename, then the first 8 characters of the session id",
  [Arbitrary.schema(Schema.Option(SUMMARY))],
  ([name]) =>
    Effect.gen(function* viaLabel() {
      const collected = yield* collectFacts(
        "0123456789abcdef",
        () => Option.getOrUndefined(name),
        false,
        []
      ).pipe(
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))
        )
      );

      const path = yield* Path.Path;

      expect(collected.via?.()).toBe(
        `${Option.getOrElse(name, () => path.basename(process.cwd()))} (01234567)`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
