// @effect-diagnostics nodeBuiltinImport:off -- the fixture gzips an invented binary the way a host build packages it.
import { gzipSync } from "node:zlib";

import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { makeFakeShell } from "../src/fake-shell.ts";
import { digest, readFile } from "../src/files.ts";
import { reconcileBinary, validateBinary } from "../src/release.ts";
import type { BinaryProps } from "../src/release.ts";

const binary = new TextEncoder().encode("invented host-built binary");

const packed = new Uint8Array(gzipSync(binary));

const hostProps: BinaryProps = {
  asset: { format: "gz", memberSha256: digest(binary) },
  hostSource: "/srv/example/tool.gz",
  path: "/srv/example/tool",
  sha256: digest(packed),
  size: packed.length,
};

const noDownloads = {
  get: () => Effect.die("a host-built binary never downloads"),
};

it.effect("installs a host-built binary from its pinned host path", () =>
  Effect.gen(function* installs() {
    const fake = yield* makeFakeShell();
    yield* fake.shell.write({
      bytes: packed,
      mode: 0o600,
      path: "/srv/example/tool.gz",
    });

    const file = yield* reconcileBinary(
      fake.shell,
      noDownloads,
      hostProps,
      undefined,
      false
    );

    expect(file.sha256).toBe(digest(binary));
    expect(file.mode).toBe(0o755);
  })
);

it.effect("refuses a host source whose sha256 does not match the pin", () =>
  Effect.gen(function* mismatch() {
    const fake = yield* makeFakeShell();
    const other = new Uint8Array(gzipSync(new TextEncoder().encode("other")));
    yield* fake.shell.write({
      bytes: other,
      mode: 0o600,
      path: "/srv/example/tool.gz",
    });

    const failed = yield* reconcileBinary(
      fake.shell,
      noDownloads,
      { ...hostProps, size: other.length },
      undefined,
      false
    ).pipe(Effect.isFailure);

    expect(failed).toBe(true);
    expect(yield* readFile(fake.shell, hostProps.path)).toBeUndefined();
  })
);

it.effect("refuses a missing host source without writing", () =>
  Effect.gen(function* missing() {
    const fake = yield* makeFakeShell();

    const failed = yield* reconcileBinary(
      fake.shell,
      noDownloads,
      hostProps,
      undefined,
      false
    ).pipe(Effect.isFailure);

    expect(failed).toBe(true);
    expect(yield* readFile(fake.shell, hostProps.path)).toBeUndefined();
  })
);

it.effect("requires exactly one of url and hostSource", () =>
  Effect.gen(function* exactlyOne() {
    const url =
      "https://github.com/example/project/releases/download/v1/tool.gz";

    const { hostSource: _hostSource, ...withoutHost } = hostProps;

    expect(
      yield* validateBinary({ ...withoutHost, url }).pipe(Effect.isSuccess)
    ).toBe(true);
    expect(
      yield* validateBinary({ ...hostProps, url }).pipe(Effect.isFailure)
    ).toBe(true);
    expect(yield* validateBinary(withoutHost).pipe(Effect.isFailure)).toBe(
      true
    );
    expect(
      yield* validateBinary({
        ...withoutHost,
        url: "https://example.invalid/tool.gz",
      }).pipe(Effect.isFailure)
    ).toBe(true);
  })
);
