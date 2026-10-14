import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import { Console, Effect, FileSystem, Schema } from "effect";
import { expect } from "vitest";

import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { runRatking } from "../src/main.ts";
import { Wiring } from "../src/session.ts";
import { captured, fakeMailbox, mail, people, seeded } from "./fixture.ts";

const Document = Schema.Struct({
  delivered: Schema.optionalKey(Schema.Struct({ id: Schema.String })),
  error: Schema.optionalKey(
    Schema.Struct({ tag: Schema.String, why: Schema.String })
  ),
  messages: Schema.optionalKey(
    Schema.Array(Schema.Struct({ id: Schema.String }))
  ),
  ok: Schema.Boolean,
  verdict: Schema.optionalKey(Schema.String),
});

const Cut = Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 }));

const session = Effect.fn("Legs.session")(function* session(
  bodies: readonly string[]
) {
  const fs = yield* FileSystem.FileSystem;
  const who = yield* people;

  const mails = yield* Effect.all(
    bodies.map((body, index) =>
      mail(who, index + 1, "accepted", {
        body,
        cc: [],
        kind: "message",
        thread: `thread-${body}`,
      })
    )
  );

  const mailbox = fakeMailbox(mails);

  const wiring = harness(
    yield* fs.makeTempDirectoryScoped(),
    mailbox.http,
    [],
    { secrets: seeded(who) }
  );

  yield* Directory.use((directory) =>
    directory.record("peer", who.peerDocument)
  ).pipe(Effect.provide(wiring));

  const run = Effect.fn("Legs.run")(function* run(args: readonly string[]) {
    const out = captured();

    yield* runRatking([...args, "--as", "tester", "--json"]).pipe(
      Effect.provideService(Console.Console, out.console),
      Effect.provideService(Wiring, wiring)
    );

    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Document))(
      out.stdout.join("\n")
    );
  });

  return {
    ids: mails.map((entry) => entry.event.receipt.message.messageId),
    mailbox,
    run,
  };
});

const common = (left: string, right: string) => {
  let size = 0;

  while (left[size] !== undefined && left[size] === right[size]) {
    size += 1;
  }

  return left.slice(0, size);
};

it.live.prop(
  "reply resolves any unique id prefix like read and thread do, and refuses an ambiguous prefix without sending",
  [Cut],
  ([cut]) =>
    Effect.gen(function* prefixes() {
      const { ids, mailbox, run } = yield* session(["one", "two"]);
      const [first = "", second = ""] = ids;

      const unique = first.slice(
        0,
        Math.max(cut, common(first, second).length + 1)
      );

      const done = yield* run([
        "reply",
        unique,
        "--body",
        "ok",
        "--summary",
        "ok",
      ]);

      expect(done.ok).toBe(true);
      expect(mailbox.sends).toHaveLength(1);

      const shared = common(first, second);

      if (shared.length > 0) {
        const clash = yield* run(["reply", shared, "--body", "ok"]);

        expect(clash.ok).toBe(false);
        expect(clash.error?.why).toContain("matches 2 messages");
        expect(mailbox.sends).toHaveLength(1);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 }, timeout: 60_000 }
);

it.live.prop(
  "thread shows the inbound message and my own reply to it, whatever prefix names the thread",
  [Cut],
  ([cut]) =>
    Effect.gen(function* sentOnThread() {
      const { ids, run } = yield* session(["one"]);
      const [id = ""] = ids;
      const prefix = id.slice(0, cut);

      const replied = yield* run([
        "reply",
        prefix,
        "--body",
        "ok",
        "--summary",
        "ok",
      ]);

      const thread = yield* run(["thread", prefix]);

      expect(thread.messages?.map((message) => message.id).toSorted()).toEqual(
        [id, replied.delivered?.id ?? ""].toSorted()
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 8 }, timeout: 60_000 }
);

it.live(
  "do-not-disturb yields Later and available yields Now for an ordinary sender, with the reader levers off",
  () =>
    Effect.gen(function* dnd() {
      const { run } = yield* session([]);

      const probe = [
        "attention",
        "test",
        "--from",
        "peer",
        "--kind",
        "message",
      ];

      yield* run(["attention", "dnd", "30m"]);

      expect((yield* run(probe)).verdict).toBe("Later");

      yield* run(["attention", "available"]);

      expect((yield* run(probe)).verdict).toBe("Now");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
