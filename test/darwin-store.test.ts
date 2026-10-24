import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import { renderStoreArguments } from "../src/darwin-store.ts";
import { allowedLabel } from "../src/launchd-plist.ts";

const port = Schema.Int.check(
  Schema.isBetween({ maximum: 65_535, minimum: 1024 })
);

const ports = Schema.Struct({
  filer: port,
  filerGrpc: port,
  master: port,
  masterGrpc: port,
  s3: port,
  s3Grpc: port,
  volume: port,
  volumeGrpc: port,
});

it.effect.prop(
  "every enabled Seaweed port is declared and every optional listener is explicitly off",
  { ports: Arbitrary.schema(ports) },
  (input) =>
    Effect.sync(() => {
      const args = renderStoreArguments(
        "/srv/example/bin/weed",
        "/srv/example/store",
        "/srv/example/s3.json",
        input.ports
      );

      const enabled = args.filter(
        (arg) =>
          /^-(?:.+\.port(?:\..+)?|metricsPort)=/u.test(arg) &&
          !arg.endsWith("=0")
      );

      expect(enabled.toSorted()).toEqual(
        Object.entries({
          "filer.port": input.ports.filer,
          "filer.port.grpc": input.ports.filerGrpc,
          "master.port": input.ports.master,
          "master.port.grpc": input.ports.masterGrpc,
          "s3.port": input.ports.s3,
          "s3.port.grpc": input.ports.s3Grpc,
          "volume.port": input.ports.volume,
          "volume.port.grpc": input.ports.volumeGrpc,
        })
          .map(([key, value]) => `-${key}=${value}`)
          .toSorted()
      );

      for (const flag of [
        "-ip=127.0.0.1",
        "-ip.bind=127.0.0.1",
        "-s3.ip.bind=127.0.0.1",
        "-webdav=false",
        "-sftp=false",
        "-iam=false",
        "-s3.iam=false",
        "-mq.broker=false",
        "-mq.agent=false",
        "-debug=false",
        "-volume.pprof=false",
        "-s3.port.iceberg=0",
        "-s3.port.lance=0",
        "-s3.port.https=0",
        "-filer.port.public=0",
        "-volume.port.public=0",
        "-metricsPort=0",
      ]) {
        expect(args).toContain(flag);
      }
    })
);

it.effect.prop(
  "LaunchAgent allowlist rejects reserved namespaces and labels outside the configured prefix",
  {
    prefix: Arbitrary.schema(
      Schema.Literals([
        "",
        "com.apple",
        "com.apple.example",
        "com.ratking",
        "com.ratking.example",
        "homebrew",
        "homebrew.example",
        "org.other",
      ])
    ),
  },
  ({ prefix }) =>
    Effect.sync(() => {
      const label =
        prefix === "org.other" ? "org.example.agent" : `${prefix}.agent`;

      expect(allowedLabel(label, prefix)).toBe(false);
      expect(
        allowedLabel("org.example.archive.node", "org.example.archive")
      ).toBe(true);
    })
);
