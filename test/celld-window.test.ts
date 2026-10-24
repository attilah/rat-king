// @effect-diagnostics nodeBuiltinImport:off -- The runner is a shell script driven through Node child processes and scratch files.
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { it } from "@effect/vitest";
import { Effect, Schedule, Schema } from "effect";
import { afterEach, expect } from "vitest";

import { WindowReceipt } from "../../../stacks/nest/alarm-sources.ts";

const runner = new URL("../../../stacks/nest/celld-window.sh", import.meta.url)
  .pathname;

const fakeSystemctl = `#!/usr/bin/env bash
set -u
echo "systemctl $*" >> "$FAKE/calls"
shift
action=$1
unit=\${2:-}
n=$(cat "$FAKE/gen" 2> /dev/null || echo 100)
restart() {
  n=$((n + 1))
  echo "$n" > "$FAKE/gen"
  echo active > "$FAKE/celld"
}
case "$action" in
  is-active)
    case "$unit" in
      rat-king-celld.service) cat "$FAKE/celld" ;;
      *) echo active ;;
    esac
    [ "$(cat "$FAKE/celld")" = active ] || [ "$unit" != rat-king-celld.service ]
    ;;
  start)
    case "$unit" in
      rat-king-mailbox-backup.service)
        [ -f "$FAKE/backup-fails" ] && exit 1
        restart
        ;;
      rat-king-celld.service) restart ;;
    esac
    ;;
  stop)
    [ "$unit" = rat-king-celld.service ] && echo inactive > "$FAKE/celld"
    exit 0
    ;;
  show)
    prop=\${3:-}
    case "$prop" in
      MainPID) echo "$n" ;;
      ActiveEnterTimestamp) echo "enter-$n" ;;
      Result) echo success ;;
    esac
    ;;
esac
`;

const fakeSystemdRun = `#!/usr/bin/env bash
echo "systemd-run $*" >> "$FAKE/calls"
`;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const sandbox = () => {
  const root = mkdtempSync(path.join(tmpdir(), "celld-window-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "systemctl"), fakeSystemctl);
  writeFileSync(path.join(bin, "systemd-run"), fakeSystemdRun);
  chmodSync(path.join(bin, "systemctl"), 0o755);
  chmodSync(path.join(bin, "systemd-run"), 0o755);
  writeFileSync(path.join(root, "celld"), "active\n");
  writeFileSync(path.join(root, "calls"), "");
  writeFileSync(
    path.join(root, "deploy.json"),
    JSON.stringify({ phase: "done", sha: "a".repeat(40), started: 1 })
  );
  writeFileSync(
    path.join(root, "work.sh"),
    `#!/usr/bin/env bash\necho $$ > "${root}/work-pid"\necho working > "${root}/work-ran"\nsleep \${WORK_SLEEP:-0}\n`
  );
  chmodSync(path.join(root, "work.sh"), 0o755);

  const env = {
    ...process.env,
    FAKE: root,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  };

  const args = (extra: readonly string[] = []) => [
    runner,
    "--reason",
    "cleanup",
    "--approval",
    "joel-go-1",
    "--marker",
    path.join(root, "deploy.json"),
    "--receipts",
    path.join(root, "receipts.jsonl"),
    ...extra,
    "--",
    path.join(root, "work.sh"),
  ];

  const calls = () =>
    readFileSync(path.join(root, "calls"), "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);

  return { args, calls, env, root };
};

const read = (box: ReturnType<typeof sandbox>, name: string) =>
  readFileSync(path.join(box.root, name), "utf-8");

const run = (box: ReturnType<typeof sandbox>, extra: readonly string[] = []) =>
  spawnSync("bash", box.args(extra), { env: box.env }).status;

const celldAfter = (box: ReturnType<typeof sandbox>) =>
  read(box, "celld").trim();

const ranWork = (box: ReturnType<typeof sandbox>) => {
  try {
    read(box, "work-ran");

    return true;
  } catch {
    return false;
  }
};

const Marker = Schema.Struct({ phase: Schema.String });

const receiptOf = (box: ReturnType<typeof sandbox>) =>
  Schema.decodeUnknownEffect(WindowReceipt)(
    JSON.parse(read(box, "receipts.jsonl"))
  );

it.effect("a dry run prints the plan and calls nothing", () =>
  Effect.sync(() => {
    const box = sandbox();

    expect(run(box, ["--dry-run"])).toBe(0);
    expect(box.calls()).toEqual([]);
    expect(ranWork(box)).toBe(false);
  })
);

it.effect("a failed backup aborts before celld is stopped", () =>
  Effect.sync(() => {
    const box = sandbox();
    writeFileSync(path.join(box.root, "backup-fails"), "");

    expect(run(box)).not.toBe(0);
    expect(box.calls().some((call) => call.includes("stop"))).toBe(false);
    expect(box.calls().some((call) => call.startsWith("systemd-run"))).toBe(
      false
    );
    expect(ranWork(box)).toBe(false);
    expect(celldAfter(box)).toBe("active");
  })
);

it.effect(
  "a clean window orders backup, deadline, stop, work, start, and writes a receipt the alarm decodes",
  () =>
    Effect.gen(function* cleanWindow() {
      const box = sandbox();
      const code = run(box);
      const calls = box.calls();
      const at = (needle: string) => calls.findIndex((c) => c.includes(needle));

      expect(code).toBe(0);
      expect(at("start rat-king-mailbox-backup.service")).toBeLessThan(
        at("systemd-run")
      );
      expect(at("systemd-run")).toBeLessThan(at("stop rat-king-celld.service"));
      expect(at("stop rat-king-celld.service")).toBeLessThan(
        calls.findLastIndex((c) => c.includes("start rat-king-celld.service"))
      );
      expect(
        calls.some((c) =>
          c.includes("stop rat-king-celld-window-deadline.timer")
        )
      ).toBe(true);
      expect(
        (yield* Schema.decodeUnknownEffect(Marker)(
          JSON.parse(read(box, "deploy.json"))
        )).phase
      ).toBe("done");

      const receipt = yield* receiptOf(box);

      expect(receipt.result).toBe("success");
      expect(receipt.celldAfter?.pid).not.toBe(receipt.celldBefore.pid);
    })
);

const killedMidWindow = (signal: "SIGKILL" | "SIGTERM") =>
  Effect.gen(function* killWindow() {
    const box = sandbox();

    const child = spawn("bash", box.args(), {
      env: { ...box.env, WORK_SLEEP: "30" },
      stdio: "ignore",
    });

    yield* Effect.try(() => read(box, "work-ran")).pipe(
      Effect.retry({ schedule: Schedule.spaced("25 millis"), times: 200 })
    );
    child.kill(signal);
    yield* Effect.callback<null>((resume) => {
      child.on("close", () => {
        resume(Effect.succeed(null));
      });
    });
    yield* Effect.try(() =>
      process.kill(Number(read(box, "work-pid")), "SIGKILL")
    ).pipe(Effect.ignore);

    return box;
  });

it.live("SIGTERM after the stop starts celld through the trap", () =>
  Effect.gen(function* termWindow() {
    const box = yield* killedMidWindow("SIGTERM");
    const calls = box.calls();

    const stopAt = calls.findIndex((c) =>
      c.includes("stop rat-king-celld.service")
    );

    expect(
      calls
        .slice(stopAt)
        .some((c) => c.includes("start rat-king-celld.service"))
    ).toBe(true);
    expect(celldAfter(box)).toBe("active");
    expect((yield* receiptOf(box)).result).toBe("failed");
  })
);

it.live(
  "SIGKILL defeats the trap, so the external deadline timer was already requested to start celld",
  () =>
    Effect.gen(function* killWindow() {
      const box = yield* killedMidWindow("SIGKILL");
      const calls = box.calls();

      const stopAt = calls.findIndex((c) =>
        c.includes("stop rat-king-celld.service")
      );

      const timerAt = calls.findIndex((c) => c.startsWith("systemd-run"));

      expect(timerAt).toBeGreaterThanOrEqual(0);
      expect(timerAt).toBeLessThan(stopAt);
      expect(calls[timerAt]).toContain("--on-active=30min");
      expect(calls[timerAt]).toContain("--unit=rat-king-celld-window-deadline");
      expect(calls[timerAt]).toContain(
        "systemctl --user start rat-king-celld.service"
      );
      expect(
        calls
          .slice(stopAt)
          .some((c) => c.includes("start rat-king-celld.service"))
      ).toBe(false);
    })
);
