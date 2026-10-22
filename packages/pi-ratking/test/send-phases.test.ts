import { createEventBus } from "@earendil-works/pi-coding-agent";
// @effect-diagnostics asyncFunction:off -- Pi's extension API is the Promise boundary under test.
/* oxlint-disable anti-slop/no-unknown-parameters -- isExecutable is the type guard that parses Pi's registered tool at the boundary. */
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import {
  Arbitrary,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Predicate,
  Schedule,
  Schema,
} from "effect";
import { expect } from "vitest";

import { document, identity } from "../../mailbox-client/test/identity.ts";
import { ratkingExtension } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { STARTING_PHASE } from "../src/tool.ts";
import type { ToolParamsValue } from "../src/tool.ts";
import { fakeMailbox, quietSocket } from "./fake-mailbox.ts";
import type { MailboxMode } from "./fake-mailbox.ts";
import { harness } from "./harness.ts";

const Update = Schema.Struct({
  content: Schema.Array(Schema.Struct({ text: Schema.String })),
  details: Schema.Struct({ phase: Schema.String }),
});

const Outcome = Schema.Struct({
  content: Schema.Array(Schema.Struct({ text: Schema.String })),
  isError: Schema.optionalKey(Schema.Boolean),
});

interface ExecutableTool {
  readonly execute: (
    id: string,
    call: ToolParamsValue,
    signal: AbortSignal | undefined,
    update: (partial: unknown) => void,
    context: Readonly<Record<string, never>>
  ) => Promise<typeof Outcome.Type>;
}

const isExecutable = (value: unknown): value is ExecutableTool =>
  Predicate.hasProperty(value, "execute") &&
  Predicate.isFunction(value.execute);

const until = (ready: () => boolean) =>
  Effect.sync(ready).pipe(
    Effect.repeat({
      schedule: Schedule.spaced("5 millis"),
      until: (done) => done,
    })
  );

const Plan = Schema.Struct({
  action: Schema.Literals(["send", "encrypted", "ask-wait", "retry"]),
  duringStartup: Schema.Boolean,
});

type PlanValue = typeof Plan.Type;

const callFor = (action: PlanValue["action"]): ToolParamsValue =>
  action === "ask-wait"
    ? {
        action: "ask",
        message: "hello",
        timeoutSeconds: 600,
        to: "peer",
        wait: true,
      }
    : {
        action: "send",
        encrypt: action === "encrypted",
        message: "hello",
        to: "peer",
      };

const modeFor = (action: PlanValue["action"]): MailboxMode =>
  action === "retry" ? "flaky" : "accept";

const afterResolving: Readonly<Record<PlanValue["action"], readonly string[]>> =
  {
    "ask-wait": ["sending", "awaiting reply from peer"],
    encrypted: ["sealing", "sending"],
    retry: ["sending", "retrying (MailboxUnavailable, attempt 2)"],
    send: ["sending"],
  };

const collapse = (phases: readonly string[]) =>
  phases.filter((phase, index) => phase !== phases[index - 1]);

const waits = (plan: PlanValue) => {
  if (plan.action === "ask-wait") {
    return ["waiting for reader"];
  }

  return plan.duringStartup ? ["waiting for identity"] : [];
};

const expectedPhases = (plan: PlanValue) =>
  [[], ...waits(plan).map((wait) => [wait, "resolving peer"])].map((detour) => [
    ...(plan.duringStartup ? [STARTING_PHASE] : []),
    "resolving peer",
    ...detour,
    ...afterResolving[plan.action],
  ]);

it.live.prop(
  "every send names each phase in order from its first frame, before any mailbox call, including while Rat King starts",
  [Arbitrary.schema(Plan)],
  ([plan]) =>
    Effect.gen(function* sendPhases() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const mailbox = fakeMailbox(modeFor(plan.action));
      const peer = yield* identity("did:web:peer.agents.example.invalid");
      const peerDocument = yield* document(peer);
      const gate = yield* Deferred.make<boolean>();
      const statuses: (string | undefined)[] = [];
      const updates: (typeof Update.Type)[] = [];
      const requestsAtUpdate: number[] = [];

      if (!plan.duringStartup) {
        yield* Deferred.succeed(gate, true);
      }

      const layer = Layer.effectDiscard(
        Deferred.await(gate).pipe(
          Effect.andThen(
            Directory.use((directory) =>
              directory.record("peer", peerDocument).pipe(Effect.orDie)
            )
          )
        )
      ).pipe(
        Layer.provideMerge(harness(state, mailbox.http)),
        Layer.provideMerge(quietSocket)
      );

      const host = {
        end: Option.none<() => Promise<void>>(),
        start: Option.none<(start: SessionStart) => Promise<void>>(),
        tool: Option.none<ExecutableTool>(),
      };

      const pi: PiHost = {
        events: createEventBus(),
        onSessionEnd: (handler) => {
          host.end = Option.some(handler);
        },
        onSessionStart: (handler) => {
          host.start = Option.some(handler);
        },
        registerMessageRenderer: () => {},
        registerTool: (definition) => {
          if (isExecutable(definition)) {
            host.tool = Option.some(definition);
          }
        },
        sendMessage: () => {},
      };

      yield* Effect.promise(async () => {
        await ratkingExtension({
          facts: (session) =>
            Effect.succeed({
              alive: () => false,
              env: Option.some("tester"),
              pane: Option.none(),
              pid: 1,
              session,
            }),
          layer,
          tool: Effect.succeed("ratking"),
        })(pi);
      });

      const start = yield* Effect.fromOption(host.start);
      const tool = yield* Effect.fromOption(host.tool);

      yield* Effect.addFinalizer(() =>
        Option.match(host.end, {
          onNone: () => Effect.void,
          onSome: (end) => Effect.promise(end),
        })
      );

      yield* Effect.promise(async () => {
        await start({
          session: "phases",
          status: (text) => {
            statuses.push(text);
          },
          warn: () => {},
        });
      });

      if (!plan.duringStartup) {
        yield* until(
          () => statuses.length > 2 && statuses.at(-1) === undefined
        );
      }

      const controller = new AbortController();
      const requestsBefore = mailbox.calls.length;

      const call = tool.execute(
        "call",
        callFor(plan.action),
        controller.signal,
        (partial) => {
          updates.push(Schema.decodeUnknownSync(Update)(partial));
          requestsAtUpdate.push(mailbox.calls.length);

          if (updates.at(-1)?.details.phase === "awaiting reply from peer") {
            controller.abort();
          }
        },
        {}
      );

      expect(updates).toHaveLength(1);
      expect(requestsAtUpdate[0]).toBe(requestsBefore);

      if (plan.duringStartup) {
        yield* Effect.sleep("50 millis");
        expect(
          collapse(updates.map((update) => update.details.phase))
        ).toStrictEqual([STARTING_PHASE]);
        expect(mailbox.calls).toHaveLength(0);
        yield* Deferred.succeed(gate, true);
      }

      const outcome = yield* Effect.promise(async () => await call);

      const text = outcome.content.map((part) => part.text).join("");
      const phases = collapse(updates.map((update) => update.details.phase));

      expect(outcome.isError ?? false).toBe(false);
      expect(text).toMatch(
        plan.action === "ask-wait" ? /^ASK SENT; stopped waiting/u : /peer/u
      );
      expect(expectedPhases(plan)).toContainEqual(phases);

      for (const update of updates) {
        expect(update.content[0]?.text.startsWith(update.details.phase)).toBe(
          true
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 16 }, timeout: 120_000 }
);
