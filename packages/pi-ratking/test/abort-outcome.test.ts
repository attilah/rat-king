import { createEventBus } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
// @effect-diagnostics asyncFunction:off -- Pi's extension API is the Promise boundary under test.
/* oxlint-disable anti-slop/no-unknown-parameters -- isExecutable is the type guard that parses Pi's registered tool at the boundary. */
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import { RatKing } from "@rat-king/ratking-client/ratking";
import {
  Arbitrary,
  Effect,
  FileSystem,
  Layer,
  Option,
  Predicate,
  Ref,
  Schedule,
  Schema,
} from "effect";
import { expect } from "vitest";

import { document, identity } from "../../mailbox-client/test/identity.ts";
import { ratkingExtension } from "../src/extension.ts";
import type {
  ExtensionOptions,
  PiHost,
  SessionStart,
} from "../src/extension.ts";
import { resultView } from "../src/tool-view.ts";
import { cancelledText, idleDispatch, runAction } from "../src/tool.ts";
import type { ToolParamsValue } from "../src/tool.ts";
import { fakeMailbox, quietSocket } from "./fake-mailbox.ts";
import type { MailboxMode } from "./fake-mailbox.ts";
import { harness } from "./harness.ts";
import { startSession } from "./start-session.ts";
import { ansiTheme } from "./view-arbitraries.ts";

const idle = async () => {};

const plain = (lines: readonly string[]) =>
  lines.map(stripTerminalSequences).join("\n");

const sentFact = (unsent: boolean, stopped: boolean) => {
  if (unsent) {
    return false;
  }

  return stopped ? true : "uncertain";
};

const until = (ready: () => boolean) =>
  Effect.sync(ready).pipe(
    Effect.repeat({
      schedule: Schedule.spaced("5 millis"),
      until: (done) => done,
    })
  );

const Phase = Schema.Literals(["idle", "issued", "delivered"]);

const Width = Schema.Int.check(Schema.isBetween({ maximum: 120, minimum: 20 }));

const GLYPHS = { delivered: "↩", idle: "✗", issued: "!" } as const;

const render = (
  phase: typeof Phase.Type,
  width: number,
  durationMs: number
) => {
  const result = cancelledText({ to: "peer" }, phase);

  return plain(
    resultView(
      {
        action: "ask",
        details: { ...result.details, durationMs },
        expanded: false,
        isError: result.isError,
        isPartial: false,
        text: result.text,
      },
      ansiTheme
    ).render(width)
  ).split("\n");
};

it.effect.prop(
  "a cancelled result renders the gutter glyph for its truth and a dim footer with duration and cancelled",
  [
    Arbitrary.schema(Phase),
    Arbitrary.schema(Width),
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 600_000, minimum: 0 }))
    ),
  ],
  ([phase, width, durationMs]) =>
    Effect.sync(() => {
      const lines = render(phase, width, durationMs);

      expect(lines[0]?.startsWith(GLYPHS[phase])).toBe(true);
      expect(lines.join(" ").replaceAll(/\s+/gu, " ")).toMatch(
        durationMs < 1000 ? / ms · cancelled$/u : / s · cancelled$/u
      );

      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    })
);

const Plan = Schema.Union([
  Schema.Struct({
    action: Schema.Literals(["send", "ask", "wait"]),
    point: Schema.Literals(["before", "inflight"]),
  }),
  Schema.Struct({
    action: Schema.Literal("wait"),
    point: Schema.Literal("after"),
  }),
]);

const callFor = (action: "send" | "ask" | "wait") => {
  const call: ToolParamsValue = {
    action: action === "send" ? "send" : "ask",
    message: "hello",
    timeoutSeconds: 600,
    to: "peer",
  };

  if (action === "wait") {
    Object.assign(call, { wait: true });
  }

  return call;
};

const ToolResult = Schema.Struct({
  content: Schema.Array(
    Schema.Struct({
      text: Schema.optionalKey(Schema.String),
      type: Schema.String,
    })
  ),
  details: Schema.Unknown,
  isError: Schema.optionalKey(Schema.Boolean),
});

type NoContext = Readonly<Record<string, never>>;

interface ExecutableTool {
  readonly execute: (
    id: string,
    call: ToolParamsValue,
    signal: AbortSignal | undefined,
    update: undefined,
    context: NoContext
  ) => Promise<typeof ToolResult.Type>;
}

const isExecutable = (value: unknown): value is ExecutableTool =>
  Predicate.hasProperty(value, "execute") &&
  Predicate.isFunction(value.execute);

const executeTool = async (
  tool: ExecutableTool,
  call: ToolParamsValue,
  signal: AbortSignal
) => await tool.execute("call", call, signal, undefined, {});

const startedTool = (layer: ExtensionOptions["layer"]) =>
  Effect.promise(async () => {
    let started: (start: SessionStart) => Promise<void> = idle;
    let ended: () => Promise<void> = idle;
    let tool: ExecutableTool | undefined;

    const pi: PiHost = {
      events: createEventBus(),
      onSessionEnd: (handler) => {
        ended = handler;
      },
      onSessionStart: (handler) => {
        started = handler;
      },
      registerMessageRenderer: () => {},
      registerTool: (definition) => {
        if (isExecutable(definition)) {
          tool = definition;
        }
      },
      sendMessage: () => {},
    };

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

    await startSession(started, { session: "abort-test", warn: () => {} });

    if (tool === undefined) {
      throw new Error("tool not registered");
    }

    return { end: ended, tool };
  });

it.live.prop(
  "cancelling at any point yields exactly one outcome, consistent with whether the mailbox saw the request",
  [Arbitrary.schema(Plan)],
  ([plan]) =>
    Effect.gen(function* cancelAnywhere() {
      const { point } = plan;
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const mode: MailboxMode = point === "inflight" ? "hold" : "accept";
      const mailbox = fakeMailbox(mode);
      const peer = yield* identity("did:web:peer.agents.example.invalid");
      const peerDocument = yield* document(peer);

      const layer = Layer.effectDiscard(
        Directory.use((directory) =>
          directory.record("peer", peerDocument).pipe(Effect.orDie)
        )
      ).pipe(
        Layer.provideMerge(harness(state, mailbox.http)),
        Layer.provideMerge(quietSocket)
      );

      const { end, tool } = yield* startedTool(layer);

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await end();
        })
      );
      const controller = new AbortController();

      if (point === "before") {
        controller.abort();
      }

      const call = executeTool(tool, callFor(plan.action), controller.signal);

      if (point !== "before") {
        yield* until(() => mailbox.requests.length > 0);
      }

      if (point === "after") {
        yield* Effect.sleep("300 millis");
      }

      if (point !== "before") {
        controller.abort();
      }

      const result = yield* Effect.promise(async () => await call);

      const text = result.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("");

      const saw = mailbox.requests.length > 0;
      const accepted = saw && mode === "accept";

      expect(saw).toBe(point !== "before");

      const [unsent, uncertain, stopped] = [
        text.startsWith("CANCELLED: not sent."),
        text.startsWith("CANCELLED: outcome uncertain."),
        text.startsWith("ASK SENT; stopped waiting."),
      ];

      expect([unsent, uncertain, stopped].filter(Boolean)).toHaveLength(1);
      expect(unsent).toBe(!saw);
      expect(stopped).toBe(accepted);
      expect(uncertain).toBe(saw && !accepted);
      expect(result.isError === true).toBe(!stopped);
      expect(result.details).toMatchObject({
        cancelled: true,
        sent: sentFact(unsent, stopped),
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 14 }, timeout: 120_000 }
);

const Plain = Schema.Literals(["send", "status", "list", "pending"]);

it.live.prop(
  "tracking the dispatch never changes a non-cancelled result, and only transmitting actions leave the phase issued",
  [Arbitrary.schema(Plain)],
  ([action]) =>
    Effect.gen(function* untouched() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const mailbox = fakeMailbox("accept");
      const peer = yield* identity("did:web:peer.agents.example.invalid");

      yield* Effect.gen(function* proof() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record("peer", yield* document(peer));

        yield* ratking.run(
          {
            alive: () => false,
            env: Option.some("tester"),
            pane: Option.none(),
            pid: 1,
            reads: false,
            session: "identity-test",
          },
          () => Effect.void
        );

        const input = { action, message: "hello", to: "peer" };
        const dispatch = idleDispatch();
        const plainRun = yield* runAction("ratking", 600, input);
        const tracked = yield* runAction("ratking", 600, input, dispatch);
        const ids = /id [0-9a-z]+, seq \d+/gu;

        expect(tracked.text.replaceAll(ids, "id _, seq _")).toBe(
          plainRun.text.replaceAll(ids, "id _, seq _")
        );
        expect(tracked.isError).toBe(plainRun.isError);
        expect(Ref.getUnsafe(dispatch)).toBe(
          action === "send" ? "issued" : "idle"
        );
      }).pipe(Effect.provide(harness(state, mailbox.http)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 8 }, timeout: 120_000 }
);
