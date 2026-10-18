import { Failure, SliceResult } from "@rat-king/remembers";
import type { judgeStep, observerStep } from "@rat-king/remembers/steps";
import { Effect, Schema } from "effect";

const Observer = Schema.Struct({
  agent: Schema.Struct({
    model: Schema.Literal("gpt-6.1-sol"),
    thinking: Schema.Literal("low"),
  }),
  ephemeral: Schema.Struct({
    capability: Schema.Literal("remembers-slice"),
    input: Schema.Struct({
      conversation: Schema.NonEmptyString,
      first: Schema.NonEmptyString,
      last: Schema.NonEmptyString,
    }),
  }),
  kind: Schema.Literal("think"),
  post: Schema.Struct({ capability: Schema.Literal("remembers-observed") }),
  prompt: Schema.NonEmptyString,
  writes: Schema.Literal("result"),
});

const Judge = Schema.Struct({
  agent: Schema.Struct({ model: Schema.Literal("gpt-6-astra") }),
  ephemeral: Schema.Struct({
    capability: Schema.Literal("remembers-judge-input"),
    reads: Schema.Tuple([Schema.Literal("observed")]),
  }),
  kind: Schema.Literal("think"),
  post: Schema.Struct({ capability: Schema.Literal("remembers-judged") }),
  prompt: Schema.NonEmptyString,
  writes: Schema.Literal("result"),
});

const HostStep = Schema.Union([Observer, Judge]);

const envelope = {
  maxAgents: 1,
  maxDepth: 1,
  maxSteps: 4,
  maxThinking: "low",
  models: ["gpt-6.1-sol", "gpt-6-astra"],
  names: [],
  thresholds: { judge: 1 },
} as const;

export const buildPlan = (
  step: ReturnType<typeof observerStep> | ReturnType<typeof judgeStep>
) =>
  ({
    defaults: { agent: { model: "gpt-6.1-sol", thinking: "low" } },
    envelope,
    id: "remembers-job",
    machine: {
      id: "remembers-job",
      initial: "work",
      states: {
        done: { type: "final" },
        work: { meta: { step }, on: { done: { target: "done" } } },
      },
    },
    version: 1,
  }) as const;

const Plan = Schema.Struct({
  defaults: Schema.Struct({
    agent: Schema.Struct({
      model: Schema.Literal("gpt-6.1-sol"),
      thinking: Schema.Literal("low"),
    }),
  }),
  envelope: Schema.Struct({
    maxAgents: Schema.Literal(1),
    maxDepth: Schema.Literal(1),
    maxSteps: Schema.Literal(4),
    maxThinking: Schema.Literal("low"),
    models: Schema.Tuple([
      Schema.Literal("gpt-6.1-sol"),
      Schema.Literal("gpt-6-astra"),
    ]),
    names: Schema.Tuple([]),
    thresholds: Schema.Struct({ judge: Schema.Literal(1) }),
  }),
  id: Schema.Literal("remembers-job"),
  machine: Schema.Struct({
    id: Schema.Literal("remembers-job"),
    initial: Schema.Literal("work"),
    states: Schema.Struct({
      done: Schema.Struct({ type: Schema.Literal("final") }),
      work: Schema.Struct({
        meta: Schema.Struct({ step: HostStep }),
        on: Schema.Struct({
          done: Schema.Struct({ target: Schema.Literal("done") }),
        }),
      }),
    }),
  }),
  version: Schema.Literal(1),
});

export const Submission = Schema.Struct({
  docs: Schema.optionalKey(Schema.Struct({ observed: SliceResult })),
  plan: Plan,
  runId: Schema.NonEmptyString,
});

export const validateSubmission = (input: Schema.Json) =>
  Schema.decodeUnknownEffect(Submission, { onExcessProperty: "error" })(
    input
  ).pipe(
    Effect.mapError(
      () => new Failure({ code: "unsafe_plan", operation: "submit" })
    )
  );

export const decodeSafeResult = (input: Schema.Json) =>
  Schema.decodeUnknownEffect(SliceResult, { onExcessProperty: "error" })(
    input
  ).pipe(
    Effect.mapError(
      () => new Failure({ code: "unsafe_result", operation: "worker" })
    )
  );

const WorkerReport = Schema.Struct({
  docs: Schema.Record(Schema.String, Schema.Json),
  runId: Schema.String,
  status: Schema.String,
});

export const safeWorkerReport = Effect.fn("RemembersHost.safeReport")(
  function* safeWorkerReport(input: Schema.Json) {
    const report = yield* Schema.decodeUnknownEffect(WorkerReport)(input).pipe(
      Effect.mapError(
        () => new Failure({ code: "unsafe_report", operation: "worker" })
      )
    );

    const docs = yield* Effect.forEach(([name, value]: [string, Schema.Json]) =>
      Effect.gen(function* document() {
        if (name !== "result" && name !== "observed") {
          return yield* new Failure({
            code: "unsafe_document",
            operation: "worker",
          });
        }

        return [name, yield* decodeSafeResult(value)] as const;
      })
    )(Object.entries(report.docs));

    return {
      docs: Object.fromEntries(docs),
      runId: report.runId,
      status: report.status,
    };
  }
);
