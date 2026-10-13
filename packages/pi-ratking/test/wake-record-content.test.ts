import { it } from "@effect/vitest";
import { Schema, Option } from "effect";
import { expect } from "vitest";

import { attend } from "../../ratking-client/src/attend.ts";
import { renderDigest } from "../src/extension.ts";

it.prop(
  "all four wake statuses get their attend intent default",
  [Schema.Literals(["matched", "timedOut", "targetGone", "failed"])],
  ([wakeStatus]) => {
    expect(
      attend({ kind: "data", wakeStatus }, {}, 0, undefined, Option.none())._tag
    ).toBe(
      wakeStatus === "matched" || wakeStatus === "timedOut" ? "Next" : "Now"
    );
  }
);

it.prop(
  "wake digest carries verbatim text for the model without cc-only instructions",
  [Schema.String.check(Schema.isMaxLength(200))],
  ([content]) => {
    const rendered = renderDigest(
      "ratking",
      [
        {
          content,
          details: { body: content, from: "worker", summary: "Watch finished" },
          id: "wake",
          wake: true,
        },
      ],
      "wake"
    );

    expect(rendered).toContain(content);
    expect(rendered).toContain("Watch finished");
    expect(rendered).not.toContain("You are cc'd");
    expect(rendered).not.toContain("To reply:");
  }
);
