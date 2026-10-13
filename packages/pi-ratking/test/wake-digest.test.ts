import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
// @effect-diagnostics asyncFunction:off -- Pi's Promise boundary under test.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { COPY_NOTE } from "@rat-king/ratking-client/payload";
import type { Inbound } from "@rat-king/ratking-client/payload";
import { RatKing } from "@rat-king/ratking-client/ratking";
import type { Deliver } from "@rat-king/ratking-client/ratking";
import {
  Arbitrary,
  Clock,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import {
  digestDetails,
  ratkingExtension,
  renderDigest,
} from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { digestView } from "../src/notice-view.ts";
import { DIGEST_MESSAGE, inbox, shownIds } from "../src/pending.ts";
import type { PendingMail } from "../src/pending.ts";
import { harness } from "./harness.ts";
import { mail, themes } from "./inline-fixtures.ts";

const idle = async () => {};

const nothing = () => {};

const ignoreShown = (_id: string) => {};

const ignoreDelivery: Deliver = () => Effect.void;

const Count = Schema.Int.check(Schema.isBetween({ maximum: 16, minimum: 2 }));

const held = (index: number): PendingMail => ({
  coalesce: true,
  content: "Full mail",
  details: {
    ...mail,
    body: `Full message ${index} with all its context.`,
    id: `3${String(index).padStart(7, "0")}abcd`,
    replyTo: index === 0 ? "30000001abcd" : undefined,
    summary: `Summary ${index}`,
  },
  id: `3${String(index).padStart(7, "0")}abcd`,
});

const arrival = (index: number): Inbound => ({
  body: `Full message ${index}`,
  cc: true,
  copy: true,
  did: mail.did,
  from: mail.from,
  id: held(index).id,
  kind: "message",
  label: Option.none(),
  replyTo: Option.none(),
  summary: Option.some(`Summary ${index}`),
  verified: true,
});

it.each(
  themes.flatMap(({ name, theme }) =>
    [40, 60, 80, 120].flatMap((width) =>
      [false, true].map((expanded) => ({ expanded, name, theme, width }))
    )
  )
)(
  "wake digest $name at $width, expanded $expanded",
  ({ expanded, theme, width }) => {
    const mails = Array.from({ length: 10 }, (_value, index) => held(index));
    const content = renderDigest("ratking", mails, "wake");

    const details = {
      ...digestDetails(mails, "wake"),
      messages: mails.map((value) => value.details),
    };

    expect(
      digestView({ content, details, expanded, theme })
        .render(width)
        .map(stripTerminalSequences)
    ).toMatchSnapshot();
  }
);

it.effect.prop(
  "quiet Next arrivals coalesce at before_agent_start, every model id is present, and only displayed ids are acked exactly once",
  [Arbitrary.schema(Count)],
  ([count]) =>
    Effect.gen(function* wakeCustody() {
      let start: (facts: SessionStart) => Promise<void> = idle;
      let end: () => Promise<void> = idle;
      let before = nothing;
      let shown = ignoreShown;
      let deliver = ignoreDelivery;

      const sent: {
        readonly content: unknown;
        readonly customType: string;
        readonly details?: unknown;
      }[] = [];

      const acknowledgments = Array.from({ length: count }, () => 0);

      const acked = yield* Effect.all(
        acknowledgments.map(() => Deferred.make<boolean>())
      );

      const clock = yield* Clock.Clock;
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();

      const layer = Layer.mergeAll(
        harness(
          state,
          HttpClient.make(() => Effect.die("Unexpected request"))
        ),
        Layer.mock(RatKing, {
          run: (_facts, handler) =>
            Effect.sync(() => {
              deliver = handler;
            }),
        }),
        Layer.succeed(Clock.Clock, clock)
      );

      const pi: PiHost = {
        events: { emit: nothing, on: () => nothing },
        onBeforeAgentStart: (handler) => {
          before = handler;
        },
        onMessageShown: (handler) => {
          shown = handler;
        },
        onSessionEnd: (handler) => {
          end = handler;
        },
        onSessionStart: (handler) => {
          start = handler;
        },
        registerMessageRenderer: nothing,
        registerTool: nothing,
        sendMessage: (message, options) => {
          if (message.customType === DIGEST_MESSAGE) {
            expect(options?.deliverAs).toBe("nextTurn");
            expect(options?.triggerTurn).toBe(false);
          } else {
            expect(options?.deliverAs).toBe("steer");
          }

          sent.push(message);
        },
      };

      yield* Effect.promise(async () => {
        await ratkingExtension({
          facts: (session) =>
            Effect.succeed({
              alive: () => true,
              env: Option.none(),
              pane: Option.none(),
              pid: 1,
              session,
            }),
          layer,
          tool: Effect.succeed("ratking"),
        })(pi);
        await start({ session: "wake-digest", warn: nothing });
      });
      yield* Effect.addFinalizer(() => Effect.promise(end));

      for (let index = 0; index < count; index += 1) {
        const done = acked[index];

        if (done === undefined) {
          throw new Error("Missing ack gate");
        }

        yield* deliver(
          arrival(index),
          false,
          Effect.sync(() => {
            acknowledgments[index] = (acknowledgments[index] ?? 0) + 1;
          }).pipe(Effect.andThen(Deferred.succeed(done, true)), Effect.asVoid)
        );
      }

      expect(sent).toHaveLength(0);
      expect(acknowledgments).toEqual(Array.from({ length: count }, () => 0));

      for (const kind of ["message", "ask"] as const) {
        yield* deliver(
          {
            ...arrival(0),
            cc: kind === "ask",
            copy: kind === "ask",
            id: `direct-${kind}`,
            kind,
            label: Option.none(),
            replyTo: Option.none(),
            summary: Option.none(),
          },
          false
        );
      }

      expect(sent).toHaveLength(2);
      before();
      before();
      expect(sent).toHaveLength(3);
      const message = sent.find((entry) => entry.customType === DIGEST_MESSAGE);

      expect(message?.customType).toBe(DIGEST_MESSAGE);
      const content = String(message?.content);
      const lines = content.split("\n").filter((line) => line.startsWith("- "));

      expect(lines).toHaveLength(count);
      expect(content.split(COPY_NOTE)).toHaveLength(2);
      expect(content.split("To reply:")).toHaveLength(2);
      expect(acknowledgments).toEqual(Array.from({ length: count }, () => 0));
      shown("not-in-the-digest");
      const ids = shownIds({ ...message, role: "custom" });

      expect(ids).toEqual(
        Array.from({ length: count }, (_value, index) => held(index).id)
      );

      for (const id of ids) {
        expect(lines.some((line) => line.includes(`id ${id}`))).toBe(true);
        shown(id);
        shown(id);
      }

      yield* Effect.all(acked.map((gate) => Deferred.await(gate)));
      expect(acknowledgments).toEqual(Array.from({ length: count }, () => 1));
      before();
      expect(sent).toHaveLength(3);
      yield* Effect.promise(async () => {
        await end();
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "wake views group replies under their roots, cap at eight rows plus more, fit 20–200 in both themes and expand to all full bodies",
  [Arbitrary.schema(Count)],
  ([count]) =>
    Effect.sync(() => {
      const mails = Array.from({ length: count }, (_value, index) =>
        held(index)
      );

      const content = renderDigest("ratking", mails, "wake");

      const details = {
        ...digestDetails(mails, "wake"),
        messages: mails.map((value) => value.details),
      };

      expect(content).toContain(`reply to ${held(1).id}`);

      for (const { theme } of themes) {
        for (let width = 20; width <= 200; width += 1) {
          const collapsed = digestView({
            content,
            details,
            expanded: false,
            theme,
          })
            .render(width)
            .map(stripTerminalSequences);

          expect(collapsed.length).toBeLessThanOrEqual(11);
          expect(collapsed[1]).toContain(held(1).id.slice(0, 8));
          expect(collapsed[2]).toMatch(/^ {2}/u);

          for (const line of collapsed) {
            expect(visibleWidth(line)).toBeLessThanOrEqual(width);
          }

          if ([40, 60, 80, 120].includes(width)) {
            const expanded = digestView({
              content,
              details,
              expanded: true,
              theme,
            })
              .render(width)
              .map(stripTerminalSequences)
              .join("\n");

            for (let index = 0; index < count; index += 1) {
              expect(expanded).toContain(`Full message ${index}`);
            }
          }
        }
      }
    })
);

it.effect.prop(
  "one buffered mail uses the existing single-message path, failed sends retain custody, and clearing emits nothing",
  [Arbitrary.schema(Schema.Boolean)],
  ([fail]) =>
    Effect.sync(() => {
      const sent: string[] = [];
      let rejecting = fail;

      const box = inbox({
        digest: () => {
          throw new Error("Unexpected digest");
        },
        show: (pending, mode) => {
          if (rejecting) {
            throw new Error("Rejected queue");
          }

          expect(mode).toBe("nextTurn");
          sent.push(pending.id);
        },
      });

      box.take(held(0), "nextTurn");

      if (fail) {
        expect(() => {
          box.flushNext();
        }).toThrow("Rejected queue");
      }

      rejecting = false;
      box.flushNext();
      box.flushNext();
      expect(sent).toEqual([held(0).id]);
      box.shown(held(0).id);
      box.take(held(1), "nextTurn");
      box.clear();
      box.flushNext();
      expect(sent).toEqual([held(0).id]);
    })
);
