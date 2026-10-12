import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { inbox, MAIL_MESSAGE, PENDING_ENTRY, shownId } from "../src/pending.ts";
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
  it("records taken mail in the session before showing it", () => {
    const session = fakeSession();
    const box = inbox(session.host);

    box.take(mail("a"), "steer");
    box.take(mail("b"), "followUp");

    expect(session.steps).toEqual([
      "entry a",
      "show a steer",
      "entry b",
      "show b followUp",
    ]);
    expect(session.entries[0]).toEqual({
      customType: PENDING_ENTRY,
      data: { ...mail("a"), deliverAs: "steer" },
      type: "custom",
    });
  });

  it("re-shows only mail Pi never displayed, as a steer", () => {
    const session = fakeSession();
    const box = inbox(session.host);

    box.take(mail("a"), "followUp");
    box.take(mail("b"), "followUp");
    box.shown("a");
    session.steps.length = 0;

    box.resend();

    expect(session.steps).toEqual(["show b steer"]);

    box.shown("b");
    session.steps.length = 0;

    box.resend();

    expect(session.steps).toEqual([]);
  });

  it("restores unshown mail from the session after a restart and shows it", () => {
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

    second.restore(before.entries);

    expect(after.steps).toEqual(["show b steer", "show c steer"]);
  });

  it("leaves a cc'd copy for the next turn: never re-sent on idle, restored without a wake", () => {
    const before = fakeSession();
    const first = inbox(before.host);

    first.take(mail("a"), "nextTurn");
    before.steps.length = 0;

    first.resend();

    expect(before.steps).toEqual([]);

    const after = fakeSession();

    inbox(after.host).restore(before.entries);

    expect(after.steps).toEqual(["show a nextTurn"]);
  });

  it("restoring a session where everything was shown shows nothing", () => {
    const before = fakeSession();
    const first = inbox(before.host);

    first.take(mail("a"), "steer");
    before.display("a");

    const after = fakeSession();

    inbox(after.host).restore(before.entries);

    expect(after.steps).toEqual([]);
  });

  it("reads the mail id only from a displayed Rat King message", () => {
    expect(
      shownId({
        customType: MAIL_MESSAGE,
        details: { id: "a" },
        role: "custom",
      })
    ).toEqual(Option.some("a"));
    expect(
      shownId({ customType: "other", details: { id: "a" }, role: "custom" })
    ).toEqual(Option.none());
    expect(shownId({ role: "user" })).toEqual(Option.none());
  });
});
