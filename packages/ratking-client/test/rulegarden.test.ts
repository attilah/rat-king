import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { expect } from "vitest";

import { recordSummary, validateRecord } from "../src/agentgraph.ts";

const findingType = "sh.mschf.rulegarden.finding";

const eventType = "sh.mschf.rulegarden.event";

const id = "a".repeat(64);

const source = {
  host: "host-a",
  line: 1,
  path: "docs/example.md",
  quote: "Keep the example concise.",
  sha256: id,
};

const finding = {
  action: "narrow",
  at: "2026-01-02T03:04:05.000Z",
  bytesSaved: null,
  claim: "Two example rules overlap.",
  evidence: ["Invented evidence"],
  id,
  joelQuote: { source: "Example note", text: "Invented quote" },
  kind: "bloat",
  load: "always",
  owner: "example-team",
  peon: "example-reviewer",
  principles: ["Keep one rule per concern."],
  proposal: "Merge the two example rules.",
  severity: "low",
  spans: [source],
  staleRefs: ["Example reference"],
  wave: 0,
};

const common = {
  at: finding.at,
  by: "example-reviewer",
  findingId: id,
};

const textSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1200)
);

const variants = (text: string) => [
  { ...common, kind: "agree", text: null },
  { ...common, kind: "agree", text },
  { ...common, kind: "dispute", source, text },
  { ...common, kind: "evidence", source, text },
  { ...common, kind: "evidence", source: null, text },
  { ...common, kind: "comment", text },
  {
    ...common,
    commit: "abc123",
    kind: "fixed",
    repo: "example/rules",
    text: null,
  },
  { ...common, commit: "abc123", kind: "fixed", repo: "example/rules", text },
  { ...common, kind: "wontfix", text },
  { ...common, kind: "reopen", text },
  { ...common, kind: "duplicate", of: "b".repeat(64) },
];

it.effect.prop(
  "findings and every event kind validate and produce bounded summaries",
  [
    textSchema,
    Schema.Literals(["principle", "contradiction", "bloat", "stale"]),
    Schema.Literals(["high", "medium", "low"]),
    Schema.Boolean,
  ],
  ([text, kind, severity, nullable]) =>
    Effect.gen(function* validRecords() {
      const input = {
        ...finding,
        bytesSaved: nullable ? null : 42,
        claim: text,
        joelQuote: nullable
          ? null
          : { ...finding.joelQuote, extra: "retained" },
        kind,
        severity,
        spans: [{ ...source, extra: "retained" }],
      };

      const decoded = yield* validateRecord(findingType, input);
      expect(decoded).toEqual({ $type: findingType, ...input });
      expect(recordSummary(decoded)).toBe(
        `finding ${kind} ${severity}: ${text}`.slice(0, 280)
      );

      for (const event of variants(text)) {
        const result = yield* validateRecord(eventType, event);
        expect(result).toEqual({ $type: eventType, ...event });
        expect(recordSummary(result)).toBe(`event ${event.kind} aaaaaaaa`);
      }
    })
);

it.effect.prop(
  "unknown top-level keys are refused for findings and every event variant",
  [textSchema],
  ([text]) =>
    Effect.gen(function* unknownKeys() {
      for (const [type, input] of [
        [findingType, finding],
        ...variants(text).map((event) => [eventType, event] as const),
      ] as const) {
        const error = yield* validateRecord(type, {
          ...input,
          surprise: true,
        }).pipe(Effect.flip);

        expect(error.reason).toContain("unknown top-level key");
      }
    })
);

it.effect.prop(
  "event kinds require their own fields and refuse fields from other variants",
  [textSchema],
  ([text]) =>
    Effect.gen(function* variantBoundaries() {
      const fields = {
        commit: "abc123",
        of: id,
        repo: "example/rules",
        source,
        text,
      };

      for (const event of variants(text)) {
        for (const [key, value] of Object.entries(fields)) {
          if (!(key in event)) {
            expect(
              yield* validateRecord(eventType, { ...event, [key]: value }).pipe(
                Effect.flip
              )
            ).toHaveProperty("_tag", "InvalidRecord");
          }
        }

        for (const key of Object.keys(event)) {
          const missing = Object.fromEntries(
            Object.entries(event).filter(([name]) => name !== key)
          );

          expect(
            yield* validateRecord(eventType, missing).pipe(Effect.flip)
          ).toHaveProperty("_tag", "InvalidRecord");
        }
      }

      for (const input of [
        { ...common, kind: "duplicate", text },
        { ...common, kind: "comment", of: id, text },
        { ...common, kind: "fixed", text },
        { ...common, kind: "dispute", source: null, text },
        { ...common, kind: "unknown", text },
      ]) {
        expect(
          yield* validateRecord(eventType, input).pipe(Effect.flip)
        ).toHaveProperty("_tag", "InvalidRecord");
      }
    })
);

it.effect.prop(
  "finding lengths, source bounds, identities and datetime constraints are enforced",
  [Schema.Literals([0, 1, 7])],
  ([extra]) =>
    Effect.gen(function* fieldBoundaries() {
      const invalid = [
        ...Object.keys(finding).map((key) =>
          Object.fromEntries(
            Object.entries(finding).filter(([name]) => name !== key)
          )
        ),
        ...Object.entries({
          claim: 1200,
          owner: 200,
          peon: 200,
          proposal: 1600,
        }).flatMap(([key, max]) => [
          { ...finding, [key]: "" },
          { ...finding, [key]: "x".repeat(max + 1 + extra) },
        ]),
        ...Object.entries({
          evidence: 600,
          principles: 300,
          staleRefs: 200,
        }).flatMap(([key, max]) => [
          { ...finding, [key]: [""] },
          { ...finding, [key]: ["x".repeat(max + 1 + extra)] },
        ]),
        ...[
          { host: "Host_A" },
          { host: "" },
          { host: "x".repeat(65 + extra) },
          { path: "" },
          { path: "x".repeat(513 + extra) },
          { quote: "" },
          { quote: "x".repeat(1201 + extra) },
          { line: 0 },
          { line: 1.5 },
          { line: Number.MAX_SAFE_INTEGER + 1 },
          { sha256: "invalid" },
        ].map((patch) => ({ ...finding, spans: [{ ...source, ...patch }] })),
        { ...finding, spans: [] },
        { ...finding, id: "invalid" },
        { ...finding, bytesSaved: -1 },
        { ...finding, wave: -1 },
        { ...finding, wave: 1.5 },
        { ...finding, at: "not-a-date" },
        { ...finding, at: `${finding.at}${"x".repeat(41)}` },
        {
          ...finding,
          joelQuote: { source: "x".repeat(301 + extra), text: "Example" },
        },
        {
          ...finding,
          joelQuote: { source: "Example", text: "x".repeat(601 + extra) },
        },
      ];

      for (const input of invalid) {
        expect(
          yield* validateRecord(findingType, input).pipe(Effect.flip)
        ).toHaveProperty("_tag", "InvalidRecord");
      }

      for (const event of variants("Example")) {
        for (const patch of [
          { at: "not-a-date" },
          { at: `${finding.at}${"x".repeat(41)}` },
          { by: "" },
          { by: "x".repeat(201 + extra) },
          { findingId: "invalid" },
        ]) {
          expect(
            yield* validateRecord(eventType, { ...event, ...patch }).pipe(
              Effect.flip
            )
          ).toHaveProperty("_tag", "InvalidRecord");
        }

        for (const [key, max] of Object.entries({
          commit: 120,
          repo: 200,
          text: 1200,
        })) {
          if (key in event) {
            for (const value of ["", "x".repeat(max + 1 + extra)]) {
              expect(
                yield* validateRecord(eventType, {
                  ...event,
                  [key]: value,
                }).pipe(Effect.flip)
              ).toHaveProperty("_tag", "InvalidRecord");
            }
          }
        }
      }

      for (const kind of ["dispute", "evidence"]) {
        expect(
          yield* validateRecord(eventType, {
            ...common,
            kind,
            source: { ...source, quote: "x".repeat(1201 + extra) },
            text: "Example",
          }).pipe(Effect.flip)
        ).toHaveProperty("_tag", "InvalidRecord");
      }
    })
);
