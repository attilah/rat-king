import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as fc from "fast-check";
import { expect } from "vitest";

import { turnInbox } from "../src/wake-record.ts";

const turn = (id: string, state: string, n: number, session = "session") => ({
  did: "did:web:worker.example.invalid",
  from: "fleet/worker",
  id,
  levers: {},
  record: {
    $type: "sh.mschf.agentgraph.turn" as const,
    agent: "fleet/worker",
    at: "2030-01-01T00:00:00Z",
    session,
    state,
    turnId: `${session}:${n}`,
    version: "0.1",
  },
  replyTo: Option.none<string>(),
  verified: true,
});

const host = () => {
  const consumed: string[] = [];
  const shown: string[] = [];
  const taken: string[] = [];

  return {
    consumed,
    host: {
      consume: (id: string) => {
        consumed.push(id);
      },
      show: (mail: { readonly id: string }) => {
        shown.push(mail.id);
      },
      take: (mail: { readonly id: string }) => {
        taken.push(mail.id);
      },
    },
    shown,
    taken,
  };
};

const silentRun = fc.integer({ max: 12, min: 2 });

const quietState = fc.constantFrom("blocked", "crashed");

it.effect("a standing agent's repeated silent dones wake only once", () =>
  Effect.sync(() => {
    fc.assert(
      fc.property(silentRun, (count) => {
        const seen = host();
        const inbox = turnInbox(seen.host, () => "fleet/desk");

        for (let n = 1; n <= count; n += 1) {
          inbox.receive(turn(`t${n}`, "done", n), false);
        }

        expect(seen.taken).toEqual(["t1"]);
        expect(seen.shown).toHaveLength(count - 1);
        expect(seen.consumed).toHaveLength(count - 1);
      })
    );
  })
);

it.effect("owner mail to the agent makes its next done wake once", () =>
  Effect.sync(() => {
    const seen = host();
    const inbox = turnInbox(seen.host, () => "fleet/desk");

    inbox.receive(turn("t1", "done", 1), false);
    inbox.addressed("fleet/worker");
    inbox.receive(turn("t2", "done", 2), false);
    inbox.receive(turn("t3", "done", 3), false);

    expect(seen.taken).toEqual(["t1", "t2"]);
    expect(seen.shown).toEqual(["t3"]);
  })
);

it.effect("blocked and crashed records always wake", () =>
  Effect.sync(() => {
    fc.assert(
      fc.property(
        fc.array(quietState, { maxLength: 8, minLength: 1 }),
        (states) => {
          const seen = host();
          const inbox = turnInbox(seen.host, () => "fleet/desk");

          inbox.receive(turn("d", "done", 1), false);

          for (const [index, state] of states.entries()) {
            inbox.receive(turn(`s${index}`, state, index + 2), false);
          }

          expect(seen.taken).toHaveLength(states.length + 1);
        }
      )
    );
  })
);

it.effect("the first done of a new session wakes", () =>
  Effect.sync(() => {
    const seen = host();
    const inbox = turnInbox(seen.host, () => "fleet/desk");

    inbox.receive(turn("a1", "done", 1, "s1"), false);
    inbox.receive(turn("a2", "done", 2, "s1"), false);
    inbox.receive(turn("b1", "done", 1, "s2"), false);

    expect(seen.taken).toEqual(["a1", "b1"]);
  })
);

it.effect("a done after the agent's own mail stays quiet and consumed", () =>
  Effect.sync(() => {
    const seen = host();
    const inbox = turnInbox(seen.host, () => "fleet/desk");

    inbox.addressed("fleet/worker");
    inbox.heard("fleet/worker");
    inbox.receive(turn("t1", "done", 1), false);

    expect(seen.taken).toEqual([]);
    expect(seen.consumed).toEqual(["t1"]);
  })
);

it.effect("a restored session does not count as new", () =>
  Effect.sync(() => {
    const seen = host();
    const inbox = turnInbox(seen.host, () => "fleet/desk");

    inbox.restore([JSON.stringify(["session:1", "done"])], () => {});
    inbox.receive(turn("t2", "done", 2), false);

    expect(seen.taken).toEqual([]);
    expect(seen.shown).toEqual(["t2"]);
  })
);
