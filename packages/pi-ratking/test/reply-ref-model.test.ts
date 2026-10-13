/* oxlint-disable typescript/promise-function-async -- fast-check model command Promise boundary. */
import { it } from "@effect/vitest";
import {
  Payload,
  PayloadJson,
  replyRef,
} from "@rat-king/ratking-client/payload";
import { Threads, threadsLayer } from "@rat-king/ratking-client/threads";
import type { Received } from "@rat-king/ratking-client/threads";
import { Effect, Option, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

const Id = Schema.String.check(Schema.isPattern(/^[a-z]{1,12}$/u));

const LegacyPayload = Schema.Struct({
  body: Payload.fields.body,
  cc: Payload.fields.cc,
  from: Payload.fields.from,
  kind: Payload.fields.kind,
  label: Payload.fields.label,
  replyTo: Payload.fields.replyTo,
  summary: Payload.fields.summary,
  thread: Payload.fields.thread,
  to: Payload.fields.to,
});

it.prop(
  "the old payload decoder ignores the optional reply ref and still reads replyTo",
  [Id, Id],
  ([parent, root]) => {
    const legacy = {
      body: "reply",
      from: "peer",
      kind: "reply",
      replyTo: parent,
    } as const;

    const json = Schema.encodeSync(PayloadJson)({
      ...legacy,
      reply: replyRef(parent, root),
    });

    expect(
      Schema.decodeSync(Schema.fromJsonString(LegacyPayload))(json)
    ).toEqual(legacy);
  }
);

interface Model {
  parent: string;
  root: string;
}

it.effect.prop(
  "reply chains retain the first root in storage and on the wire; missing refs fall back to replyTo",
  [Id, Schema.Array(Schema.Boolean)],
  ([root, steps]) =>
    Effect.gen(function* replyModel() {
      const threads = yield* Threads;
      const context = yield* Effect.context();

      const commands = steps.map(
        (legacy, index): AsyncCommand<Model, object> => ({
          check: () => true,
          run: (model) => {
            const operation = Effect.gen(function* replyStep() {
              const id = `${root}-${index}`;
              const previous = yield* threads.lookup(model.parent);

              const knownRoot = Option.getOrUndefined(
                Option.map(
                  (record: Received) => record.reply?.root ?? record.thread
                )(previous)
              );

              const ref = replyRef(model.parent, knownRoot);

              const payload = {
                body: "reply",
                from: "peer",
                kind: "reply",
                replyTo: model.parent,
                thread: "ignored-thread",
              } as const;

              const wire = legacy ? payload : { ...payload, reply: ref };

              const decoded = yield* Schema.decodeEffect(PayloadJson)(
                yield* Schema.encodeEffect(PayloadJson)(wire)
              );

              const inbound = {
                body: decoded.body,
                cc: false,
                did: "did:web:peer.example.invalid",
                from: decoded.from,
                id,
                kind: "reply" as const,
                label: Option.none<string>(),
                replyTo: legacy
                  ? Option.fromNullishOr(decoded.replyTo)
                  : Option.none<string>(),
                summary: Option.none<string>(),
                thread: decoded.thread ?? "ignored-thread",
                verified: true,
              };

              if (decoded.reply !== undefined) {
                Object.assign(inbound, { reply: decoded.reply });
              }

              yield* threads.remember(inbound);
              model.root = legacy ? model.parent : model.root;
              model.parent = id;
              const stored = yield* threads.lookup(id);

              expect(
                Option.map((record: Received) => record.reply)(stored)
              ).toEqual(
                Option.some({ parent: payload.replyTo, root: model.root })
              );
              expect(
                Option.map((record: Received) => record.thread)(stored)
              ).toEqual(Option.some(model.root));
            });

            // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- fast-check reuses the test context.
            return Effect.runPromiseWith(context)(operation);
          },
          toString: () => `reply(${index}, legacy=${legacy})`,
        })
      );

      yield* Effect.promise(() =>
        asyncModelRun(
          () => ({ model: { parent: root, root }, real: {} }),
          commands
        )
      );
    }).pipe(Effect.provide(threadsLayer)),
  { arbitrary: { runs: 150 } }
);
