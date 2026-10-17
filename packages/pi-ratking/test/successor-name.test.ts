import { it } from "@effect/vitest";
import { AgentName } from "@rat-king/ratking-client/name";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { expect } from "vitest";

import { chooseName } from "../src/name.ts";

const Session = Schema.String.check(Schema.isPattern(/^[a-f0-9]{8}$/u));

it.effect.prop(
  "a successor keeps its parent's env name, and a fork without the signal still derives",
  [Arbitrary.schema(AgentName), Arbitrary.schema(Session)],
  ([name, session]) =>
    Effect.sync(() => {
      const parentSession = `${session}-parent`;

      const base = {
        entries: [{ name, session: parentSession, source: "env" as const }],
        env: Option.some(name),
        label: "desk",
        parentSession,
        session,
      };

      expect(chooseName({ ...base, succeeds: parentSession })).toEqual({
        name: Option.some(name),
        source: "env",
      });
      expect(chooseName(base).source).toBe("forked");
      expect(
        chooseName({ ...base, succeeds: `${session}-unrelated` }).source
      ).toBe("forked");
    })
);

it.effect.prop(
  "a successor repairs a doubled name restored from a forked entry",
  [Arbitrary.schema(AgentName), Arbitrary.schema(Session)],
  ([name, session]) =>
    Effect.sync(() => {
      const parentSession = `${session}-parent`;

      const choice = chooseName({
        entries: [
          { name, session: parentSession, source: "env" },
          {
            name: `${name}-desk`,
            parent: { name, session: parentSession },
            session,
            source: "forked",
          },
        ],
        env: Option.some(name),
        parentSession,
        session,
        succeeds: parentSession,
      });

      expect(choice).toEqual({ name: Option.some(name), source: "env" });
    })
);
