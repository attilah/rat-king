import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { forkName } from "@rat-king/ratking-client/fork";
import { AgentName } from "@rat-king/ratking-client/name";
import {
  Arbitrary,
  ConfigProvider,
  Effect,
  FileSystem,
  Option,
  Result,
  Schema,
} from "effect";
import { expect } from "vitest";

import { collectFacts } from "../src/extension.ts";
import { chooseName } from "../src/name.ts";
import { parentSessionId } from "../src/session-parent.ts";

const Session = Schema.String.check(Schema.isPattern(/^[a-f0-9]{8}$/u));

it.effect.prop(
  "scoped names restore only in their session, including a same-id snapshot restart",
  [
    Arbitrary.schema(AgentName),
    Arbitrary.schema(Session),
    Arbitrary.schema(Schema.Boolean),
  ],
  ([name, session, snapshot]) =>
    Effect.sync(() => {
      const choice = chooseName({
        entries: [{ name, session, source: "env" }],
        env: Option.none(),
        parentSession: snapshot ? session : undefined,
        session,
      });

      expect(choice).toEqual({ name: Option.some(name), source: "restored" });
      expect(
        chooseName({
          entries: [{ name, session: `${session}-other`, source: "env" }],
          env: Option.none(),
          session,
        })
      ).toEqual({ name: Option.none(), source: "default" });
    })
);

it.effect.prop(
  "legacy fork entries become a derived identity, inherited env cannot seize the parent",
  [Arbitrary.schema(AgentName), Arbitrary.schema(Session)],
  ([name, session]) =>
    Effect.sync(() => {
      const parentSession = `${session}-parent`;

      const choice = chooseName({
        entries: [{ name, source: "env" }],
        env: Option.some(name),
        label: "Review",
        parentSession,
        session,
      });

      expect(choice.source).toBe("forked");
      expect(choice.parent).toEqual({ name, session: parentSession });
      expect(choice.name).not.toEqual(Option.some(name));
      expect(
        chooseName({
          entries: [{ name, source: "env" }],
          env: Option.none(),
          parentSession: session,
          session,
        })
      ).toEqual({ name: Option.some(name), source: "restored" });
    })
);

it.effect.prop(
  "fork naming preserves one slash, caps rows at 32 and salts collisions with the session",
  [
    Arbitrary.schema(AgentName),
    Arbitrary.schema(Session),
    Arbitrary.schema(Schema.String),
  ],
  ([name, session, label]) =>
    Effect.sync(() => {
      const fork = { label, parent: { name, session: "parent" } };
      const free = forkName(fork, session);
      const collided = forkName(fork, session, () => true);

      expect(Schema.is(AgentName)(free)).toBe(true);
      expect(Schema.is(AgentName)(collided)).toBe(true);
      expect(free.split("/").length).toBeLessThanOrEqual(2);
      expect((free.split("/").at(-1) ?? "").length).toBeLessThanOrEqual(32);
      expect((collided.split("/").at(-1) ?? "").length).toBeLessThanOrEqual(32);
      expect(collided).toMatch(/-[a-f0-9]{4}$/u);
      expect(collided).not.toBe(free);

      const flat = forkName(
        { label, parent: { name: "desk_aux", session: "parent" } },
        session
      );

      const nested = forkName(
        { label, parent: { name: "desk-aux", session: "parent" } },
        session
      );

      expect(flat).toMatch(/^desk_aux-/u);
      expect(nested).toMatch(/^desk-aux\//u);
      expect(flat).not.toBe(nested);
      expect(
        forkName(
          {
            label: "Review",
            parent: { name: "switchboard", session: "parent" },
          },
          session
        )
      ).toBe("switchboard/review");
      expect(
        forkName(
          {
            label: "Review",
            parent: { name: "project/row", session: "parent" },
          },
          session
        )
      ).toBe("project/row-review");
    })
);

it.effect.prop(
  "a recorded fork resumes its own identity and parent rather than deriving a second name",
  [Arbitrary.schema(Session)],
  ([session]) =>
    Effect.sync(() => {
      const parent = { name: "switchboard", session: "parent" };

      const choice = chooseName({
        entries: [
          { name: "switchboard", session: "parent", source: "env" },
          { name: "switchboard/review", parent, session, source: "forked" },
        ],
        env: Option.none(),
        parentSession: "parent",
        session,
      });

      expect(choice).toEqual({
        name: Option.some("switchboard/review"),
        parent,
        source: "restored",
      });
    })
);

it.effect.prop(
  "Pi header id distinguishes a legacy fork from a snapshot restart",
  [Arbitrary.schema(Session)],
  ([session]) =>
    Effect.gen(function* proof() {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const file = `${dir}/parent.jsonl`;

      yield* fs.writeFileString(
        file,
        `${JSON.stringify({ id: session, type: "session" })}\n{}\n`
      );
      expect(yield* parentSessionId(file)).toEqual(Option.some(session));
      yield* fs.writeFileString(file, "broken");
      expect(
        Result.isFailure(yield* parentSessionId(file).pipe(Effect.result))
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "configured fork label wins over the Pi session name and off disables identity",
  [Arbitrary.schema(Session)],
  ([session]) =>
    Effect.gen(function* proof() {
      const facts = yield* collectFacts(
        session,
        () => "Other Label",
        true,
        [{ name: "switchboard", source: "env" }],
        "parent"
      ).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ RATKING_FORK_LABEL: "Chosen Label" })
          )
        )
      );

      expect(facts.env).toEqual(Option.some("switchboard/chosen-label"));
      expect(facts.source).toBe("forked");

      const named = yield* collectFacts(
        session,
        () => "Named Review",
        true,
        [{ name: "switchboard", source: "env" }],
        "parent"
      ).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))
      );

      const fallback = yield* collectFacts(
        "abcdef1234",
        () => {},
        true,
        [{ name: "switchboard", source: "env" }],
        "parent"
      ).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))
      );

      expect(named.env).toEqual(Option.some("switchboard/named-review"));
      expect(fallback.env).toEqual(Option.some("switchboard/fork-abcdef"));

      const disabled = yield* collectFacts(session).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ RATKING_NAME: "off" })
          )
        )
      );

      expect(disabled.disabled).toBe(true);
    })
);
