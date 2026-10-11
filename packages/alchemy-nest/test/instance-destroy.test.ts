import { NodePath, NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Plan from "alchemy/Plan";
import * as Provider from "alchemy/Provider";
import { State } from "alchemy/State";
import * as Test from "alchemy/Test/Vitest";
import { Arbitrary, Cause, Context, Effect, Exit, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { expect } from "vitest";

import { Celld } from "../src/celld.ts";
import {
  assertDeletePath,
  assertDeleteUnit,
  deploymentDeleteRoot,
  instanceDeleteCustody,
} from "../src/delete-custody.ts";
import { makeFakeShell } from "../src/fake-shell.ts";
import { textDigest } from "../src/files.ts";
import { HostShell } from "../src/host-shell.ts";
import { deleteDirectory, deleteFile } from "../src/instance-files.ts";
import { declaredListeners } from "../src/instance-listener-contract.ts";
import {
  instanceProbeProgram,
  probeIdentity,
} from "../src/instance-probe-stack.ts";
import { startupLayer } from "../src/instance-startup-contract.ts";
import { InstanceNameSchema, instanceLayout } from "../src/instance.ts";
import { ObjectStore } from "../src/object-store.ts";
import { ReleaseBinary } from "../src/providers.ts";
import { ReleaseSource } from "../src/release.ts";
import { s3Script } from "../src/s3-script.ts";
import { deleteUnit } from "../src/systemd.ts";
import { storeSocketScript } from "../src/unit-cleanup.ts";
import { checkedRead, checkedStack } from "./checked-stack.ts";

const host = {
  dataRoot: "/srv/example/mailbox",
  home: "/home/example",
  ssh: "example",
  tailnetIPv4: "203.0.113.10",
};

const layoutFor = (instance: string) =>
  instanceLayout(host, {
    dataRoot: `/srv/example/${instance}`,
    instance,
    portBase: 28_010,
  });

it.effect.prop(
  "named delete custody accepts only its layout and refuses default and every other instance before effects",
  {
    names: Arbitrary.schema(
      Schema.Tuple([InstanceNameSchema, InstanceNameSchema]).check(
        Schema.makeFilter(([own, other]) => own !== other)
      )
    ),
    suffix: Arbitrary.schema(
      Schema.String.check(
        Schema.makeFilter((value) => !value.startsWith("bootstrap-"))
      )
    ),
  },
  ({ names: [own, other], suffix }) =>
    Effect.gen(function* custodyProperty() {
      const fake = yield* makeFakeShell();
      const layout = layoutFor(own);
      const custody = instanceDeleteCustody(host.home, layout);

      const shell = {
        ...fake.shell,
        deleteCustody: custody,
        purgeRoots: [layout.configuration, layout.binaryRoot, layout.dataRoot],
      };

      for (const path of custody.files) {
        expect(
          yield* assertDeletePath(shell, path, "files").pipe(Effect.isSuccess)
        ).toBe(true);
      }

      for (const path of custody.directories) {
        expect(
          yield* assertDeletePath(shell, path, "directories").pipe(
            Effect.isSuccess
          )
        ).toBe(true);
      }

      for (const name of custody.units) {
        expect(
          yield* assertDeleteUnit(shell, { home: host.home, name }).pipe(
            Effect.isSuccess
          )
        ).toBe(true);
      }

      expect(
        deploymentDeleteRoot(shell, `${layout.configuration}/deployment`)
      ).toBe(layout.configuration);
      expect(
        deploymentDeleteRoot(
          shell,
          `${host.home}/.config/rat-king/mailbox-deployment`
        )
      ).toBeUndefined();

      const strangers = [
        instanceDeleteCustody(host.home, instanceLayout(host, {})),
        instanceDeleteCustody(host.home, layoutFor(other)),
      ];

      for (const foreign of strangers) {
        for (const path of [
          ...foreign.directories,
          `${host.home}/.config/rat-king/mailbox-deployment`,
        ]) {
          expect(
            yield* deleteDirectory(shell, { mode: 0o700, path }).pipe(
              Effect.isFailure
            )
          ).toBe(true);
        }

        for (const path of foreign.files) {
          expect(
            yield* deleteFile(shell, {
              mode: 0o600,
              path,
              sha256: "0".repeat(64),
            }).pipe(Effect.isFailure)
          ).toBe(true);
        }

        for (const name of foreign.units) {
          expect(
            yield* deleteUnit(shell, {
              active: true,
              configSha256: "0".repeat(64),
              enabled: true,
              home: host.home,
              name,
              needDaemonReload: false,
              path: `${host.home}/.config/systemd/user/${name}`,
              scope: "user",
              sha256: "0".repeat(64),
            }).pipe(Effect.isFailure)
          ).toBe(true);
        }

        expect(
          deploymentDeleteRoot(
            shell,
            `${foreign.layout.configuration}/deployment`
          )
        ).toBeUndefined();
      }

      const candidate = `${layout.configuration}/${suffix}`;
      expect(
        yield* assertDeletePath(shell, candidate, "files").pipe(
          Effect.isSuccess
        )
      ).toBe(custody.files.includes(candidate));
      expect(yield* fake.calls()).toEqual([]);
    })
);

const probeLayout = layoutFor("mischiefrb");

class Fake extends Context.Service<
  Fake,
  Effect.Success<ReturnType<typeof makeFakeShell>>
>()("Test/InstanceDestroyFake") {}

const runtime = Layer.effectContext(
  Effect.gen(function* runtime() {
    const custody = instanceDeleteCustody(host.home, probeLayout);
    const fake = yield* makeFakeShell(custody);

    yield* fake.shell.mkdir({ mode: 0o700, path: "/srv/example/mailbox" });
    let bucketExists = false;

    const shell = {
      ...fake.shell,
      deleteCustody: custody,
      exec: (argv: readonly string[]) => {
        if (argv[0] === "systemd-run") {
          return Effect.succeed({ code: 0, stdout: "bootstrap deployed" });
        }

        if (argv[0] === "ss") {
          return Effect.gen(function* listeners() {
            const node = yield* fake.shell.exec([
              "systemctl",
              "--user",
              "is-active",
              probeLayout.nodeUnit,
            ]);

            const text = declaredListeners(
              "127.0.0.1",
              node.code === 0,
              false,
              probeLayout
            )
              .map(
                ({ address, port, unit }) =>
                  `LISTEN 0 128 ${address}:${port} 0.0.0.0:* cgroup:/${probeLayout.slice}/${unit}`
              )
              .join("\n");

            return { code: 0, stdout: text };
          });
        }

        if (argv[2] === s3Script) {
          if (argv[6] === "create") {
            bucketExists = true;
          }

          if (argv[6] === "purge") {
            bucketExists = false;
          }

          const status = argv[6] === "purge" ? 204 : 200;

          return Effect.succeed({
            code: 0,
            stdout: JSON.stringify({
              status:
                argv[6] === "pointer" || (argv[6] === "read" && !bucketExists)
                  ? 404
                  : status,
              version: "",
            }),
          });
        }

        if (
          argv[0] === "sh" ||
          argv[0] === "curl" ||
          (argv[0] === "python3" &&
            argv[2] ===
              storeSocketScript
                .replace("seaweedfs-s3-18333.sock", "seaweedfs-s3-28016.sock")
                .replace(
                  "seaweedfs-s3-grpc-28333.sock",
                  "seaweedfs-s3-grpc-28017.sock"
                ))
        ) {
          return Effect.succeed({ code: 0, stdout: "ready" });
        }

        return fake.shell.exec(argv);
      },
      purgeRoots: [
        probeLayout.configuration,
        probeLayout.binaryRoot,
        probeLayout.dataRoot,
      ],
    };

    return Context.make(Fake, fake).pipe(
      Context.add(HostShell, shell),
      Context.add(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(request, Response.json(probeIdentity))
          )
        )
      )
    );
  })
);

const binaryProvider = Provider.effect(
  ReleaseBinary,
  Effect.gen(function* provider() {
    const shell = yield* HostShell;

    return ReleaseBinary.Provider.of({
      delete: ({ output }) => deleteFile(shell, output),
      list: () => Effect.succeed([]),
      read: ({ output }) => Effect.succeed(output),
      reconcile: ({ news }) =>
        Effect.gen(function* install() {
          const content = "invented pinned binary";
          yield* shell.write({
            bytes: new TextEncoder().encode(content),
            mode: 0o755,
            path: news.path,
          });

          return { mode: 0o755, path: news.path, sha256: textDigest(content) };
        }),
    });
  })
);

const startupRuntime = Layer.unwrap(
  Effect.gen(function* startupRuntime() {
    const shell = yield* HostShell;

    return startupLayer(
      "127.0.0.1",
      "scope",
      `${probeLayout.dataRoot}/.mailbox-restore-objects.tar`,
      shell.write({
        bytes: new TextEncoder().encode("invented restored objects"),
        mode: 0o600,
        path: `${probeLayout.dataRoot}/.mailbox-restore-objects.tar`,
      }),
      probeLayout
    );
  })
).pipe(Layer.provideMerge(runtime), Layer.provideMerge(NodeServices.layer));

const { test } = Test.make({
  providers: Layer.mergeAll(
    ObjectStore.providers(),
    Celld.providers(),
    Celld.deploymentProvider(),
    binaryProvider
  ).pipe(
    Layer.provideMerge(startupRuntime),
    Layer.provide(NodePath.layer),
    Layer.provide(
      Layer.succeed(ReleaseSource, {
        get: () => Effect.die("Offline destroy must not download"),
      })
    ),
    Layer.orDie
  ),
  stage: "instance-destroy",
});

test.provider(
  "offline destroy-plan and real provider teardown leave only mailbox resources",
  (scratch) =>
    Effect.gen(function* teardown() {
      const fake = yield* Fake;
      const stack = checkedStack(scratch);

      const fresh = yield* stack.plan(
        instanceProbeProgram(host, probeLayout.dataRoot)
      );

      expect(fresh.resources["store/config-root"]?.downstream).toContain(
        "mischiefrb-deployment-stage-directory"
      );

      yield* stack.deploy(instanceProbeProgram(host, probeLayout.dataRoot));

      yield* fake.shell.write({
        bytes: new TextEncoder().encode("invented data"),
        mode: 0o600,
        path: `${probeLayout.dataRoot}/seaweedfs/volume.dat`,
      });

      const plan = yield* Plan.destroy({
        name: scratch.name,
        stage: scratch.stage,
      }).pipe(Effect.provide(scratch.state));

      expect(Object.keys(plan.deletions).length).toBeGreaterThan(20);

      const DeletionSurface = Schema.Record(
        Schema.String,
        Schema.Struct({
          state: Schema.Struct({
            attr: Schema.Struct({
              directory: Schema.optionalKey(Schema.String),
              name: Schema.optionalKey(Schema.String),
              path: Schema.optionalKey(Schema.String),
            }),
          }),
        })
      );

      const surface = yield* Schema.decodeEffect(
        Schema.fromJsonString(DeletionSurface)
      )(JSON.stringify(plan.deletions));

      const text = JSON.stringify(surface);
      expect(text).toContain("mischiefrb.slice");
      expect(text).toContain("mischiefrb-seaweedfs.service");
      expect(text).toContain("mischiefrb-celld.service");

      for (const value of [
        "rat-king.slice",
        "rat-king-celld.service",
        "rat-king-seaweedfs.service",
        "/.config/rat-king",
        "/.local/share/rat-king",
      ]) {
        expect(text).not.toContain(value);
      }

      yield* fake.clear();
      yield* stack.destroy();

      for (const path of [
        ...instanceDeleteCustody(host.home, probeLayout).directories,
        ...instanceDeleteCustody(host.home, probeLayout).files,
      ]) {
        expect(yield* fake.shell.stat(path)).toBeUndefined();
      }

      expect(yield* fake.shell.stat(host.dataRoot)).toBeDefined();

      const mutations = (yield* fake.calls()).filter(
        ({ operation }) => operation === "remove" || operation === "rmdir"
      );

      expect(
        mutations.every(({ argv }) => argv[0]?.includes("mischiefrb") === true)
      ).toBe(true);
    })
);

test.provider(
  "custody-enabled fresh deploy executes bootstrap and restore cleanup, then destroys interrupted bootstrap leftovers",
  (scratch) =>
    Effect.gen(function* interruptedBootstrap() {
      const fake = yield* Fake;
      const stack = checkedStack(scratch);

      const result = yield* Arbitrary.checkEffect(
        Arbitrary.schema(
          Schema.Struct({
            files: Schema.Array(Schema.Literals(["index.js", "wrangler.json"])),
            uuid: Schema.String.check(Schema.isUUID(4)),
          })
        ),
        ({ files, uuid }) =>
          Effect.gen(function* cycle() {
            yield* stack.destroy();
            yield* fake.clear();
            yield* stack.deploy(
              instanceProbeProgram(host, probeLayout.dataRoot)
            );

            const calls = yield* fake.calls();

            const bootstrap = calls.find(
              ({ operation, argv }) =>
                operation === "rmdir" &&
                argv[0]?.startsWith(
                  `${probeLayout.configuration}/bootstrap-`
                ) === true
            )?.argv[0];

            expect(bootstrap).toBeDefined();
            expect(
              calls.some(
                ({ operation, argv }) =>
                  operation === "remove" &&
                  argv[0] ===
                    `${probeLayout.dataRoot}/.mailbox-restore-objects.tar`
              )
            ).toBe(true);
            expect(
              calls.some(
                ({ operation, argv }) =>
                  operation === "remove" && argv[0] === `${bootstrap}/index.js`
              )
            ).toBe(true);
            expect(
              calls.some(
                ({ operation, argv }) =>
                  operation === "remove" &&
                  argv[0] === `${bootstrap}/wrangler.json`
              )
            ).toBe(true);

            const leftover = `${probeLayout.configuration}/bootstrap-${uuid.toLowerCase()}`;
            yield* fake.shell.mkdir({ mode: 0o700, path: leftover });

            for (const name of files) {
              yield* fake.shell.write({
                bytes: new TextEncoder().encode("interrupted bootstrap"),
                mode: 0o600,
                path: `${leftover}/${name}`,
              });
            }

            yield* stack.destroy();
            expect(
              yield* fake.shell.stat(probeLayout.configuration)
            ).toBeUndefined();
            expect(yield* fake.shell.stat(leftover)).toBeUndefined();
            expect(yield* fake.shell.stat(host.dataRoot)).toBeDefined();

            return true;
          }),
        { runs: 8 }
      );

      expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe("Passed");
    })
);

test.provider(
  "exact partial creating worker resumes without output and rejects invalid olds with recorded output",
  (scratch) =>
    Effect.gen(function* interruptedWorker() {
      const fake = yield* Fake;
      const stack = checkedStack(scratch);

      const state = yield* State.pipe(
        Effect.flatten,
        Effect.provide(scratch.state)
      );

      const program = instanceProbeProgram(host, probeLayout.dataRoot);

      const partial = {
        binary: `${probeLayout.bin}/celld`,
        bundle: `export default { fetch() { return Response.json(${JSON.stringify(probeIdentity)}); } };`,
        commit: probeIdentity.commit,
        configuration: JSON.stringify({
          compatibility_date: "2026-10-04",
          compatibility_flags: [],
          durable_objects: { bindings: [] },
          main: "worker.mjs",
          migrations: [],
          name: "mischiefrb",
          no_bundle: true,
          vars: {},
        }),
        directory: `${probeLayout.configuration}/deployment`,
        environmentFile: `${probeLayout.configuration}/celld.env`,
        version: probeIdentity.version,
      };

      const result = yield* Arbitrary.checkEffect(
        Arbitrary.schema(Schema.String.check(Schema.isUUID(4))),
        (uuid) =>
          Effect.gen(function* cycle() {
            for (const mode of [
              "resume",
              "recorded-output",
              "destroy-creating",
            ]) {
              yield* stack.destroy();

              const row = {
                bindings: [],
                downstream: [],
                fqn: "worker",
                instanceId: uuid.toLowerCase(),
                logicalId: "worker",
                namespace: undefined,
                props: partial,
                providerVersion: 0,
                resourceType: "Celld.Deployment",
              };

              if (mode === "resume") {
                yield* state.set({
                  fqn: "worker",
                  stack: scratch.name,
                  stage: scratch.stage,
                  value: { ...row, status: "creating" },
                });
                yield* state.set({
                  fqn: "celld/node",
                  stack: scratch.name,
                  stage: scratch.stage,
                  value: {
                    ...row,
                    fqn: "celld/node",
                    logicalId: "node",
                    namespace: undefined,
                    props: {
                      home: host.home,
                      name: probeLayout.nodeUnit,
                      scope: "user",
                    },
                    resourceType: "Celld.Node",
                    status: "creating",
                  },
                });

                const plan = yield* stack.plan(program);
                expect(plan.resources.worker?.action).toBe("create");
                const output = yield* stack.deploy(program);
                expect(output.internalUrl).toBe(
                  `http://127.0.0.1:${probeLayout.ports.internal}`
                );
              } else {
                const output = yield* stack.deploy(program);

                yield* state.set({
                  fqn: "worker",
                  stack: scratch.name,
                  stage: scratch.stage,
                  value:
                    mode === "recorded-output"
                      ? { ...row, attr: output, status: "created" }
                      : { ...row, status: "creating" },
                });

                if (mode === "recorded-output") {
                  const provider = yield* Celld.Deployment.Provider;

                  if (provider.read === undefined) {
                    return yield* Effect.die("Missing deployment read port");
                  }

                  const attempt = yield* checkedRead(provider, {
                    fqn: "worker",
                    id: "worker",
                    instanceId: row.instanceId,
                    olds: { ...output, internalUrl: "invalid" },
                    output,
                  }).pipe(Effect.exit);

                  expect(Exit.isFailure(attempt)).toBe(true);

                  if (Exit.isFailure(attempt)) {
                    expect(
                      yield* Schema.decodeUnknownEffect(
                        Schema.Struct({
                          _tag: Schema.Literal("DeploymentError"),
                          reason: Schema.Literal(
                            "Invalid internal listener URL"
                          ),
                        })
                      )(Cause.squash(attempt.cause)).pipe(Effect.isSuccess)
                    ).toBe(true);
                  }
                } else {
                  const teardown = yield* Plan.destroy({
                    name: scratch.name,
                    stage: scratch.stage,
                  }).pipe(Effect.provide(scratch.state));

                  expect(Object.keys(teardown.deletions).length).toBe(24);
                }
              }

              yield* stack.destroy();
              expect(
                yield* fake.shell.stat(probeLayout.configuration)
              ).toBeUndefined();
              expect(yield* fake.shell.stat(host.dataRoot)).toBeDefined();
            }

            return true;
          }),
        { runs: 4 }
      );

      expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe("Passed");
    })
);
