import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import { nameFor, secretName } from "@rat-king/ratking-client/name";
import { RatKing, ReaderState } from "@rat-king/ratking-client/ratking";
import {
  Arbitrary,
  ConfigProvider,
  Duration,
  Effect,
  FileSystem,
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

it.live(
  "a desk send from a nameless Pi reaches the recipient as the desk, with no marker of the Pi behind it",
  () =>
    Effect.gen(function* attribution() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();

      const deskIdentity = yield* identity(
        "did:web:desk.agents.example.invalid"
      );

      const peer = yield* identity("did:web:peer.agents.example.invalid");

      const submitted: string[] = [];

      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          if (
            request.url.endsWith("sh.mschf.ratking.mailbox.send") &&
            Predicate.isTagged(request.body, "Uint8Array")
          ) {
            submitted.push(new TextDecoder().decode(request.body.body));
          }

          return HttpClientResponse.fromWeb(
            request,
            Response.json({ error: "Conflict" }, { status: 409 })
          );
        })
      );

      yield* Effect.gen(function* run() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record(DESK, yield* document(deskIdentity));
        yield* directory.record("peer", yield* document(peer));
        yield* ratking.run(
          { ...facts, owner: Option.some(DESK) },
          () => Effect.void
        );
        yield* ratking.send("peer", "hello").pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          harness(state, http, [], {
            secrets: new Map([[DESK_KEY, JSON.stringify(deskIdentity)]]),
          })
        )
      );

      const [body] = submitted;

      expect(submitted).toHaveLength(1);

      const sender = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({
            envelope: Schema.Struct({
              aad: Schema.Struct({ senderDid: Schema.String }),
            }),
          })
        )
      )(body);

      expect(sender.envelope.aad.senderDid).toBe(deskIdentity.did);
      expect(
        nameFor(
          "did:web:{agent}.agents.example.invalid",
          {},
          sender.envelope.aad.senderDid
        )
      ).toEqual(Option.some(DESK));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
