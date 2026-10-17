import { it } from "@effect/vitest";
import { listView } from "@rat-king/ratking-client/directory-view";
import { forkName } from "@rat-king/ratking-client/fork";
import { AgentName } from "@rat-king/ratking-client/name";
import { Arbitrary, Effect } from "effect";
import { expect } from "vitest";

it.effect.prop(
  "directory list renders the parent to fork link",
  [Arbitrary.schema(AgentName)],
  ([name]) =>
    Effect.sync(() => {
      const parent = { name, session: "parent-session" };
      const fork = forkName({ label: "review", parent }, "abcdef");

      const view = listView(
        [
          {
            aliases: [],
            did: "did:web:fork.example.invalid",
            name: fork,
            parent,
            reserved: false,
          },
        ],
        undefined,
        { all: true }
      );

      expect(view.text).toContain(`${name} → ${fork}`);
    })
);
