import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Result } from "effect";
import { expect } from "vitest";

import { HostShell } from "../src/host-shell.ts";
import { layer as shellLayer, refusedBeforeCommand } from "../src/ssh.ts";

const refused = "kex_exchange_identification: Connection closed by remote host";

const fakeSsh = `#!/bin/sh
for last; do :; done
case "$last" in *"uname -s; id -u"*) printf 'Linux\\n1000\\n'; exit 0 ;; esac
n=$(cat "$FAKE_SSH_DIR/count" 2>/dev/null || echo 0)
n=$((n + 1))
printf '%s' "$n" > "$FAKE_SSH_DIR/count"
if [ "$n" -le "$FAKE_SSH_REFUSE" ]; then
  printf '%s\\n' "$FAKE_SSH_STDERR" >&2
  exit 255
fi
printf ok
`;

const withFakeSsh = (refuse: number, stderr: string) =>
  Effect.gen(function* fake() {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${dir}/ssh`, fakeSsh);
    yield* fs.chmod(`${dir}/ssh`, 0o755);

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const saved = { ...process.env };

        process.env.PATH = `${dir}:${saved.PATH ?? ""}`;
        process.env.FAKE_SSH_DIR = dir;
        process.env.FAKE_SSH_REFUSE = String(refuse);
        process.env.FAKE_SSH_STDERR = stderr;

        return saved;
      }),
      (saved) =>
        Effect.sync(() => {
          process.env.PATH = saved.PATH;
          delete process.env.FAKE_SSH_DIR;
          delete process.env.FAKE_SSH_REFUSE;
          delete process.env.FAKE_SSH_STDERR;
        })
    );

    const shell = yield* Effect.gen(function* built() {
      return yield* HostShell;
    }).pipe(
      Effect.provide(
        shellLayer({
          dataRoot: "/srv/example-data",
          home: "/home/example",
          ssh: "example@zzexample",
          tailnetIPv4: "203.0.113.10",
        }).pipe(Layer.provide(NodeServices.layer))
      )
    );

    const outcome = yield* Effect.result(shell.exec(["true"]));
    const calls = Number(yield* fs.readFileString(`${dir}/count`));

    return { calls, outcome };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it("only a refusal before the command ran counts as retryable", () => {
  expect(refusedBeforeCommand(255, `${refused}\n`)).toBe(true);
  expect(
    refusedBeforeCommand(
      255,
      "kex_exchange_identification: read: Connection reset by peer"
    )
  ).toBe(true);
  expect(refusedBeforeCommand(1, refused)).toBe(false);
  expect(
    refusedBeforeCommand(255, "Connection to host closed by remote host.")
  ).toBe(false);
  expect(
    refusedBeforeCommand(255, "ssh: connect to host port 22: timed out")
  ).toBe(false);
});

it.live(
  "a server that drops the handshake twice is retried and the command runs once",
  () =>
    Effect.gen(function* handshake() {
      const { calls, outcome } = yield* withFakeSsh(2, refused);

      expect(Result.isSuccess(outcome) && outcome.success.stdout).toBe("ok");
      expect(calls).toBe(3);
    })
);

it.live("other ssh failures are not retried", () =>
  Effect.gen(function* other() {
    const { calls, outcome } = yield* withFakeSsh(
      9,
      "Connection to host closed by remote host."
    );

    expect(Result.isFailure(outcome)).toBe(true);
    expect(calls).toBe(1);
  })
);

it.live("a server that keeps refusing gives up after four retries", () =>
  Effect.gen(function* giveUp() {
    const { calls, outcome } = yield* withFakeSsh(9, refused);

    expect(Result.isFailure(outcome) && outcome.failure).toMatchObject({
      operation: "ssh",
    });
    expect(calls).toBe(5);
  })
);
