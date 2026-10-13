import { it } from "@effect/vitest";
import { sign } from "@rat-king/envelope/es256";
import * as GetPreferences from "@rat-king/lexicon/attention.getPreferences";
import * as GetStatus from "@rat-king/lexicon/attention.getStatus";
import type * as Prefs from "@rat-king/lexicon/attention.prefs";
import * as PutPreferences from "@rat-king/lexicon/attention.putPreferences";
import * as PutStatus from "@rat-king/lexicon/attention.putStatus";
import type * as Status from "@rat-king/lexicon/attention.status";
import { Arbitrary, Effect, Layer, Result, Schema } from "effect";
import * as fc from "fast-check";
import { expect } from "vitest";

import {
  recipientDid,
  sealed,
  senderDid,
} from "../../../packages/envelope/test/helpers.ts";
import {
  attentionBytes,
  defaultPreferences,
  defaultStatus,
} from "../../../packages/mailbox-client/src/attention.ts";
import { attentionHandlers } from "../src/attention.ts";
import type { AttentionInterface } from "../src/attention.ts";
import { staticResolver } from "../src/auth.ts";
import { Caller } from "../src/caller.ts";
import { MailboxStore } from "../src/store.ts";
import { TestFailure } from "./celld.ts";
import { documents, testStore } from "./helpers.ts";

interface Model {
  prefs: Prefs.MainValue;
  status: Status.MainValue;
  seq: number;
}

interface Real {
  owner: AttentionInterface;
  stranger: AttentionInterface;
  run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  signing: CryptoKey;
  otherSigning: CryptoKey;
  store: typeof MailboxStore.Service;
}

const CommandInput = Schema.Struct({
  forged: Schema.Boolean,
  other: Schema.Boolean,
  state: Schema.Literals(["available", "busy", "dnd"]),
  status: Schema.Boolean,
});

type CommandValue = typeof CommandInput.Type;

const modelStep = (model: Model, real: Real, command: CommandValue) =>
  Effect.gen(function* step() {
    const prefs: Prefs.MainValue = {
      ...defaultPreferences(),
      allow: command.state === "busy" ? ["alarm"] : [],
      log: command.state === "dnd",
    };

    const status: Status.MainValue = {
      ...defaultStatus(),
      state: command.state,
    };

    const nsid = command.status
      ? PutStatus.Method.nsid
      : PutPreferences.Method.nsid;

    const value = command.status ? status : prefs;

    const signature = yield* sign(
      command.forged ? real.otherSigning : real.signing,
      attentionBytes(recipientDid, nsid, value)
    );

    const caller = command.other ? real.stranger : real.owner;

    const input = {
      did: recipientDid,
      keyId: `${recipientDid}#atproto`,
      signature,
    };

    const result = yield* (
      command.status
        ? Schema.decodeUnknownEffect(Schema.toType(PutStatus.Input))({
            ...input,
            status,
          }).pipe(Effect.flatMap(caller.putStatus), Effect.asVoid)
        : Schema.decodeUnknownEffect(Schema.toType(PutPreferences.Input))({
            ...input,
            prefs,
          }).pipe(Effect.flatMap(caller.putPreferences), Effect.asVoid)
    ).pipe(Effect.result);

    const accepted = !command.other && !command.forged;
    expect(Result.isSuccess(result)).toBe(accepted);

    if (Result.isFailure(result)) {
      expect(
        Schema.is(Schema.Struct({ error: Schema.Literal("Forbidden") }))(
          result.failure
        )
      ).toBe(true);
    }

    if (accepted) {
      model.seq += 1;

      if (command.status) {
        model.status = status;
      } else {
        model.prefs = prefs;
      }
    }

    const params = yield* Schema.decodeUnknownEffect(GetPreferences.Params)({
      did: recipientDid,
    });

    expect((yield* real.owner.getPreferences(params)).prefs).toEqual(
      model.prefs
    );

    const refused = yield* real.stranger
      .getPreferences(params)
      .pipe(Effect.result);

    expect(Result.isFailure(refused)).toBe(true);

    if (Result.isFailure(refused)) {
      expect(refused.failure.error).toBe("Forbidden");
    }

    const statusParams = yield* Schema.decodeUnknownEffect(GetStatus.Params)({
      did: recipientDid,
    });

    expect((yield* real.stranger.getStatus(statusParams)).status).toEqual(
      model.status
    );

    const events = yield* real.store.transaction((tx) =>
      tx.events(0, tx.watermark(), 100)
    );

    expect(events).toHaveLength(model.seq);
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: model.seq }, (_, index) => index + 1)
    );
    expect(JSON.stringify(events)).not.toContain("allow");
  });

const commandFor = (
  value: CommandValue,
  model: Model,
  real: Real
): fc.AsyncCommand<Model, Real> => {
  const run: (effect: ReturnType<typeof modelStep>) => Promise<void> = real.run;

  return {
    check: () => true,
    run: run.bind(undefined, modelStep(model, real, value)),
    toString: () => JSON.stringify(value),
  };
};

it.effect.prop(
  "Attention records enforce self-only prefs, public status and owner signatures after every command",
  [Arbitrary.schema(Schema.Array(CommandInput).check(Schema.isMaxLength(15)))],
  ([commands]) =>
    Effect.gen(function* proof() {
      const sample = yield* sealed();
      const other = yield* sealed();

      const docs = yield* documents(
        sample.keys.sender.publicKey,
        sample.keys.recipient.publicKey
      );

      const storage = yield* testStore;
      const store = yield* MailboxStore.pipe(Effect.provide(storage.layer));

      const service = (did: string) =>
        attentionHandlers.pipe(
          Effect.provide(
            Layer.mergeAll(
              storage.layer,
              staticResolver(docs),
              Layer.succeed(Caller, { did })
            )
          )
        );

      const owner = yield* service(recipientDid);
      const stranger = yield* service(senderDid);

      const real: Real = {
        otherSigning: other.keys.sender.privateKey,
        owner,
        run: Effect.runPromise,
        signing: sample.keys.sender.privateKey,
        store,
        stranger,
      };

      const model: Model = {
        prefs: defaultPreferences(),
        seq: 0,
        status: defaultStatus(),
      };

      const required = [false, true].flatMap((status) => [
        commandFor(
          { forged: false, other: false, state: "dnd", status },
          model,
          real
        ),
        commandFor(
          { forged: false, other: true, state: "available", status },
          model,
          real
        ),
        commandFor(
          { forged: true, other: false, state: "busy", status },
          model,
          real
        ),
      ]);

      const runModel = (fc.asyncModelRun<Model, Real, false, Model>).bind(
        undefined,
        () => ({ model, real }),
        [
          ...required,
          ...commands.map((value) => commandFor(value, model, real)),
        ]
      );

      yield* Effect.tryPromise({
        catch: (cause) => new TestFailure({ message: String(cause) }),
        try: runModel,
      });
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 20 }, timeout: 30_000 }
);
