import { it } from "@effect/vitest";
import * as Status from "@rat-king/lexicon/attention.status";
import { Arbitrary, Schema } from "effect";
import { expect } from "vitest";

import { delegation } from "../src/delegation.ts";

it.prop(
  "encrypted arrivals are always direct even while a delegate is active",
  [Arbitrary.schema(Schema.Boolean)],
  ([copy]) => {
    const status = Schema.decodeUnknownSync(Status.Main)({
      $type: "sh.mschf.ratking.attention.status",
      delegate: "alpha/ea",
      state: "busy",
      version: "0.1",
    });

    const verdict = delegation(
      { copy, encrypted: true, kind: "message" },
      status,
      0
    );

    expect(verdict._tag).toBe("Direct");
    expect(verdict.reason._tag).toBe("encrypted");
  }
);

it.prop(
  "all replies stay Direct because pending asks are client-private; openAsk retains its more specific reason",
  [Arbitrary.schema(Schema.Boolean)],
  ([openAsk]) => {
    const status = Schema.decodeUnknownSync(Status.Main)({
      $type: "sh.mschf.ratking.attention.status",
      delegate: "alpha/ea",
      state: "dnd",
      version: "0.1",
    });

    const verdict = delegation({ kind: "reply", openAsk }, status, 0);
    expect(verdict._tag).toBe("Direct");
    expect(verdict.reason._tag).toBe(openAsk ? "openAsk" : "reply");
  }
);
