import { it } from "@effect/vitest";
import { recipientLevels } from "@rat-king/ratking-client/delivery";
import { RatKing } from "@rat-king/ratking-client/ratking";
import { Effect, Layer, Schema } from "effect";
import { expect } from "vitest";

import { runAction } from "../src/tool.ts";

it.effect.prop(
  "A tool send to one quiet recipient projects quiet options and a no-wake receipt",
  [Schema.Boolean],
  ([quiet]) =>
    runAction("ratking", 600, {
      action: "send",
      message: "Progress only",
      quiet,
      to: "owner",
    }).pipe(
      Effect.provide(
        Layer.mock(RatKing, {
          send: (to, _body, options) => {
            expect(options?.quiet).toBe(quiet ? true : undefined);

            return Effect.succeed({
              did: "did:web:owner.agents.example.invalid",
              id: "3mxaaaaaaaaaa",
              recipients: recipientLevels(to, [], "message", options?.quiet),
              seq: 1,
              to,
            });
          },
        })
      ),
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.isError).toBe(false);

          if (quiet) {
            expect(result.text).toContain("owner: quiet copy, no wake");
            expect(result.text).not.toContain("woken");
          }
        })
      )
    )
);
