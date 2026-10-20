/* oxlint-disable typescript/promise-function-async, promise/prefer-await-to-callbacks -- Promise thunks are the pi-durable adapter boundary. */
// @effect-diagnostics asyncFunction:off -- Upstream Harness methods return Promises.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { AssistantEntry, Harness } from "@earendil-works/pi-durable";
import type {
  AgentChange,
  HarnessOptions,
  ModelRef,
  Storage,
  SubmissionId as PiSubmissionId,
} from "@earendil-works/pi-durable";
import { Effect, Layer, Schema } from "effect";

import {
  AgentHarness,
  HarnessFailure,
  Settlement,
  SubmissionId,
} from "./port.ts";

const UpstreamSubmissionId = Schema.declare<PiSubmissionId>(
  (value): value is PiSubmissionId => Schema.is(SubmissionId)(value)
);

const operation = <A>(name: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) =>
      Schema.is(HarnessFailure)(cause)
        ? cause
        : new HarnessFailure({
            operation: name,
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
    try: run,
  });

export const piDurableLayer = (
  storage: Storage,
  options: HarnessOptions,
  model: ModelRef,
  agent: Pick<AgentChange, "thinkingLevel"> = {},
  reconcileModel = false
) =>
  Layer.effect(
    AgentHarness,
    Effect.gen(function* open() {
      const harness = yield* Effect.acquireRelease(
        operation("open", () =>
          Harness.open(storage, options, BACKGROUND_CONTEXT)
        ),
        (owned) =>
          operation("close", () => owned.close(BACKGROUND_CONTEXT)).pipe(
            Effect.orDie
          )
      );

      const root = yield* operation("root", () =>
        harness.root(BACKGROUND_CONTEXT, {
          agent: { ...agent, model },
        })
      );

      if (reconcileModel) {
        const current = yield* operation("configured-model", () =>
          root.agent(BACKGROUND_CONTEXT)
        );

        if (
          current.model?.provider !== model.provider ||
          current.model?.modelId !== model.modelId
        ) {
          const pending = yield* operation("inspect-model-switch", () =>
            harness.inspect(BACKGROUND_CONTEXT)
          );

          if (pending.tasks.length > 0 || pending.submissions.length > 0) {
            return yield* new HarnessFailure({
              operation: "configure",
              reason: "Model switch requires an idle harness",
            });
          }

          yield* operation("reset-model-context", () =>
            root.reset(undefined, BACKGROUND_CONTEXT)
          );
          yield* operation("configure-model", () =>
            root.configure({ ...agent, model }, BACKGROUND_CONTEXT)
          );
        }
      }

      const requireProgress = async () => {
        const inspection = await harness.inspect(BACKGROUND_CONTEXT);

        const parked = inspection.tasks.filter(
          ({ state }) =>
            state.kind === "blocked" && state.reason === "restart_limit"
        );

        if (parked.length > 0) {
          throw new HarnessFailure({
            operation: "restart_limit",
            reason: `Parked tasks ${parked.map(({ record }) => record.id).join(", ")}; explicit retryTask() required`,
          });
        }
      };

      return AgentHarness.of({
        resume: Effect.fn("AgentHarness.resume")(() =>
          operation("resume", async () => {
            await requireProgress();
            harness.resume();
          })
        ),
        submit: Effect.fn("AgentHarness.submit")(function* submit(input) {
          const submission = yield* operation("submit", async () => {
            await requireProgress();

            return await root.submit(
              {
                content: input.content,
                requestId: input.requestId,
                type: "input",
              },
              BACKGROUND_CONTEXT
            );
          });

          return yield* Schema.decodeUnknownEffect(SubmissionId)(
            submission.id
          ).pipe(
            Effect.mapError(
              () =>
                new HarnessFailure({
                  operation: "submit",
                  reason: "Invalid persisted submission ID",
                })
            )
          );
        }),
        wait: Effect.fn("AgentHarness.wait")(function* wait(id) {
          const result = yield* operation("wait", async () => {
            await requireProgress();

            const submission = await harness.submission(
              Schema.decodeUnknownSync(UpstreamSubmissionId)(id),
              BACKGROUND_CONTEXT
            );

            if (!submission) {
              throw new Error("Submission not found");
            }

            const settled = await submission.wait(BACKGROUND_CONTEXT);

            if (settled.status !== "done" || settled.type !== "input") {
              return Settlement.cases.Unanswered.make({
                id,
                reason:
                  "reason" in settled
                    ? [
                        settled.reason,
                        "detail" in settled
                          ? JSON.stringify(settled.detail)
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(": ")
                    : settled.status,
              });
            }

            const entry = await root.commit(
              (tx) => tx.entry(AssistantEntry, settled.answer),
              BACKGROUND_CONTEXT
            );

            const message = entry?.model?.find(
              (item) => item.role === "assistant"
            );

            if (!message) {
              throw new Error(
                "Settled answer entry is missing its assistant message"
              );
            }

            const answer = message.content
              .flatMap((block) => (block.type === "text" ? [block.text] : []))
              .join("");

            return Settlement.cases.Done.make({ answer, id });
          });

          return result;
        }),
      });
    })
  );
