import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { listView } from "@rat-king/ratking-client/directory-view";
import { forkName } from "@rat-king/ratking-client/fork";
import { AgentName } from "@rat-king/ratking-client/name";
import { Arbitrary, Effect } from "effect";
import { expect } from "vitest";

import { resultView } from "../src/tool-view.ts";
import { themes } from "./inline-fixtures.ts";

it.effect.prop(
  "directory list labels the child unambiguously and stays within TUI widths",
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

      expect(view.text).toContain(`${fork} (child of ${name})`);
      expect(view.text).not.toContain("→");

      for (const { theme } of themes) {
        for (const width of [40, 60, 80, 120]) {
          for (const expanded of [false, true]) {
            const lines = resultView(
              {
                action: "list",
                details: {},
                expanded,
                isError: false,
                isPartial: false,
                text: view.text,
              },
              theme
            ).render(width);

            for (const line of lines) {
              expect(visibleWidth(line)).toBeLessThanOrEqual(width);
            }

            expect(lines.map(stripTerminalSequences).join("\n")).not.toContain(
              "→"
            );
          }
        }
      }
    })
);
