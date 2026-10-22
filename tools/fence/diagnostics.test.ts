import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { ConfigProvider, Effect, FileSystem, Path, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { expect } from "vitest";

import { FenceError, execute, loadInstance, scan } from "./scan.ts";

const secret = "very-private-literal.example";

const validInstance = {
  domains: [secret],
  hosts: [secret],
  ips: ["203.0.113.9"],
  secretNames: [secret],
  sites: [secret],
};

const restorePath = (value: string) => {
  process.env.PATH = value;
};

const withPath = <A, E, R>(value: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const saved = process.env.PATH ?? "";
      process.env.PATH = value;

      return saved;
    }),
    () => effect,
    (saved) =>
      Effect.sync(() => {
        restorePath(saved);
      })
  );

const instanceEnv = (file: string) =>
  Effect.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({ env: { RATS_NEST_INSTANCE: file } })
    )
  );

const isFenceError = Schema.is(FenceError);

const refusal = <E>(
  effect: Effect.Effect<
    unknown,
    E,
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  >
) =>
  effect.pipe(
    Effect.map(() => "passed"),
    Effect.catchIf(isFenceError, (refused) => Effect.succeed(refused.reason)),
    Effect.orDie,
    Effect.provide(NodeServices.layer)
  );

const writeInstance = (
  mode: number,
  body: Readonly<Record<string, string | readonly string[]>>
) =>
  Effect.gen(function* instanceFile() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped();
    const file = path.join(directory, "instance.json");
    yield* fs.writeFileString(file, JSON.stringify(body));
    yield* fs.chmod(file, mode);

    return file;
  });

it.effect("a missing instance names the path, env var and next step", () =>
  Effect.gen(function* missing() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(yield* fs.makeTempDirectoryScoped(), "absent.json");

    const reason = yield* refusal(
      loadInstance({ generic: false }).pipe(instanceEnv(file))
    );

    expect(reason).toContain("missing");
    expect(reason).toContain(file);
    expect(reason).toContain("RATS_NEST_INSTANCE");
    expect(reason).toContain("--generic");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect("a broadly readable instance reports path, mode and chmod", () =>
  Effect.gen(function* wrongMode() {
    const file = yield* writeInstance(0o644, validInstance);

    const reason = yield* refusal(
      loadInstance({ generic: false }).pipe(instanceEnv(file))
    );

    expect(reason).toContain(file);
    expect(reason).toContain("644");
    expect(reason).toContain(`chmod 600 ${file}`);
    expect(reason).not.toContain(secret);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect("an invalid instance names the offending key and no values", () =>
  Effect.gen(function* invalid() {
    const file = yield* writeInstance(0o600, {
      ...validInstance,
      unexpectedKey: secret,
    });

    const reason = yield* refusal(
      loadInstance({ generic: false }).pipe(instanceEnv(file))
    );

    expect(reason).toContain("invalid");
    expect(reason).toContain("unexpectedKey");
    expect(reason).not.toContain(secret);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect("a missing git names the command and fails closed", () =>
  Effect.gen(function* noGit() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const bin = yield* fs.makeTempDirectoryScoped();

    const reason = yield* refusal(
      withPath(bin, scan({ generic: true, mode: "tree", root }))
    );

    expect(reason).toContain("Git unavailable");
    expect(reason).toContain("git ls-files");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect("a missing gitleaks names the command and its install", () =>
  Effect.gen(function* noGitleaks() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const bin = yield* fs.makeTempDirectoryScoped();

    const located = yield* execute({
      args: ["-c", "command -v git"],
      cwd: root,
      executable: "sh",
    });

    const resolved = new TextDecoder().decode(located.bytes).trim();

    const init = yield* execute({
      args: ["init", "--quiet"],
      cwd: root,
      executable: "git",
    });

    expect(init.code).toBe(0);
    yield* fs.symlink(resolved, path.join(bin, "git"));
    yield* fs.makeDirectory(path.join(root, "tools", "fence"), {
      recursive: true,
    });

    const reason = yield* refusal(
      withPath(bin, scan({ generic: true, mode: "tree", root }))
    );

    expect(reason).toContain("Gitleaks unavailable");
    expect(reason).toContain("gitleaks dir");
    expect(reason).toContain("brew install gitleaks");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);
