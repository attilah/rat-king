import { it } from "@effect/vitest";
import { Console, Effect, FileSystem, Schema, Stream } from "effect";
import { expect } from "vitest";

import {
  usageCommand,
  usageDigest,
  decodeTrafficLine,
} from "../../../stacks/nest/usage.ts";

const accepted = {
  messageId: "fixture-message",
  recipientDid: "did:web:mailbox.ratking-fleet.invalid",
  recipientSeq: 1,
  senderDid: "did:web:switchboard.ratking-fleet.invalid",
  seq: 1,
  state: "accepted",
  time: "2026-10-12T23:00:00Z",
};

it.effect("real seconds receipt yields one restart and zero replay ratio", () =>
  Effect.gen(function* secondsReceipt() {
    const output: string[] = [];

    const traffic = [
      accepted,
      { ...accepted, state: "delivered", time: "2026-10-12T23:00:00.010Z" },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    const receipts = [
      {
        celldRestarted: true,
        end: 1_791_847_436.46,
        restartSeconds: 56.818179,
        result: "success",
        sha: "0123456789abcdef0123456789abcdef01234567",
        start: 1_791_847_269.549,
      },
      {
        celldRestarted: true,
        end: 1_791_869_140.543,
        restartSeconds: 12.4,
        result: "success",
        sha: "0123456789abcdef0123456789abcdef01234567",
        start: 1_791_868_999.684,
      },
    ]
      .map((receipt) => JSON.stringify(receipt))
      .join("\n");

    yield* usageCommand([
      "--day",
      "2026-10-12",
      "--input",
      "traffic",
      "--restarts",
      "receipts",
    ]).pipe(
      Effect.provide(
        FileSystem.layerNoop({
          stream: (path) =>
            Stream.make(
              new TextEncoder().encode(path === "traffic" ? traffic : receipts)
            ),
        })
      ),
      Effect.provideService(Console.Console, {
        ...console,
        log: (...args: readonly unknown[]) => {
          output.push(args.join(" "));
        },
      })
    );
    expect(output).toHaveLength(1);

    const digest = yield* Schema.decodeEffect(
      Schema.fromJsonString(
        Schema.Struct({
          replays: Schema.Int,
          replaysPerRestart: Schema.NullOr(Schema.Finite),
          restarts: Schema.Int,
        })
      )
    )(output[0] ?? "");

    expect(digest).toEqual({ replays: 0, replaysPerRestart: 0, restarts: 1 });
  })
);

const FleetLabels = Schema.Array(
  Schema.Literals([
    "switchboard",
    "mailbox",
    "drovr",
    "mysql-cutover",
    "fixture",
    "row",
  ])
).check(Schema.isMinLength(1), Schema.isMaxLength(5));

it.effect.prop(
  "every generated fleet-zone DID has its slash-joined non-null name with or without pi",
  [FleetLabels, Schema.Boolean],
  ([labels, pi]) =>
    Effect.gen(function* fleetNames() {
      const did = `did:web:${labels.join(".")}${pi ? ".pi" : ""}.ratking-fleet.invalid`;

      const digest = yield* usageDigest(
        "2026-10-12",
        Stream.make(JSON.stringify({ ...accepted, senderDid: did })).pipe(
          Stream.mapEffect(decodeTrafficLine)
        )
      );

      expect(digest.topSenders).toEqual([
        { count: 1, did, name: labels.join("/") },
      ]);
    })
);

it.effect.prop(
  "reserved and host names stay readable",
  [Schema.Literals(["switchboard", "drovr.mysql-cutover", "mailbox"])],
  ([labels]) =>
    Effect.gen(function* reservedNames() {
      const did = `did:web:${labels}.ratking-fleet.invalid`;

      const digest = yield* usageDigest(
        "2026-10-12",
        Stream.make(JSON.stringify({ ...accepted, senderDid: did })).pipe(
          Stream.mapEffect(decodeTrafficLine)
        )
      );

      expect(digest.topSenders).toEqual([
        { count: 1, did, name: labels.split(".").join("/") },
      ]);
    })
);
