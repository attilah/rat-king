import { Settings } from "@rat-king/ratking-client/config";
import { Directory } from "@rat-king/ratking-client/directory";
import { Inbox } from "@rat-king/ratking-client/ratking";
import { SecretStore } from "@rat-king/ratking-client/secrets";
import { Effect, Option, Result } from "effect";
import { Command } from "effect/cli";

import type { Report } from "./output.ts";
import { holderLine } from "./render.ts";
import { conclude, commonFlags, resolveName } from "./session.ts";

export const whoamiCommand = Command.make("whoami", commonFlags, (args) =>
  conclude(
    "whoami",
    args,
    Effect.gen(function* whoami() {
      const inbox = yield* Inbox;
      const located = yield* inbox.locate(yield* resolveName(args.as));

      const me = located.held
        ? Option.some(yield* inbox.attach(located.name))
        : Option.none();

      const holder = me.pipe(Option.isSome)
        ? yield* inbox.holder
        : Option.none();

      const did = Option.match(me, {
        onNone: () => located.did,
        onSome: (value) => value.did,
      });

      return {
        document: {
          did,
          key: { held: located.held, source: `secret:${located.secret}` },
          lease: Option.match(holder, {
            onNone: () => null,
            onSome: (value) => value,
          }),
          name: located.name,
        },
        lines: [
          `🐀 whoami ${located.name} · ${did} · key ${located.held ? `secret:${located.secret}` : "none on this machine"} · ${located.held ? holderLine(holder) : "lease unknown without a key"}`,
        ],
      } satisfies Report;
    })
  )
).pipe(
  Command.withDescription(
    "Print the name, DID, key source and current lease holder."
  )
);

interface Check {
  readonly check: string;
  readonly detail: string;
  readonly ok: boolean;
}

const nameChecks = Effect.fn("RatkingCli.nameChecks")(function* nameChecks(
  name: string
) {
  const inbox = yield* Inbox;
  const located = yield* inbox.locate(name).pipe(Effect.option);
  const held = Option.exists(located, (value) => value.held);

  const key: Check = {
    check: "key",
    detail: Option.match(located, {
      onNone: () => `${name} is not a valid name`,
      onSome: (value) =>
        value.held
          ? `secret:${value.secret} present`
          : `no secret ${value.secret} on this machine`,
    }),
    ok: held,
  };

  if (!held) {
    return [key];
  }

  yield* inbox.attach(name).pipe(Effect.ignore);

  const reached = yield* inbox.holder.pipe(Effect.result);

  const mailbox: Check = Result.isSuccess(reached)
    ? { check: "mailbox", detail: holderLine(reached.success), ok: true }
    : { check: "mailbox", detail: reached.failure.reason, ok: false };

  return [key, mailbox];
});

export const doctorCommand = Command.make("doctor", commonFlags, (args) =>
  conclude(
    "doctor",
    args,
    Effect.gen(function* doctor() {
      const settings = yield* Settings;
      const directory = yield* Directory;
      const store = yield* SecretStore;
      const names = yield* directory.list;

      const listed = yield* store.exists("rat-king-doctor-probe").pipe(
        Effect.map(() => true),
        Effect.orElseSucceed(() => false)
      );

      const name = yield* resolveName(args.as).pipe(Effect.option);

      const checks: readonly Check[] = [
        {
          check: "config",
          detail: `endpoint ${settings.endpoint}, state ${settings.state}`,
          ok: true,
        },
        {
          check: "directory",
          detail: `${names.length} names: ${names.map((entry) => entry.name).join(", ")}`,
          ok: names.length > 0,
        },
        {
          check: "secret-store",
          detail: listed
            ? "list answered"
            : `${settings.secretsCommand} did not answer`,
          ok: listed,
        },
        ...(Option.isSome(name) ? yield* nameChecks(name.value) : []),
      ];

      return {
        document: { checks, ok: checks.every((entry) => entry.ok) },
        lines: [
          `🐀 doctor · ${checks.every((entry) => entry.ok) ? "ok" : "problems"}`,
          ...checks.map(
            (entry) =>
              `${entry.ok ? "✓" : "✗"} ${entry.check} · ${entry.detail}`
          ),
        ],
      } satisfies Report;
    })
  )
).pipe(
  Command.withDescription(
    "Check config, directory, secret store, key and mailbox reachability."
  )
);
