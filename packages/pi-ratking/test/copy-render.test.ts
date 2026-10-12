import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { addressedElsewhere } from "../src/name.ts";
import { COPY_BODY_MAX, COPY_NOTE, renderInbound } from "../src/payload.ts";
import type { Inbound } from "../src/payload.ts";

const base: Inbound = {
  body: "full progress note",
  cc: true,
  ccNames: ["alpha/desk"],
  did: "did:web:beta.desk.example.invalid",
  from: "beta/desk",
  id: "3mxaaaaaaaaaa",
  kind: "message",
  label: Option.none(),
  replyTo: Option.none(),
  summary: Option.some("Landed the feed slice"),
  to: "gamma/desk",
  verified: true,
};

describe("cc'd copies render short", () => {
  it("a cc'd copy shows its summary and a note, not the body", () => {
    const text = renderInbound("intercom", { ...base, copy: true });

    expect(text).toContain("Summary: Landed the feed slice");
    expect(text).toContain(COPY_NOTE);
    expect(text).not.toContain("full progress note");
  });

  it("a cc'd copy with no summary keeps a clipped body", () => {
    const body = "x".repeat(COPY_BODY_MAX + 50);

    const text = renderInbound("intercom", {
      ...base,
      body,
      copy: true,
      summary: Option.none(),
    });

    expect(text).toContain(`${"x".repeat(COPY_BODY_MAX)}… (clipped`);
    expect(text).not.toContain("x".repeat(COPY_BODY_MAX + 1));
  });

  it("mail addressed to the reader, or an ask, renders in full", () => {
    for (const inbound of [
      { ...base, copy: false },
      { ...base, copy: true, kind: "ask" as const },
    ]) {
      const text = renderInbound("intercom", inbound);

      expect(text).toContain("full progress note");
      expect(text).not.toContain(COPY_NOTE);
    }
  });
});

describe("addressedElsewhere", () => {
  const reserved = {
    "alpha/desk": { aliases: ["alpha"], did: "did:web:alpha" },
  };

  it("is false for mail to this reader, by name or alias", () => {
    expect(addressedElsewhere(reserved, "alpha/desk", "alpha/desk")).toBe(
      false
    );
    expect(addressedElsewhere(reserved, "alpha", "alpha/desk")).toBe(false);
  });

  it("is true when the mail names someone else", () => {
    expect(addressedElsewhere(reserved, "beta/desk", "alpha/desk")).toBe(true);
  });
});
