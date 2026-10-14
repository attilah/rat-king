import { it } from "@effect/vitest";
import { formatReason, Reasons } from "@rat-king/ratking-client/attend";
import { Schema } from "effect";
import { expect } from "vitest";

import { digestLabel, digestReason } from "../src/pending.ts";

const Copies = Schema.NonEmptyArray(Schema.Literals(["cc", "quiet"]));

it.prop(
  "Digest labels preserve homogeneous sender-quiet or cc intent, while mixed copies stay generic",
  [Copies],
  ([copies]) => {
    const mails = copies.map((copy, index) => ({
      content: "",
      details: {},
      id: String(index),
      reason: Reasons.intent({ facts: [copy, "digest"] }),
    }));

    const reason = digestReason(mails);
    let expected = "digest";

    if (copies.every((copy) => copy === "quiet")) {
      expected = "quiet digest";
    }

    if (copies.every((copy) => copy === "cc")) {
      expected = "cc digest";
    }

    expect(digestLabel(reason)).toBe(expected);
    expect(formatReason(reason)).toBe(`held: ${expected}`);
  }
);
