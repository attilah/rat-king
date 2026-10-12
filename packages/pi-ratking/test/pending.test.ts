import { Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  DIGEST_MESSAGE,
  digestFor,
  inbox,
  MAIL_MESSAGE,
  shownIds,
} from "../src/pending.ts";
import type { DeliverAs, PendingMail } from "../src/pending.ts";

const mail = (id: string): PendingMail => ({
  content: `mail ${id}`,
  details: { from: "alpha/desk", id },
  id,
});

const fakeSession = () => {
  const entries: unknown[] = [];
  const steps: string[] = [];

  const host = {
    appendEntry: (customType: string, data: PendingMail) => {
      steps.push(`entry ${data.id}`);
      entries.push({ customType, data, type: "custom" });
    },
    digest: (mails: readonly PendingMail[]) => {
      steps.push(`digest ${mails.map((held) => held.id).join(",")}`);
    },
    show: (pending: PendingMail, deliverAs: DeliverAs) => {
      steps.push(`show ${pending.id} ${deliverAs}`);
    },
  };

  const display = (id: string) => {
    entries.push({
      customType: MAIL_MESSAGE,
      details: { id },
      type: "custom_message",
    });
  };

  return { display, entries, host, steps };
};

describe("pending mail", () => {
  it("queues mail without session persistence", () => {
    const session = fakeSession();
    const box = inbox(session.host);

    box.take(mail("a"), "steer");
    box.take(mail("b"), "followUp");

    expect(session.steps).toEqual(["show a steer", "show b followUp"]);
    expect(session.entries).toEqual([]);
  });

  it("shows mailbox redeliveries after restart", () => {
    const before = fakeSession();
    const first = inbox(before.host);

    first.take(mail("a"), "steer");
    first.take(mail("b"), "followUp");
    first.take(mail("c"), "followUp");
    before.display("a");
    before.entries.push(
      { type: "message" },
      { customType: "other", type: "custom" }
    );

    const after = fakeSession();
    const second = inbox(after.host);

    second.take(mail("b"), "steer");
    second.take(mail("c"), "steer");

    expect(after.steps).toEqual(["show b steer", "show c steer"]);
  });

  it("leaves a redelivered cc copy for the next turn without a wake", () => {
    const before = fakeSession();
    const first = inbox(before.host);

    first.take(mail("a"), "nextTurn");

    expect(before.steps).toEqual(["show a nextTurn"]);

    const after = fakeSession();

    inbox(after.host).take(mail("a"), "nextTurn");

    expect(after.steps).toEqual(["show a nextTurn"]);
  });

  it("clearing a session shows nothing", () => {
    const before = fakeSession();
    const first = inbox(before.host);

    first.take(mail("a"), "steer");
    before.display("a");

    const after = fakeSession();

    inbox(after.host).clear();

    expect(after.steps).toEqual([]);
  });

  it("reads mail ids only from a displayed Rat King message or digest", () => {
    expect(
      shownIds({
        customType: MAIL_MESSAGE,
        details: { id: "a" },
        role: "custom",
      })
    ).toEqual(["a"]);
    expect(
      shownIds({
        customType: DIGEST_MESSAGE,
        details: { ids: ["b", "c"] },
        role: "custom",
      })
    ).toEqual(["b", "c"]);
    expect(
      shownIds({ customType: "other", details: { id: "a" }, role: "custom" })
    ).toEqual([]);
    expect(shownIds({ role: "user" })).toEqual([]);
  });
});

describe("cc digest", () => {
  const MINUTE = 60_000;

  const held = (id: string): PendingMail => ({
    ...mail(id),
    digestMinutes: 30,
  });

  it("holds digest copies without showing them, then sends one digest per interval, newest first", () => {
    const session = fakeSession();
    const box = inbox(session.host);

    box.tick(0);
    box.take(held("a"), "digest");
    box.take(held("b"), "digest");

    expect(session.steps).toEqual([]);

    box.tick(29 * MINUTE);

    expect(session.steps).toEqual([]);

    box.tick(30 * MINUTE);

    expect(session.steps).toEqual(["digest b,a"]);
  });

  it("never digests a copy twice, and an empty interval sends nothing", () => {
    const session = fakeSession();
    const box = inbox(session.host);

    box.tick(0);
    box.take(held("a"), "digest");
    box.tick(30 * MINUTE);
    box.tick(60 * MINUTE);
    box.shown("a");
    box.tick(90 * MINUTE);
    box.take(held("b"), "digest");
    box.tick(100 * MINUTE);
    box.tick(120 * MINUTE);

    expect(session.steps.filter((step) => step.startsWith("digest"))).toEqual([
      "digest a",
      "digest b",
    ]);
  });

  it("digest copies are held, not shown, and survive a restart until a digest shows them", () => {
    const before = fakeSession();
    const first = inbox(before.host);

    first.take(held("a"), "digest");
    first.take(held("b"), "digest");

    expect(before.steps).toEqual([]);

    before.entries.push({
      customType: DIGEST_MESSAGE,
      details: { ids: ["a"] },
      type: "custom_message",
    });

    const after = fakeSession();
    const second = inbox(after.host);

    second.take(held("b"), "digest");

    expect(after.steps).toEqual([]);

    second.tick(0);
    second.tick(30 * MINUTE);

    expect(after.steps).toEqual(["digest b"]);
  });

  it("finds the cadence by full name first, then by project", () => {
    const table = { drovr: 30, "drovr/front": 5 };

    expect(digestFor(table, "drovr/front")).toEqual(Option.some(5));
    expect(digestFor(table, "drovr/drovr-desk-2")).toEqual(Option.some(30));
    expect(digestFor(table, "rats-nest/desk")).toEqual(Option.none());
  });
});
