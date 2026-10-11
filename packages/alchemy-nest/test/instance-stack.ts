import { Effect } from "effect";

import { Celld, ObjectStore } from "../src/index.ts";
import type { Node } from "../src/inventory-schema.ts";

export const mischief = (host: Node) =>
  Effect.gen(function* instanceStack() {
    const instance = "mischief";
    const portBase = 28_000;

    const slice = yield* ObjectStore.Slice({
      cpuQuota: "100%",
      home: host.home,
      instance,
      memoryHigh: "2.5G",
      memoryMax: "3G",
      oomPolicy: "continue",
    });

    const bucket = yield* ObjectStore.Bucket("store", {
      dataRoot: "/srv/example/mischief",
      host,
      instance,
      name: "mischief-cells",
      portBase,
      slice: slice.sha256,
      volumeMax: 32,
    });

    return yield* Celld.Node("celld", { bucket, host, instance, portBase });
  });
