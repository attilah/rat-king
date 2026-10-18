import { it } from "@effect/vitest";
import { emptyBooks } from "@rat-king/remembers";
import { observerStep } from "@rat-king/remembers/steps";
import { Arbitrary, Effect, Exit, Function as Fn, Schema } from "effect";
import { expect } from "vitest";

import {
  decodeSafeResult,
  buildPlan,
  safeWorkerReport,
  validateSubmission,
} from "../src/plans.ts";
import {
  cursorJob,
  defectCountJob,
  promisedResponse,
} from "../src/source-jobs.ts";

const key = {
  conversation: "invented",
  first_chunk: "first",
  last_chunk: "last",
};

it.effect.prop(
  "raw evidence cannot be submitted as a journaled capability or decoded as a safe result",
  {
    capability: Arbitrary.schema(
      Schema.Literals(["remembers-slice", "remembers-judge-input"])
    ),
  },
  ({ capability }) =>
    Effect.gen(function* boundary() {
      const safe = buildPlan(observerStep(key, "fixture prefix", "result"));
      expect(
        Exit.isSuccess(
          yield* Effect.exit(
            validateSubmission({ plan: safe, runId: "fixture" })
          )
        )
      ).toBe(true);

      const unsafe = {
        ...safe,
        machine: {
          ...safe.machine,
          states: {
            done: { type: "final" },
            work: {
              meta: { step: { capability, kind: "call", writes: "result" } },
              on: { done: { target: "done" } },
            },
          },
        },
      };

      expect(
        Exit.isFailure(
          yield* Effect.exit(
            validateSubmission({ plan: unsafe, runId: "fixture" })
          )
        )
      ).toBe(true);
      const raw = { chunks: [{ text: "invented raw evidence" }], key };
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            safeWorkerReport({
              docs: { result: raw },
              runId: "fixture",
              status: "done",
            })
          )
        )
      ).toBe(true);

      const projected = yield* safeWorkerReport({
        docs: { result: { books: emptyBooks(), candidates: [], key } },
        failures: [{ reason: "invented raw evidence" }],
        runId: "fixture",
        status: "done",
      });

      expect(JSON.stringify(projected)).not.toContain("invented raw evidence");
      expect(Exit.isFailure(yield* Effect.exit(decodeSafeResult(raw)))).toBe(
        true
      );
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            decodeSafeResult({
              books: emptyBooks(),
              candidates: [],
              chunks: raw.chunks,
              key,
            })
          )
        )
      ).toBe(true);
    })
);

it.effect(
  "cursor stops at the first active window without skipping it; defect count uses the authoritative count endpoint",
  () =>
    Effect.gen(function* jobs() {
      const requests: string[] = [];

      const transport: typeof fetch = Fn.flow(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(new Request(input).url);
          requests.push(
            `${init?.method ?? "GET"} ${url.pathname}${url.search}`
          );

          if (url.pathname === "/count") {
            return Response.json({ by_day: [], conversations: 17 });
          }

          const after = url.searchParams.get("after");

          return Response.json(
            after === "0"
              ? {
                  items: [
                    {
                      chunk_id: "first",
                      conversation: "invented",
                      role: "user",
                      rowid: 1,
                      started_at: 100,
                      token_count: 1,
                    },
                    {
                      chunk_id: "last",
                      conversation: "invented",
                      role: "assistant",
                      rowid: 2,
                      started_at: 200,
                      token_count: 1,
                    },
                  ],
                  next: 2,
                }
              : { items: [], next: 2 }
          );
        },
        promisedResponse
      );

      const options = {
        baseUrl: "https://slice.invalid",
        bearer: "invented",
        dayEnd: 1000,
        dayStart: 0,
        idleMs: 1000,
        transport,
      };

      expect(yield* cursorJob(options)("")).toEqual({
        cursor: "2",
        keys: [key],
      });

      const defect = {
        component: "fixture",
        id: "fixture",
        impact: 1,
        owner: "fixture",
        signature: { literal: "invented literal", role: null },
      } as const;

      expect(yield* defectCountJob(options)(defect, 0)).toBe(17);
      expect(requests).toContain("POST /count");
      expect(requests.some((request) => request.includes("idle_ms=1000"))).toBe(
        true
      );
    })
);
