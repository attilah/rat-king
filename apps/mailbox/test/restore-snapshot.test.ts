import { it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Schema } from "effect";
import { expect } from "vitest";

import type { Interface } from "../../../packages/alchemy-nest/src/host-shell.ts";
import { nodeService, storeService } from "../../../stacks/nest/backup.ts";
import { restoreSnapshot } from "../../../stacks/nest/restore.ts";

const source = `20260101T000000Z-${"a".repeat(32)}`;

const local = `/state/.mailbox-restore-${"b".repeat(32)}`;

it.effect.prop(
  "restore validates the fetched location before stopping units and restarts storage before the node even when the swap fails",
  [
    Arbitrary.schema(
      Schema.Struct({
        malformed: Schema.Boolean,
        selected: Schema.Boolean,
        swapFails: Schema.Boolean,
      })
    ),
  ],
  ([input]) =>
    Effect.gen(function* restore() {
      const commands: (readonly string[])[] = [];

      const shell: Pick<Interface, "exec"> = {
        exec: (argv) =>
          Effect.sync(() => {
            commands.push(argv);

            if (argv[3] === "snapshot-fetch") {
              return {
                code: 0,
                stdout: input.malformed
                  ? `/untrusted/path ${source}`
                  : `${local} ${source}`,
              };
            }

            return {
              code: argv[3] === "snapshot-restore" && input.swapFails ? 1 : 0,
              stdout: "ok",
            };
          }),
      };

      const result = yield* restoreSnapshot(
        shell,
        "/data/example",
        "/backup/example",
        input.selected ? source : undefined
      ).pipe(Effect.exit);

      expect(Exit.isSuccess(result)).toBe(!input.malformed && !input.swapFails);
      expect(commands[0]?.slice(3)).toEqual([
        "snapshot-fetch",
        "/data/example",
        "/backup/example",
        ...(input.selected ? [source] : []),
      ]);

      if (input.malformed) {
        expect(commands).toHaveLength(1);
      } else {
        expect(
          commands
            .slice(1)
            .map((argv) =>
              argv[0] === "systemctl" ? argv.slice(2) : argv.slice(3)
            )
        ).toEqual([
          ["stop", nodeService],
          ["stop", storeService],
          ["snapshot-restore", "/data/example", "/backup/example", local],
          ["start", storeService],
          ["is-active", storeService],
          ["start", nodeService],
          ["is-active", nodeService],
        ]);
      }
    })
);
