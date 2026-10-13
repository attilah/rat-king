import { AskFailed, Inbox } from "@rat-king/ratking-client/ratking";
import type { Peeked } from "@rat-king/ratking-client/ratking";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { entryDocument, threadOf } from "./entries.ts";
import { withField } from "./output.ts";
import type { Report } from "./output.ts";
import { inboxLine, readLines, short } from "./render.ts";
import { commonFlags, named, toggle } from "./session.ts";

const notFound = (id: string) =>
  new AskFailed({
    code: "NoSuchMessage",
    reason: `No message ${id} in this mailbox`,
  });

const find = (entries: readonly Peeked[], id: string) =>
  entries.find(
    (entry) => entry.received.id === id || entry.received.id.startsWith(id)
  );

const locate = Effect.fn("RatkingCli.locate")(function* locate(id: string) {
  const inbox = yield* Inbox;
  const recent = yield* inbox.peek();
  const hit = find(recent.messages, id);

  if (hit !== undefined) {
    return { entry: hit, history: recent.messages };
  }

  const all = yield* inbox.peek({ all: true });
  const found = find(all.messages, id);

  if (found === undefined) {
    return yield* notFound(id);
  }

  return { entry: found, history: all.messages };
});

export const inboxCommand = Command.make(
  "inbox",
  {
    ...commonFlags,
    after: Flag.Int("after").pipe(Flag.optional),
    all: toggle("all"),
    hold: toggle("hold"),
  },
  (args) =>
    named("inbox", args, (me) =>
      Effect.gen(function* listInbox() {
        const inbox = yield* Inbox;

        if (args.hold) {
          const held: Peeked[] = [];

          yield* inbox.hold(
            (entry, ack) =>
              Effect.gen(function* shown() {
                held.push(entry);

                if (!args.json) {
                  yield* Console.log(inboxLine(entry));
                }

                yield* ack;
              }),
            withField(
              { session: `cli-${process.pid}` },
              "afterSeq",
              Option.getOrUndefined(args.after)
            )
          );

          return {
            document: { held: held.map(entryDocument), name: me.name },
            lines: [`🐀 held ${me.name} · ${held.length} delivered and acked`],
          } satisfies Report;
        }

        const peeked = yield* inbox.peek(
          withField(
            { all: args.all },
            "afterSeq",
            Option.getOrUndefined(args.after)
          )
        );

        return {
          document: {
            messages: peeked.messages.map(entryDocument),
            name: me.name,
            throughSeq: peeked.throughSeq,
            unreadable: peeked.unreadable,
          },
          lines: [
            `🐀 inbox ${me.name} · ${peeked.messages.length} ${args.all ? "messages" : "unread"}${peeked.unreadable.length === 0 ? "" : ` · ${peeked.unreadable.length} unreadable`}`,
            ...peeked.messages.map(inboxLine),
          ],
        } satisfies Report;
      })
    )
).pipe(
  Command.withDescription(
    "List unsettled mail. Peeks and never acks while another reader holds the lease; --hold alone takes the lease, delivers, acks, and refuses LeaseHeld if a live holder exists."
  )
);

export const readCommand = Command.make(
  "read",
  { ...commonFlags, id: Argument.String("id") },
  (args) =>
    named("read", args, () =>
      Effect.gen(function* read() {
        const { entry } = yield* locate(args.id);

        return {
          document: { message: entryDocument(entry) },
          lines: readLines(entry),
        } satisfies Report;
      })
    )
).pipe(
  Command.withDescription(
    "Show one message in full by id or id prefix. Peeks; acks nothing."
  )
);

export const threadCommand = Command.make(
  "thread",
  { ...commonFlags, id: Argument.String("id") },
  (args) =>
    named("thread", args, () =>
      Effect.gen(function* thread() {
        const { entry, history } = yield* locate(args.id);
        const root = threadOf(entry.received);

        const members = history
          .filter((candidate) => threadOf(candidate.received) === root)
          .toSorted((left, right) => left.seq - right.seq);

        return {
          document: { messages: members.map(entryDocument), thread: root },
          lines: [
            `🐀 thread ${short(root)} · ${members.length} messages`,
            ...members.flatMap((member) => ["", ...readLines(member)]),
          ],
        } satisfies Report;
      })
    )
).pipe(
  Command.withDescription(
    "Show every message on the thread of an id, oldest first. Peeks; acks nothing."
  )
);
