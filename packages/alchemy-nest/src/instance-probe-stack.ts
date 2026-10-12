import { Effect } from "effect";

import { Celld } from "./celld.ts";
import {
  deploymentStageLayout,
  stageDeploymentFiles,
} from "./deployment-stage.ts";
import type { Node } from "./inventory-schema.ts";
import { ObjectStore } from "./object-store.ts";

export const probeInstance = "mischiefrb";

export const probePortBase = 28_010;

export const probeIdentity = {
  commit: "rollback-proof",
  version: "rollback-proof",
};

export const instanceProbeProgram = (
  host: Node,
  dataRoot: string,
  purgeOnDelete = true
) =>
  Effect.gen(function* probeStack() {
    const slice = yield* ObjectStore.Slice({
      cpuQuota: "100%",
      home: host.home,
      instance: probeInstance,
      memoryHigh: "2.5G",
      memoryMax: "3G",
    });

    const bucket = yield* ObjectStore.Bucket("store", {
      cpuQuota: "100%",
      dataRoot,
      host: { ...host, tailnetIPv4: "127.0.0.1" },
      instance: probeInstance,
      memoryMax: "1.5G",
      name: "mischiefrb-cells",
      oomPolicy: "continue",
      portBase: probePortBase,
      purgeOnDelete,
      slice: slice.sha256,
      volumeMax: 32,
    });

    const prepared = {
      bundle: `export default { fetch() { return Response.json(${JSON.stringify(probeIdentity)}); } };`,
      configuration: JSON.stringify({
        compatibility_date: "2026-10-04",
        compatibility_flags: [],
        durable_objects: { bindings: [] },
        main: "worker.mjs",
        migrations: [],
        name: probeInstance,
        no_bundle: true,
        vars: {},
      }),
    };

    const staged = yield* stageDeploymentFiles(
      host.home,
      prepared,
      true,
      bucket.layout,
      bucket.configuration
    );

    const node = yield* Celld.Node("celld", {
      bucket,
      cpuQuota: "100%",
      host,
      instance: probeInstance,
      memoryMax: "1.5G",
      oomPolicy: "continue",
      portBase: probePortBase,
      prepared: staged,
      purgeOnDelete,
      workerIPv4: "127.0.0.1",
    });

    return yield* Celld.Deployment("worker", {
      ...prepared,
      ...probeIdentity,
      binary: `${bucket.layout.bin}/celld`,
      directory: deploymentStageLayout(host.home, bucket.layout).directory,
      environmentFile: `${bucket.layout.configuration}/celld.env`,
      internalUrl: node.internalUrl,
      workerUrl: node.publicUrl,
    });
  });
