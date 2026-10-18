import {
  Celld,
  Darwin,
  GeneratedConfiguration,
  HostDirectory,
  RemoteFile,
  prepareDeployment,
} from "@rat-king/alchemy-nest";
import type {
  DarwinInstance,
  DarwinInstanceProps,
} from "@rat-king/alchemy-nest";
import { Failure } from "@rat-king/remembers";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Effect, Schema } from "effect";

export const workerDeclaration = {
  compatibility_date: "2026-10-01",
  compatibility_flags: ["nodejs_compat"],
  durable_objects: {
    bindings: [
      { class_name: "PlanRun", name: "PLAN_RUN" },
      { class_name: "Postbox", name: "POSTBOX" },
      { class_name: "Schedule", name: "SCHEDULE" },
      { class_name: "ServiceTokenLedger", name: "SERVICE_TOKENS" },
    ],
  },
  migrations: [
    {
      new_sqlite_classes: [
        "PlanRun",
        "Postbox",
        "Schedule",
        "ServiceTokenLedger",
      ],
      tag: "v1",
    },
  ],
  name: "remembers",
};

export const workerPrivateKeys = [
  "MISCHIEF_CALLERS",
  "MISCHIEF_CLIPROXY_KEY",
  "MISCHIEF_CLIPROXY_URL",
  "MISCHIEF_DID",
  "MISCHIEF_MODEL",
  "REMEMBERS_CANON_JSON",
  "REMEMBERS_SLICE_BEARER",
  "REMEMBERS_SLICE_URL",
] as const;

export const buildWorker = (
  entrypoint: string,
  version: string,
  commit: string
) =>
  prepareDeployment(entrypoint, workerDeclaration, {
    commit,
    vars: { MISCHIEF_STEP_KINDS: "call" },
    version,
  });

export const configurationWithBindings = (
  configuration: typeof GeneratedConfiguration.Type,
  revision: string
) =>
  JSON.stringify({
    ...configuration,
    vars: { ...configuration.vars, REMEMBERS_BINDINGS_SHA256: revision },
  });

export interface HostDeploymentProps {
  readonly instance: DarwinInstanceProps;
  readonly node: Effect.Success<ReturnType<typeof DarwinInstance>>;
  readonly hostEntrypoint: string;
  readonly hostEnvironment: string;
  readonly deploymentEnvironment: string;
  readonly workerBindings: string;
  readonly workerUrl: string;
  readonly worker: Effect.Success<ReturnType<typeof buildWorker>>;
}

export const RemembersHost = (id: string, props: HostDeploymentProps) =>
  Effect.gen(function* declare() {
    if (!props.hostEntrypoint.startsWith("/")) {
      return yield* new Failure({
        code: "entrypoint",
        operation: "deployment",
      });
    }

    const instance = props.node;

    const configuration = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(GeneratedConfiguration)
    )(props.worker.configuration);

    const data = yield* HostDirectory("remembers-data", {
      mode: 0o700,
      path: `${props.instance.root}/remembers`,
    });

    const environment = yield* RemoteFile("host-environment", {
      contentFrom: { secret: props.hostEnvironment },
      mode: 0o600,
      path: `${props.instance.root}/remembers-host.json`,
    });

    const bindings = yield* RemoteFile("worker-bindings", {
      contentFrom: { secret: props.workerBindings },
      mode: 0o600,
      path: `${props.instance.root}/remembers-worker-bindings.json`,
    });

    const deploymentEnvironment = yield* RemoteFile("deployment-environment", {
      contentFrom: { secret: props.deploymentEnvironment },
      mode: 0o600,
      path: `${props.instance.root}/remembers-deploy.env`,
    });

    const deployment = yield* Celld.Deployment("remembers-worker", {
      ...props.worker,
      binary: props.instance.binaries.celld,
      bindingsFile: bindings.path,
      configuration: Output.all(bindings.sha256).pipe(
        Output.map(([revision]) =>
          configurationWithBindings(configuration, revision)
        )
      ),
      directory: `${props.instance.root}/remembers-deployment`,
      environmentFile: deploymentEnvironment.path,
      internalUrl: Output.all(instance.node.sha256).pipe(
        Output.map(() => `http://127.0.0.1:${props.instance.ports.internal}`)
      ),
      secretNames: workerPrivateKeys,
      workerUrl: props.workerUrl,
    });

    const host = yield* Darwin.LaunchdService("host", {
      directory: props.instance.launchAgents,
      environment: Output.all(
        environment.path,
        environment.sha256,
        deployment.sha256
      ).pipe(
        Output.map(([path, sha256, worker]) => ({
          CONFIG_SHA256: sha256,
          DARWIN_EXEC_FILE: path,
          DARWIN_EXEC_PROGRAM: props.instance.binaries.node,
          WORKER_SHA256: worker,
        }))
      ),
      label: `${props.instance.labelPrefix}.host`,
      labelPrefix: props.instance.labelPrefix,
      programArguments: [
        props.instance.binaries.node,
        props.instance.binaries.environmentLauncher,
        props.hostEntrypoint,
        props.instance.root,
      ],
      uid: props.instance.uid,
      workingDirectory: data.path,
    });

    return { ...instance, data, deployment, host };
  }).pipe(
    Namespace.push(id),
    Effect.provideService(RemovalPolicy.RemovalPolicy, "retain")
  );
