import { NodeServices } from "@effect/platform-node";
// @effect-diagnostics asyncFunction:off -- fast-check asyncModelRun drives Effect programs.
/* oxlint-disable typescript/promise-function-async, promise/prefer-await-to-callbacks -- fast-check asyncModelRun is the model boundary. */
import { it } from "@effect/vitest";
import {
  JsonSchema,
  SchemaRepresentation,
  Stream,
  Arbitrary,
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Option,
  Result,
  Schema,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { executeBatch } from "../../../stacks/nest/drain-process.ts";
import {
  classify,
  parseDrain,
  projectLine,
  runDrain,
} from "../../../stacks/nest/drain.ts";
import type {
  DrainPorts,
  Line,
  RequestValue,
} from "../../../stacks/nest/drain.ts";
import * as Defs from "../../lexicon/src/defs.ts";
import * as Lease from "../../lexicon/src/runtime.lease.ts";
import type { Batch } from "../../mailbox-client/src/index.ts";
import { MailboxClientError } from "../../mailbox-client/src/index.ts";
import { presenceLine } from "../src/presence.ts";
import pinned from "./fixtures/mischief-reply.json" with { type: "json" };

const DID = "did:web:acme.intake.agents.example.invalid";

const SENDER = "did:web:acme.writer.agents.example.invalid";

const ID = "3mxmfmbk52a6q";

const AT = "2026-10-11T00:00:00.000Z";

const event = Schema.decodeUnknownSync(Schema.toType(Defs.MessageEvent))({
  envelope: {
    aad: {
      messageId: ID,
      recipientDid: DID,
      recipientKeyId: `${DID}#encryption`,
      senderDid: SENDER,
    },
    ciphertext: new Uint8Array([1]),
    enc: new Uint8Array([1]),
    suite: { aeadId: 1, kdfId: 1, kemId: 16 },
    version: 1,
  },
  receipt: {
    message: { messageId: ID, senderDid: SENDER },
    recipientDid: DID,
    recordedAt: AT,
    seq: 1,
    state: "accepted",
  },
  seq: 1,
});

const request: RequestValue = {
  as: "rat_king_script_acme-intake_identity",
  ids: [],
  max: 100,
  wait: 0,
};

const opened = {
  body: JSON.stringify({
    body: "Proceed",
    from: "spoof/claim",
    kind: "reply",
    summary: "Reply",
    thread: ID,
  }),
  replyTo: event.receipt.message,
  senderDid: event.envelope.aad.senderDid,
  tid: event.envelope.aad.messageId,
  verified: true as const,
};

const make = () => {
  const events: Batch["events"][number][] = [
    { ...event, $type: "sh.mschf.ratking.defs#messageEvent" },
  ];

  const printed: Line[] = [];
  let held = false;
  let acks = 0;

  const lease = Schema.decodeUnknownSync(Schema.toType(Defs.Receipt))(
    event.receipt
  );

  const currentLease = Schema.decodeUnknownSync(Schema.toType(Lease.Main))({
    did: DID,
    expiresAt: AT,
    generation: 1,
    harness: { $type: "sh.mschf.ratking.runtime.lease#pi", sessionId: "test" },
    leaseId: ID,
  });

  const ports: DrainPorts = {
    exec: () => Effect.succeed(0),
    mailbox: {
      ack: () =>
        Effect.sync(() => {
          acks += 1;
          const receipt = { ...lease, seq: events.length + 1, state: "acked" };
          events.push({
            $type: "sh.mschf.ratking.defs#receiptEvent",
            receipt,
            seq: receipt.seq,
          });

          return { receipt };
        }),
      deliver: () =>
        Effect.succeed({ receipt: { ...event.receipt, state: "injected" } }),
      lease: {
        acquire: () =>
          Effect.suspend(() => {
            if (held) {
              return Effect.fail(
                new MailboxClientError({ error: "LeaseHeld", reason: "held" })
              );
            }

            held = true;

            return Effect.succeed(currentLease);
          }),
        release: () =>
          Effect.sync(() => {
            held = false;
          }),
        renew: () => Effect.succeed(currentLease),
        resolve: () => Effect.succeed(currentLease),
      },
      poll: () =>
        Effect.succeed({ events: [...events], throughSeq: events.length }),
    },
    open: (input) =>
      projectLine(input, Option.some(opened), Option.some("acme/writer")),
    print: (line) =>
      Effect.sync(() => {
        printed.push(line);
      }),
  };

  return { acks: () => acks, held: () => held, ports, printed };
};

const Step = Schema.Literals(["drain", "ack", "exec-ok", "exec-fail"]);

interface Model {
  acked: boolean;
  acks: number;
}

type Real = ReturnType<typeof make>;

const command = (step: typeof Step.Type): AsyncCommand<Model, Real> => ({
  check: () => true,
  run: async (model, real) => {
    const before = real.printed.length;
    const req = { ...request, ids: step === "ack" ? [ID] : [] };

    const ports = {
      ...real.ports,
      exec: () => Effect.succeed(step === "exec-fail" ? 7 : 0),
    };

    if (step.startsWith("exec")) {
      Object.assign(req, { exec: "consumer" });
    }

    // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- fast-check commands need a Promise boundary; production effects remain under the test.
    const result = await Effect.runPromise(
      runDrain(step === "ack" ? "ack" : "drain", req, DID, ports)
    );

    expect(result.drained).toBe(model.acked ? 0 : 1);
    expect(result.code).toBe(step === "exec-fail" && !model.acked ? 7 : 0);
    expect(real.printed.length - before).toBe(
      step === "drain" && !model.acked ? 1 : 0
    );

    if (!model.acked && (step === "ack" || step === "exec-ok")) {
      model.acked = true;
      model.acks += 1;
    }

    expect(real.acks()).toBe(model.acks);
    expect(real.held()).toBe(false);
  },
  toString: () => step,
});

it.effect.prop(
  "drain is at-least-once; only explicit ack or a successful consumer settles a message",
  [Arbitrary.array(Arbitrary.schema(Step), { maxLength: 20, minLength: 1 })],
  ([steps]) =>
    Effect.promise(() =>
      asyncModelRun(
        () => ({ model: { acked: false, acks: 0 }, real: make() }),
        steps.map(command)
      )
    )
);

it.effect.prop(
  "verified names come from DID resolution; unverified messages omit from",
  [Arbitrary.schema(Schema.Boolean), Arbitrary.schema(Schema.Boolean)],
  ([signature, resolved]) =>
    Effect.gen(function* test() {
      const line = yield* projectLine(
        event,
        signature ? Option.some(opened) : Option.none(),
        resolved ? Option.some("acme/writer") : Option.none()
      );

      expect(line.verified).toBe(signature && resolved);
      expect(Object.hasOwn(line, "from")).toBe(signature && resolved);

      if (signature && resolved) {
        expect(line.from).toBe("acme/writer");
      }
    })
);

it.effect(
  "a competing drainer exits 4 without reading; interrupted print leaves the batch pending",
  () =>
    Effect.gen(function* test() {
      const real = make();
      const entered = yield* Deferred.make<number>();

      const blocked = {
        ...real.ports,
        print: () =>
          Deferred.succeed(entered, 1).pipe(Effect.andThen(Effect.never)),
      };

      const first = yield* runDrain("drain", request, DID, blocked).pipe(
        Effect.forkChild
      );

      yield* Deferred.await(entered);

      const second = yield* runDrain("drain", request, DID, real.ports).pipe(
        Effect.result
      );

      expect(Result.isFailure(second) && second.failure.code).toBe(4);
      expect(real.printed).toHaveLength(0);
      yield* Fiber.interrupt(first);
      expect(real.acks()).toBe(0);
      expect((yield* runDrain("drain", request, DID, real.ports)).drained).toBe(
        1
      );
      expect(real.printed[0]?.messageId).toBe(ID);
    })
);

it.prop(
  "usage refusals and transport failures have actionable exit codes",
  [Arbitrary.schema(Schema.String)],
  ([flag]) => {
    expect(
      Result.isFailure(
        parseDrain("drain", ["--as", request.as, "--unknown", flag])
      )
    ).toBe(true);
    expect(classify({ reason: "offline" }).code).toBe(3);
    expect(classify({ error: "Retired", reason: "retired" }).code).toBe(2);
    expect(classify({ error: "LeaseHeld", reason: "held" }).code).toBe(4);
  }
);

it("plain drain, bounded drain, exec drain and ack parse from argv", () => {
  expect(Result.isSuccess(parseDrain("drain", ["--as", request.as]))).toBe(
    true
  );
  expect(
    Result.isSuccess(parseDrain("drain", ["--as", request.as, "--max", "10"]))
  ).toBe(true);
  expect(
    Result.isSuccess(parseDrain("drain", ["--as", request.as, "--exec", "cat"]))
  ).toBe(true);
  expect(Result.isSuccess(parseDrain("ack", ["--as", request.as, ID]))).toBe(
    true
  );
});

const ReplyInput = SchemaRepresentation.fromJsonSchemaDocument(
  JsonSchema.fromSchemaDraft2020_12(pinned.schema)
);

it.effect.prop(
  "a reply line decodes unchanged across the pinned Mischief seam, with or without server time",
  [Arbitrary.schema(Schema.Boolean)],
  ([timestamp]) =>
    Effect.gen(function* seam() {
      const input = { ...event, receipt: { ...event.receipt } };

      if (!timestamp) {
        delete input.receipt.recordedAt;
      }

      const line = yield* projectLine(
        input,
        Option.some(opened),
        Option.some("acme/writer")
      );

      const decoded = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.toType(ReplyInput))
      )(JSON.stringify(line));

      expect(decoded).toMatchObject({
        body: "Proceed",
        from: "acme/writer",
        messageId: ID,
        replyTo: ID,
      });
      expect(Object.hasOwn(line, "acceptedAt")).toBe(timestamp);
    })
);

it.live.prop(
  "the real exec adapter preserves nonzero consumer codes without acking",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 0 }))
    ),
  ],
  ([code]) =>
    Effect.gen(function* exec() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const real = make();

      const ports = {
        ...real.ports,
        exec: (cmd: string, lines: readonly Line[]) =>
          executeBatch(spawner, cmd, lines),
      };

      const result = yield* runDrain(
        "drain",
        { ...request, exec: `cat >/dev/null; exit ${code}` },
        DID,
        ports
      );

      expect(result.code).toBe(code);
      expect(real.acks()).toBe(code === 0 ? 1 : 0);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.prop(
  "a released reader within fifteen minutes reports queued batch intake",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 900_000, minimum: 0 }))
    ),
  ],
  ([elapsed]) => {
    const now = 1_000_000;

    const line = presenceLine(
      {
        held: false,
        lastHeldAt: DateTime.formatIso(DateTime.makeUnsafe(now - elapsed)),
      },
      now
    );

    expect(line).toEqual(
      Option.some(
        `No live reader; last read ${Math.floor(elapsed / 60_000)} min ago. The mail is queued for batch intake.`
      )
    );
  }
);

const mischiefRepo = process.env.MISCHIEF_CONTRACT_REPO;

it.live.skipIf(mischiefRepo === undefined)(
  "the vendored seam matches the pinned Mischief source file",
  () =>
    Effect.gen(function* pin() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make("git", ["show", `${pinned.sha}:${pinned.path}`], {
          cwd: mischiefRepo,
          stdin: "ignore",
        })
      );

      const [source, code] = yield* Effect.all(
        [
          Stream.mkString(child.stdout.pipe(Stream.decodeText())),
          child.exitCode,
        ],
        { concurrency: "unbounded" }
      );

      expect(code).toBe(0);
      expect(source).toContain(pinned.source);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
