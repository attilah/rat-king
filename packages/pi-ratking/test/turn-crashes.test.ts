import { it } from "@effect/vitest";
import type { ReaderHeartbeatValue } from "@rat-king/ratking-client/reader-health";
import { Arbitrary, DateTime, Effect, Schema } from "effect";
import { expect } from "vitest";

import { crashedReader } from "../../../stacks/nest/turn-crash-record.ts";
import { crashCycle } from "../../../stacks/nest/turn-crashes.ts";
import type {
  CrashNotice,
  CrashJournalValue,
  CrashPorts,
} from "../../../stacks/nest/turn-crashes.ts";

const Case = Schema.Struct({
  acquiring: Schema.Boolean,
  fault: Schema.Literals(["none", "send", "save"]),
  generations: Schema.Array(
    Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: 1 }))
  ).check(Schema.isMinLength(1)),
});

interface SealedNotice extends CrashNotice {
  readonly messageId: string;
}

const beat = (
  generation: number,
  acquiring: boolean
): ReaderHeartbeatValue => ({
  acquisitionSince: DateTime.makeUnsafe(0),
  generation,
  lastConsumeOk: null,
  lastError: null,
  leaseHeldSince: null,
  leaseTtlMs: 300_000,
  leaseUntil: acquiring ? null : DateTime.makeUnsafe(300_000),
  name: "worker",
  owner: "owner",
  pid: 1,
  session: "session",
  startedAt: DateTime.makeUnsafe(0),
  state: acquiring ? "Acquiring" : "Live",
  updatedAt: DateTime.makeUnsafe(0),
});

it.effect.prop(
  "lease lapse and overdue acquisition send one crash to their owner per generation across repeated collector passes and journal reloads",
  [Arbitrary.schema(Case)],
  ([sample]) =>
    Effect.gen(function* proof() {
      let journal: CrashJournalValue<SealedNotice> = {
        pending: [],
        sent: [],
        version: "0.1",
      };

      const sent: SealedNotice[] = [];
      const prepared: SealedNotice[] = [];
      const attempts: SealedNotice[] = [];
      let failed = false;

      const ports: CrashPorts<SealedNotice, string, never> = {
        prepare: (notice) =>
          Effect.sync(() => {
            const sealed = {
              ...notice,
              messageId: `message-${prepared.length}`,
            };

            prepared.push(sealed);

            return sealed;
          }),
        save: (next) =>
          Effect.gen(function* save() {
            if (sample.fault === "save" && !failed && next.sent.length > 0) {
              failed = true;

              return yield* Effect.fail("Journal write interrupted after send");
            }

            journal = next;

            return yield* Effect.void;
          }),
        send: (notice) =>
          Effect.gen(function* send() {
            attempts.push(notice);

            if (!sent.some((prior) => prior.messageId === notice.messageId)) {
              sent.push(notice);
            }

            if (sample.fault === "send" && !failed) {
              failed = true;

              return yield* Effect.fail("Accepted receipt lost");
            }

            return yield* Effect.void;
          }),
      };

      const deadline = sample.acquiring ? 310_000 : 300_000;

      for (const generation of sample.generations) {
        const reader = beat(generation, sample.acquiring);
        expect(crashedReader(reader, deadline - 1)).toBeUndefined();
        const record = crashedReader(reader, deadline);
        expect(record).toMatchObject({
          agent: "worker",
          generation,
          session: "session",
          state: "crashed",
        });

        if (record === undefined) {
          throw new Error("Unreported lapse");
        }

        const notice = { owner: reader.owner ?? "wrong-owner", record };
        yield* crashCycle([notice, notice], journal, ports).pipe(Effect.ignore);
        yield* crashCycle([notice], journal, ports);
      }

      expect(sent.map((notice) => notice.owner)).toEqual(
        [...new Set(sample.generations)].map(() => "owner")
      );
      expect(sent.map((notice) => notice.record.generation)).toEqual([
        ...new Set(sample.generations),
      ]);
      expect(prepared).toHaveLength(new Set(sample.generations).size);
      expect(journal.pending).toEqual([]);
      expect(new Set(attempts.map((notice) => notice.messageId)).size).toBe(
        prepared.length
      );
    })
);
