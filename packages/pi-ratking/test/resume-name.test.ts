import { createEventBus } from "@earendil-works/pi-coding-agent";
// @effect-diagnostics asyncFunction:off -- Pi's extension API is the Promise boundary under test.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { AgentName } from "@rat-king/ratking-client/name";
import { RatKing, ReaderState } from "@rat-king/ratking-client/ratking";
import {
  Arbitrary,
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import { collectFacts, ratkingExtension } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { chooseName } from "../src/name.ts";
import type { NameEntryValue } from "../src/name.ts";
import { quietSocket } from "./fake-mailbox.ts";
import { harness } from "./harness.ts";
import { startSession } from "./start-session.ts";

interface Hooks {
  started?: (start: SessionStart) => Promise<void>;
}

const Session = Schema.String.check(Schema.isPattern(/^[a-f0-9]{8}$/u));

const Names = Schema.Struct({
  other: AgentName,
  parent: AgentName,
}).check(Schema.makeFilter((names) => names.other !== names.parent));

it.effect.prop(
  "a restart-born session resumed with its parent's env name keeps its own recorded name",
  [Arbitrary.schema(Names), Arbitrary.schema(Session)],
  ([{ other, parent }, session]) =>
    Effect.sync(() => {
      const parentSession = `${session}-parent`;

      const entries: readonly NameEntryValue[] = [
        { name: parent, source: "env" },
        {
          name: other,
          parent: { name: parent, session: parentSession },
          session,
          source: "forked",
        },
      ];

      expect(
        chooseName({
          entries,
          env: Option.some(parent),
          parentSession,
          session,
        })
      ).toEqual({
        name: Option.some(other),
        parent: { name: parent, session: parentSession },
        source: "restored",
      });
      expect(
        chooseName({ entries, env: Option.none(), parentSession, session })
          .source
      ).toBe("restored");
    })
);

it.effect.prop(
  "a resume with a different env name takes the env name",
  [Arbitrary.schema(Names), Arbitrary.schema(Session)],
  ([{ other, parent }, session]) =>
    Effect.sync(() => {
      expect(
        chooseName({
          entries: [{ name: other, session, source: "restored" }],
          env: Option.some(parent),
          parentSession: `${session}-parent`,
          session,
        })
      ).toEqual({ name: Option.some(parent), source: "env" });
    })
);

it.effect.prop(
  "a true fork with no entry of its own still derives from the parent",
  [Arbitrary.schema(Names), Arbitrary.schema(Session)],
  ([{ parent }, session]) =>
    Effect.sync(() => {
      const parentSession = `${session}-parent`;

      const choice = chooseName({
        entries: [{ name: parent, session: parentSession, source: "env" }],
        env: Option.some(parent),
        parentSession,
        session,
      });

      expect(choice.source).toBe("forked");
      expect(choice.parent).toEqual({ name: parent, session: parentSession });
    })
);

it("the recorded 10-15 desk evidence resumes as muster/desk", () => {
  const choice = chooseName({
    entries: [
      { name: "muster/desk", source: "env" },
      {
        name: "muster/desk",
        session: "desk-20261015T033000-9d97b522",
        source: "env",
      },
    ],
    env: Option.some("muster/desk"),
    parentSession: "desk-20261015T005548-eec68a62",
    session: "desk-20261015T033000-9d97b522",
  });

  expect(choice).toEqual({
    name: Option.some("muster/desk"),
    source: "restored",
  });
});

it.live(
  "the first start of a restart-born session records its name with its own session once",
  () =>
    Effect.gen(function* firstStart() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const store: NameEntryValue[] = [];
      const hooks: Hooks = {};

      const layer = Layer.mergeAll(
        harness(
          state,
          HttpClient.make(() => Effect.die("Unexpected HTTP"))
        ),
        quietSocket,
        Layer.mock(RatKing, {
          run: (facts) =>
            Effect.sync(() => {
              const name = Option.getOrElse(facts.env, () => "pi-default");

              facts.onState?.(
                ReaderState.Live({
                  did: "did:web:x.invalid",
                  expiresAt: "2099-01-01T00:00:00.000Z",
                  generation: 1,
                  name,
                })
              );
            }),
        })
      );

      const pi: PiHost = {
        events: createEventBus(),
        onSessionEnd: () => {},
        onSessionStart: (handler) => {
          hooks.started = handler;
        },
        registerMessageRenderer: () => {},
        registerTool: () => {},
        sendMessage: () => {},
      };

      yield* Effect.promise(async () => {
        await ratkingExtension({
          facts: (id, label, interactive, entries, parentSession) =>
            collectFacts(id, label, interactive, entries, parentSession).pipe(
              Effect.provide(
                ConfigProvider.layer(
                  ConfigProvider.fromEnv({
                    env: {
                      RATKING_NAME: "muster/desk",
                      RATKING_SUCCEEDS: "parent-1",
                    },
                  })
                )
              )
            ),
          layer,
          tool: Effect.succeed("ratking"),
        })(pi);

        const { started } = hooks;

        if (started === undefined) {
          throw new Error("session_start was not registered");
        }

        await startSession(started, {
          interactive: true,
          names: [{ name: "muster/desk", source: "env" }],
          parentSession: "parent-1",
          rememberName: (entry) => {
            store.push(entry);
          },
          session: "child-1",
          status: () => {},
          warn: () => {},
        });
      });

      expect(store).toEqual([
        { name: "muster/desk", session: "child-1", source: "env" },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
