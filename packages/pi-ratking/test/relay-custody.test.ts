import { it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Result, Schema } from "effect";
import { expect } from "vitest";

import { openRelay, transferCustody } from "../src/relay.ts";
import type { RelayEntryValue } from "../src/relay.ts";

it.effect.prop(
  "relay acceptance transfers custody; refusal waits for fallback display; journal replay never forwards twice",
  [Arbitrary.schema(Schema.Boolean)],
  ([accepted]) =>
    Effect.gen(function* proof() {
      let saved: readonly RelayEntryValue[] = [];
      const injected: string[] = [];
      const steps: string[] = [];

      const original = {
        body: "original",
        cc: false,
        did: "did:web:sender.invalid",
        from: "sender",
        id: "original-id",
        kind: "message" as const,
        label: Option.none<string>(),
        replyTo: Option.none<string>(),
        summary: Option.none<string>(),
        verified: true,
      };

      const build = () =>
        openRelay(
          {
            fallbackMinutes: 10,
            mode: "front",
            name: "desk",
            to: "desk/staff",
          },
          {
            inject: (inbound) =>
              Effect.sync(() => {
                injected.push(inbound.id);
              }),
            load: Effect.sync(() => saved),
            now: Effect.succeed(0),
            save: (entries) =>
              Effect.sync(() => {
                saved = entries;
              }),
          }
        );

      const relay = yield* build();
      const proposed = yield* relay.receive(original, false, true, 0);

      const ack = Effect.sync(() => {
        steps.push("ack");
      });

      const send = Effect.sync(() => {
        steps.push("send");
      }).pipe(
        Effect.andThen(
          accepted
            ? Effect.sync(() => {
                steps.push("accepted");
              })
            : Effect.fail("refused")
        )
      );

      expect(Option.isSome(proposed)).toBe(true);
      expect(steps).toEqual([]);

      const result = yield* transferCustody(
        send,
        relay.forwarded(original.id).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              steps.push("recorded");
            })
          )
        ),
        ack
      ).pipe(Effect.result);

      expect(Result.isSuccess(result)).toBe(accepted);
      expect(steps).toEqual(
        accepted ? ["send", "accepted", "recorded", "ack"] : ["send"]
      );

      if (!accepted) {
        yield* relay.failed(original.id);
        expect(injected).toEqual([original.id]);
        expect(steps).toEqual(["send"]);
      }

      const restarted = yield* build();
      const replay = yield* restarted.receive(original, false, true, 0, true);

      expect(Option.isNone(replay)).toBe(true);
      expect(yield* restarted.transferred(original.id)).toBe(accepted);
      expect(injected).toEqual(accepted ? [] : [original.id, original.id]);

      if (!accepted) {
        yield* ack;
        expect(steps).toEqual(["send", "ack"]);
      }
    })
);
