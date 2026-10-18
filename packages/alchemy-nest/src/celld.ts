import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import { Effect, Schema } from "effect";

import { Deployment, DeploymentProvider } from "./deployment.ts";
import { textDigest, refuse } from "./files.ts";
import { instanceNodeUnit } from "./instance-units.ts";
import { InstanceNameSchema } from "./instance.ts";
import type { InstanceProps } from "./instance.ts";
import type { Node as HostNode } from "./inventory-schema.ts";
import { NodeProvider, NodeResource } from "./node-provider.ts";
import type { BucketOutput } from "./object-store.ts";
import { celldBinary } from "./pins.ts";
import { HostDirectory, ReleaseBinary, RemoteFile } from "./providers.ts";
import type { BinaryProps } from "./release.ts";
import type { ServiceLimits } from "./service-units.ts";
import { environmentContent } from "./store-credentials.ts";
import { renderUnit } from "./systemd.ts";

export interface CelldProps extends InstanceProps, ServiceLimits {
  readonly binary?: Omit<BinaryProps, "path">;
  readonly bucket: BucketOutput;
  readonly host: HostNode;
  readonly prepared?: readonly Output.Output<string>[];
  readonly purgeOnDelete?: boolean;
  readonly tuning?: Readonly<Record<string, string>>;
  readonly workerIPv4?: string;
}

const reservedTuning: ReadonlySet<string> = new Set([
  "CELLD_BUCKET",
  "CELLD_OTEL",
]);

export const validTuning = (tuning: Readonly<Record<string, string>>) =>
  Object.entries(tuning).every(
    ([key, value]) =>
      /^CELLD_[A-Z0-9_]{1,64}$/u.test(key) &&
      !reservedTuning.has(key) &&
      /^[A-Za-z0-9._:/-]{1,128}$/u.test(value)
  );

export const Node = (id: string, props: CelldProps) =>
  Effect.gen(function* node() {
    const { host, bucket } = props;
    const { layout } = bucket;

    if (props.instance !== undefined) {
      yield* Schema.decodeEffect(InstanceNameSchema)(props.instance).pipe(
        Effect.mapError(() => refuse("Invalid node instance."))
      );
    }

    if (layout.configuration !== `${host.home}/.config/${layout.instance}`) {
      return yield* refuse("Node host must match its bucket.");
    }

    if (
      (props.instance !== undefined && props.instance !== layout.instance) ||
      (props.portBase !== undefined && props.portBase !== layout.portBase)
    ) {
      return yield* refuse("Node instance must match its bucket.");
    }

    if (props.tuning !== undefined && !validTuning(props.tuning)) {
      return yield* refuse(
        "Node tuning keys must be CELLD_ names other than CELLD_BUCKET and CELLD_OTEL, with short plain values."
      );
    }

    const workerIPv4 = props.workerIPv4 ?? host.tailnetIPv4;

    const data = yield* HostDirectory("data", {
      mode: 0o700,
      path: Output.interpolate`${bucket.dataRoot}/celld`,
      purgeOnDelete: props.purgeOnDelete ?? false,
      purgeRoot: layout.dataRoot,
    });

    const binary = yield* ReleaseBinary("celld", {
      ...(props.binary ?? celldBinary(`${layout.bin}/celld`)),
      path: Output.interpolate`${bucket.bin}/celld`,
    });

    const declaration = instanceNodeUnit(host, layout, {
      cpuQuota: props.cpuQuota,
      memoryMax: props.memoryMax,
      oomPolicy: props.oomPolicy,
      restartGate: bucket.restartGate !== undefined,
      workerIPv4,
    });

    const environment = yield* RemoteFile("environment", {
      ...environmentContent(
        bucket.credentials,
        bucket.resource.name,
        bucket.resource.endpoint,
        props.tuning ?? {}
      ),
      mode: 0o600,
      path: Output.interpolate`${bucket.configuration}/celld.env`,
      rotationOwner: {
        home: host.home,
        name: layout.nodeUnit,
        sha256: textDigest(renderUnit(declaration)),
      },
    });

    const unit = yield* NodeResource("node", {
      ...declaration,
      internalUrl: `http://127.0.0.1:${layout.ports.internal}`,
      prepared: [
        binary.path,
        data.path,
        environment.path,
        bucket.resource.name,
        bucket.restartGate?.sha256 ?? bucket.resource.name,
        bucket.storageMaintenance.sha256,
        ...(props.prepared ?? []),
      ],
      publicUrl: `http://${workerIPv4}:${layout.ports.public}`,
      restartOn: Output.all(environment.sha256, binary.sha256),
      version: "v0.6.1",
    });

    return {
      internalUrl: unit.internalUrl,
      layout,
      publicUrl: unit.publicUrl,
      unit,
      version: unit.version,
    };
  }).pipe(Namespace.push(id));

export const Celld = {
  Deployment,
  Node,
  deploymentProvider: DeploymentProvider,
  providers: NodeProvider,
};
