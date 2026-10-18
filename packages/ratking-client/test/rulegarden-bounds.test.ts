import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { expect } from "vitest";

import { validateRecord } from "../src/agentgraph.ts";

it.effect.prop(
  "rule garden accepts inclusive source and payload length and integer boundaries",
  [Schema.Boolean],
  ([maximum]) =>
    Effect.gen(function* inclusiveBounds() {
      const text = (max: number) => "x".repeat(maximum ? max : 1);
      const hash = "a".repeat(64);
      const integer = maximum ? Number.MAX_SAFE_INTEGER : 0;

      const source = {
        host: text(64),
        line: maximum ? Number.MAX_SAFE_INTEGER : 1,
        path: text(512),
        quote: text(1200),
        sha256: hash,
      };

      const at = "2026-01-02T03:04:05Z";

      const finding = {
        action: "adopt-principle",
        at,
        bytesSaved: integer,
        claim: text(1200),
        evidence: maximum ? [text(600)] : [],
        id: hash,
        joelQuote: { source: text(300), text: text(600) },
        kind: "principle",
        load: "on-demand",
        owner: text(200),
        peon: text(200),
        principles: maximum ? [text(300)] : [],
        proposal: text(1600),
        severity: "high",
        spans: [source],
        staleRefs: maximum ? [text(200)] : [],
        wave: integer,
      };

      const event = {
        at,
        by: text(200),
        commit: text(120),
        findingId: hash,
        kind: "fixed",
        repo: text(200),
        text: text(1200),
      };

      expect(
        yield* validateRecord("sh.mschf.rulegarden.finding", finding)
      ).toEqual({
        $type: "sh.mschf.rulegarden.finding",
        ...finding,
      });
      expect(yield* validateRecord("sh.mschf.rulegarden.event", event)).toEqual(
        {
          $type: "sh.mschf.rulegarden.event",
          ...event,
        }
      );
      expect(
        yield* validateRecord("sh.mschf.rulegarden.event", {
          at,
          by: text(200),
          findingId: hash,
          kind: "dispute",
          source,
          text: text(1200),
        })
      ).toHaveProperty("source", source);
    })
);
