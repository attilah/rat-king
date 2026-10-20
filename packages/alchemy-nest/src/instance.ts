import { Effect, Schema } from "effect";

import { AbsolutePath, refuse } from "./files.ts";
import type { Node } from "./inventory-schema.ts";
import { sidecarListener } from "./listener-contract.ts";

const defaultInstance = "rat-king";

const defaultAncestors = new Set(
  defaultInstance
    .split("-")
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join("-"))
);

export const InstanceNameSchema = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9]{0,15}$/u),
  Schema.makeFilter((name) => !defaultAncestors.has(name))
);

export type InstanceName = typeof InstanceNameSchema.Type;

export const PortBaseSchema = Schema.Int.check(
  Schema.isBetween({ maximum: 65_526, minimum: 1024 })
);

export type PortBase = typeof PortBaseSchema.Type;

export interface InstanceProps {
  readonly instance?: InstanceName;
  readonly portBase?: PortBase;
}

export const instanceLayout = (
  host: Node,
  props: InstanceProps & { readonly dataRoot?: string }
) => {
  const instance = props.instance ?? defaultInstance;
  const base = props.portBase ?? 18_333;

  const ports =
    base === 18_333
      ? {
          filer: 18_888,
          filerGrpc: 28_888,
          internal: 18_788,
          master: 19_333,
          masterGrpc: 29_333,
          public: 18_787,
          s3: 18_333,
          s3Grpc: 28_333,
          volume: 18_081,
          volumeGrpc: 28_081,
        }
      : {
          filer: base + 2,
          filerGrpc: base + 3,
          internal: base + 1,
          master: base + 4,
          masterGrpc: base + 5,
          public: base,
          s3: base + 6,
          s3Grpc: base + 7,
          volume: base + 8,
          volumeGrpc: base + 9,
        };

  return {
    bin: `${host.home}/.local/share/${instance}/bin`,
    binaryRoot: `${host.home}/.local/share/${instance}`,
    configuration: `${host.home}/.config/${instance}`,
    dataRoot: props.dataRoot ?? host.dataRoot,
    growTimer: `${instance}-storage-grow.timer`,
    growUnit: `${instance}-storage-grow.service`,
    instance,
    nodeUnit: `${instance}-celld.service`,
    portBase: base,
    ports,
    retentionTimer: `${instance}-storage-retention.timer`,
    retentionUnit: `${instance}-storage-retention.service`,
    slice: `${instance}.slice`,
    storeUnit: `${instance}-seaweedfs.service`,
  };
};

export type InstanceLayout = ReturnType<typeof instanceLayout>;

export const validateInstance = Effect.fn("Instance.validate")(
  function* validate(
    host: Node,
    props: InstanceProps & { readonly dataRoot?: string }
  ) {
    if (props.instance !== undefined) {
      yield* Schema.decodeEffect(InstanceNameSchema)(props.instance).pipe(
        Effect.mapError(() => refuse("Invalid instance name."))
      );
    }

    if (props.dataRoot !== undefined) {
      yield* Schema.decodeEffect(AbsolutePath)(props.dataRoot).pipe(
        Effect.mapError(() => refuse("Invalid instance data root."))
      );
    }

    yield* Schema.decodeEffect(PortBaseSchema)(props.portBase ?? 18_333).pipe(
      Effect.mapError(() => refuse("Invalid instance port base."))
    );
    const layout = instanceLayout(host, props);

    if (
      layout.instance !== "rat-king" &&
      (props.dataRoot === undefined ||
        layout.dataRoot === host.dataRoot ||
        layout.dataRoot.startsWith(`${host.dataRoot}/`) ||
        host.dataRoot.startsWith(`${layout.dataRoot}/`) ||
        layout.portBase === 18_333)
    ) {
      return yield* refuse(
        "Named instances require their own data root and port base."
      );
    }

    if (
      layout.instance !== "rat-king" &&
      [`${host.home}/.config`, `${host.home}/.local/share`].some(
        (root) =>
          layout.dataRoot === root ||
          layout.dataRoot.startsWith(`${root}/`) ||
          root.startsWith(`${layout.dataRoot}/`)
      )
    ) {
      return yield* refuse(
        "Named data roots must not overlap configuration or binary custody."
      );
    }

    const legacy = new Set([
      ...Object.values(instanceLayout(host, {}).ports),
      sidecarListener.port,
    ]);

    if (
      layout.portBase !== 18_333 &&
      Object.values(layout.ports).some((port) => legacy.has(port))
    ) {
      return yield* refuse("Instance ports overlap the default listeners.");
    }

    return layout;
  }
);
