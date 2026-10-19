import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { expect } from "vitest";

import { turnInbox } from "../src/wake-record.ts";

const turn = (id: string, state: string, n: number, verified = true) => ({
  did: "did:web:worker.example.invalid",
  from: "fleet/worker",
  id,
  levers: {},
  record: {
    $type: "sh.mschf.agentgraph.turn" as const,
    agent: "fleet/worker",
    at: "2030-01-01T00:00:00Z",
    session: "session",
    state,
    turnId: `session:${n}`,
    version: "0.1",
  },
  replyTo: Option.none<string>(),
  verified,
});

const host = () => {
  const consumed: string[] = [];
  const taken: string[] = [];

  return {
    consumed,
    host: {
      consume: (id: string) => {
        consumed.push(id);
      },
      take: (mail: { readonly id: string }) => {
        taken.push(mail.id);
      },
    },
    taken,
  };
};

it.effect("a done turn after mail from the same worker does not wake", () =>
  Effect.sync(() => {
    const seen = host();
    const inbox = turnInbox(seen.host, () => "fleet/desk");

    inbox.heard("fleet/worker");
    inbox.receive(turn("t1", "done", 1), false);

    expect(seen.taken).toEqual([]);
    expect(seen.consumed).toEqual(["t1"]);
  })
);

it.effect("a silent done turn still wakes, and mail counts once", () =>
  Effect.sync(() => {
    const seen = host();
    const inbox = turnInbox(seen.host, () => "fleet/desk");

    inbox.receive(turn("t1", "done", 1), false);
    inbox.heard("fleet/worker");
    inbox.receive(turn("t2", "done", 2), false);
    inbox.addressed("fleet/worker");
    inbox.receive(turn("t3", "done", 3), false);

    expect(seen.taken).toEqual(["t1", "t3"]);
    expect(seen.consumed).toEqual(["t2"]);
  })
);

it.effect("blocked and crashed turns wake even after mail", () =>
  Effect.sync(() => {
    const seen = host();
    const inbox = turnInbox(seen.host, () => "fleet/desk");

    inbox.heard("fleet/worker");
    inbox.receive(turn("t1", "blocked", 1), false);
    inbox.heard("fleet/worker");
    inbox.receive(turn("t2", "crashed", 2), false);

    expect(seen.taken).toEqual(["t1", "t2"]);
  })
);

it.effect(
  "mail from another worker or an unverified turn does not quiet a done turn",
  () =>
    Effect.sync(() => {
      const seen = host();
      const inbox = turnInbox(seen.host, () => "fleet/desk");

      inbox.heard("fleet/other");
      inbox.receive(turn("t1", "done", 1), false);

      expect(seen.taken).toEqual(["t1"]);
    })
);
