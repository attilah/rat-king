import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { ruleVerdict } from "@rat-king/ratking-client/attend";
import {
  attentionReader,
  countFilterHit,
  filterHits,
} from "@rat-king/ratking-client/attention";
import { RatKing } from "@rat-king/ratking-client/ratking";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import {
  defaultPreferences,
  defaultStatus,
} from "../../mailbox-client/src/attention.ts";
import { resultView } from "../src/tool-view.ts";
import { runAction } from "../src/tool.ts";
import { harness } from "./harness.ts";
import { ansiTheme, assertFits } from "./view-arbitraries.ts";

it.effect.prop(
  "tool filters preserve preferences, reject invalid writes, persist private local hits and render list at width 60",
  [Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: 1 }))],
  ([count]) =>
    Effect.gen(function* toolProof() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      let prefs = defaultPreferences();
      let writes = 0;

      const reader = yield* attentionReader(
        true,
        Effect.succeed({
          getPreferences: () => Effect.succeed(prefs),
          getStatus: () => Effect.succeed(defaultStatus()),
          putPreferences: (value) =>
            Effect.sync(() => {
              prefs = value;
              writes += 1;

              return value;
            }),
          putStatus: () => Effect.die("Filter must not write status"),
        })
      );

      const layer = Layer.merge(
        harness(
          state,
          HttpClient.make(() => Effect.die("Unexpected HTTP"))
        ),
        Layer.mock(RatKing, { attention: reader.change })
      );

      const rule = {
        id: "quiet-fleet",
        match: { from: "fleet/*" },
        route: "quiet",
        until: "2030-01-01T00:00:00Z",
      };

      const original = prefs;

      yield* Effect.gen(function* operations() {
        const added = yield* runAction("ratking", 1000, {
          action: "filter",
          op: "add",
          rule,
        });

        expect(added.details.error).not.toBe(true);
        expect(writes).toBe(1);

        const verdict = ruleVerdict(
          { from: "fleet/worker", kind: "message", verified: true },
          prefs.rules,
          0
        );

        yield* Effect.forEach(Array.from({ length: count }), () =>
          countFilterHit(verdict)
        );
        expect(yield* filterHits).toEqual({ "quiet-fleet": count });
        const file = `${state}/filters/hits.json`;
        expect((yield* fs.stat(`${state}/filters`)).mode % 0o1000).toBe(0o700);
        expect((yield* fs.stat(file)).mode % 0o1000).toBe(0o600);
        const context = yield* Effect.context<Layer.Success<typeof layer>>();

        const listed = yield* runAction(
          "ratking",
          1000,
          { action: "filter", op: "list" },
          undefined,
          filterHits.pipe(Effect.provideContext(context))
        );

        expect(writes).toBe(1);
        expect(listed.text).toContain(`hits ${count}`);
        expect(JSON.stringify(prefs)).not.toContain("hits");

        const capture = resultView(
          {
            action: "filter",
            details: listed.details,
            expanded: true,
            isError: false,
            isPartial: false,
            text: listed.text.replace(`hits ${count}`, "hits 1"),
          },
          ansiTheme
        ).render(60);

        assertFits(capture, 60);
        expect(capture.map(stripTerminalSequences).join("\n"))
          .toMatchInlineSnapshot(`
          "✓   filters · 1/32 · local hits
              quiet-fleet · quiet · hits 1
                until 2030-01-01T00:00:00Z
                match {"from":"fleet/*"}"
        `);

        const invalid = yield* runAction("ratking", 1000, {
          action: "filter",
          op: "add",
          rule: { ...rule, route: "digest" },
        });

        expect(invalid.details.error).toBe(true);
        expect(writes).toBe(1);
        yield* runAction("ratking", 1000, {
          action: "filter",
          id: rule.id,
          op: "remove",
        });
        const { rules: _rules, ...rest } = prefs;
        expect(rest).toEqual(original);
        expect(prefs.rules).toEqual([]);
        expect(writes).toBe(2);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 5 } }
);
