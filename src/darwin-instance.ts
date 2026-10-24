import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Effect, Layer, Schema } from "effect";

import { LocalBucket, LocalBucketProvider } from "./darwin-bucket.ts";
import { renderStoreArguments } from "./darwin-store.ts";
import { LaunchdService, LaunchdServiceProvider } from "./darwin.ts";
import { AbsolutePath, refuse, textDigest } from "./files.ts";
import { allowedLabel } from "./launchd-plist.ts";
import {
  HostDirectory,
  HostDirectoryProvider,
  RemoteFile,
  RemoteFileProvider,
} from "./providers.ts";
import { identityContent } from "./store-credentials.ts";

export interface DarwinInstanceProps {
  readonly uid: number;
  readonly root: string;
  readonly launchAgents: string;
  readonly labelPrefix: string;
  readonly bucket: string;
  readonly credentials: {
    readonly accessKey: string;
    readonly secretKey: string;
    readonly sliceToken: string;
  };
  readonly binaries: {
    readonly node: string;
    readonly celld: string;
    readonly weed: string;
    readonly environmentLauncher: string;
    readonly sliceService: string;
  };
  readonly sessionsDatabase: string;
  readonly countLookbackDays: number;
  readonly ports: {
    readonly public: number;
    readonly internal: number;
    readonly slice: number;
    readonly master: number;
    readonly masterGrpc: number;
    readonly volume: number;
    readonly volumeGrpc: number;
    readonly filer: number;
    readonly filerGrpc: number;
    readonly s3: number;
    readonly s3Grpc: number;
  };
}

export const DarwinInstance = (id: string, props: DarwinInstanceProps) =>
  Effect.gen(function* instance() {
    const paths = [
      props.root,
      props.launchAgents,
      props.sessionsDatabase,
      ...Object.values(props.binaries),
    ];

    if (
      !allowedLabel(`${props.labelPrefix}.node`, props.labelPrefix) ||
      !paths.every(Schema.is(AbsolutePath))
    ) {
      return yield* refuse(
        "Declare an isolated label prefix and absolute private paths."
      );
    }

    if (
      !Number.isSafeInteger(props.countLookbackDays) ||
      props.countLookbackDays < 1 ||
      props.countLookbackDays > 3650
    ) {
      return yield* refuse(
        "Declare a bounded count lookback in private inventory."
      );
    }

    const ports = Object.values(props.ports);

    if (
      ports.some(
        (port) => !Number.isSafeInteger(port) || port < 1024 || port > 65_535
      ) ||
      new Set(ports).size !== ports.length
    ) {
      return yield* refuse(
        "Declare distinct unprivileged local listener ports."
      );
    }

    const root = yield* HostDirectory("root", {
      mode: 0o700,
      path: props.root,
    });

    const storeData = yield* HostDirectory("store-data", {
      mode: 0o700,
      path: Output.interpolate`${root.path}/store`,
    });

    const nodeData = yield* HostDirectory("node-data", {
      mode: 0o700,
      path: Output.interpolate`${root.path}/node`,
    });

    const identity = yield* RemoteFile("store-identity", {
      ...identityContent(
        {
          kind: "references",
          names: {
            accessKey: props.credentials.accessKey,
            secretKey: props.credentials.secretKey,
          },
        },
        props.bucket
      ),
      mode: 0o600,
      path: Output.interpolate`${root.path}/s3.json`,
    });

    const filerData = yield* HostDirectory("filer-data", {
      mode: 0o700,
      path: Output.interpolate`${root.path}/filer-db`,
    });

    const filerConfig = yield* RemoteFile("store-config-filer", {
      content: Output.all(filerData.path).pipe(
        Output.map(
          ([path]) =>
            `[leveldb2]\nenabled = true\ndir = ${JSON.stringify(path)}\n`
        )
      ),
      mode: 0o600,
      path: Output.interpolate`${root.path}/filer.toml`,
    });

    const emptyConfig = (name: string) =>
      RemoteFile(`store-config-${name}`, {
        content: "\n",
        mode: 0o600,
        path: Output.interpolate`${root.path}/${name}.toml`,
      });

    const isolatedConfigs = yield* Effect.all({
      master: emptyConfig("master"),
      notification: emptyConfig("notification"),
      security: emptyConfig("security"),
    });

    const endpoint = `http://127.0.0.1:${props.ports.s3}`;

    const common = {
      directory: props.launchAgents,
      environment: { CELLD_OTEL: "0", OTEL_SDK_DISABLED: "true" },
      labelPrefix: props.labelPrefix,
      uid: props.uid,
      workingDirectory: root.path,
    };

    const store = yield* LaunchdService("store", {
      ...common,
      environment: Output.all(
        identity.sha256,
        filerConfig.sha256,
        isolatedConfigs.master.sha256,
        isolatedConfigs.notification.sha256,
        isolatedConfigs.security.sha256
      ).pipe(
        Output.map((digests) => ({
          ...common.environment,
          CONFIG_SHA256: textDigest(digests.join(":")),
        }))
      ),
      label: `${props.labelPrefix}.store`,
      programArguments: Output.all(storeData.path, identity.path).pipe(
        Output.map(([data, config]) =>
          renderStoreArguments(props.binaries.weed, data, config, props.ports)
        )
      ),
    });

    const bucket = yield* LocalBucket("bucket", {
      config: identity.path,
      endpoint,
      name: props.bucket,
      ready: store.sha256,
    });

    const environment = yield* RemoteFile("node-environment", {
      contentFrom: Output.all(bucket.name, nodeData.path).pipe(
        Output.map(([name, data]) => ({
          format: "json" as const,
          secrets: {
            ACCESS_KEY: props.credentials.accessKey,
            SECRET_KEY: props.credentials.secretKey,
          },
          template: JSON.stringify({
            AWS_ACCESS_KEY_ID: "{{ACCESS_KEY}}",
            AWS_REGION: "us-east-1",
            AWS_SECRET_ACCESS_KEY: "{{SECRET_KEY}}",
            CELLD_BUCKET: `s3://${name}`,
            CELLD_LTX_RETENTION_SECS: "86400",
            CELLD_NODE: props.labelPrefix,
            CELLD_SHUTDOWN_TOTAL_MS: "8000",
            CELLD_TEST_DATA_DIR: data,
            S3_ENDPOINT: endpoint,
          })
            .replace('"{{ACCESS_KEY}}"', "{{ACCESS_KEY}}")
            .replace('"{{SECRET_KEY}}"', "{{SECRET_KEY}}"),
        }))
      ),
      mode: 0o600,
      path: Output.interpolate`${root.path}/node.json`,
    });

    const node = yield* LaunchdService("node", {
      ...common,
      environment: Output.all(environment.path, environment.sha256).pipe(
        Output.map(([path, sha256]) => ({
          ...common.environment,
          CONFIG_SHA256: sha256,
          DARWIN_EXEC_FILE: path,
          DARWIN_EXEC_PROGRAM: props.binaries.celld,
        }))
      ),
      label: `${props.labelPrefix}.node`,
      programArguments: [
        props.binaries.node,
        props.binaries.environmentLauncher,
        "--listen",
        `127.0.0.1:${props.ports.public}`,
        "--internal-listen",
        `127.0.0.1:${props.ports.internal}`,
      ],
    });

    const token = yield* RemoteFile("slice-token", {
      contentFrom: { secret: props.credentials.sliceToken },
      mode: 0o600,
      path: Output.interpolate`${root.path}/slice-token`,
    });

    const slice = yield* LaunchdService("slice", {
      ...common,
      environment: Output.all(token.path, token.sha256).pipe(
        Output.map(([path, sha256]) => ({
          ...common.environment,
          CONFIG_SHA256: sha256,
          SLICE_COUNT_LOOKBACK_DAYS: String(props.countLookbackDays),
          SLICE_DATABASE: props.sessionsDatabase,
          SLICE_PORT: String(props.ports.slice),
          SLICE_TOKEN_FILE: path,
        }))
      ),
      label: `${props.labelPrefix}.slice`,
      programArguments: [props.binaries.node, props.binaries.sliceService],
    });

    return {
      bucket,
      endpoint: `http://127.0.0.1:${props.ports.public}`,
      node,
      slice,
      sliceEndpoint: `http://127.0.0.1:${props.ports.slice}`,
      store,
    };
  }).pipe(
    Namespace.push(id),
    Effect.provideService(RemovalPolicy.RemovalPolicy, "retain")
  );

export const darwinProviders = () =>
  Layer.mergeAll(
    HostDirectoryProvider(),
    RemoteFileProvider(),
    LaunchdServiceProvider(),
    LocalBucketProvider()
  );
