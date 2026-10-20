import { createConnection } from "node:net";

import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { PrivateJwk } from "@rat-king/mailbox-client";
import {
  Arbitrary,
  Clock,
  Deferred,
  Fiber,
  Effect,
  Exit,
  FileSystem,
  Option,
  Result,
  Schema,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import { expect, vi } from "vitest";
import { SimulatedClock } from "xstate";

import { signTicket, SignedPass, SignedTicket } from "../../lexicon/passes.ts";
import { keypair } from "../../lexicon/test/pass-helpers.ts";
import {
  importDeskSigningKey,
  makePassLauncher,
  renewalBytes,
} from "../src/pass-launcher.ts";
import {
  makeRunRegistry,
  passFailure,
  privateStat,
} from "../src/pass-registry.ts";
import { servePassSocket, socketPath } from "../src/pass-socket.ts";
import { plantDeadSocket, runEffectModel } from "./pass-launcher-model.ts";

const Reply = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    pass: SignedPass,
    ticket: Schema.optionalKey(SignedTicket),
  }),
  Schema.Struct({
    next: Schema.String,
    ok: Schema.Literal(false),
    what: Schema.String,
    why: Schema.String,
  }),
]);

const exchange = (path: string, line: string, clock?: SimulatedClock) =>
  Effect.callback<string, Error>((resume) => {
    const socket = createConnection(path);
    let response = "";
    socket.once("connect", () => {
      if (clock === undefined) {
        socket.write(line);
      } else {
        clock.increment(5001);
      }
    });
    socket.on("data", (data) => {
      response += data.toString("utf-8");
    });
    socket.once("end", () => {
      resume(Effect.succeed(response));
    });
    socket.once("error", (error) => {
      resume(Effect.fail(error));
    });

    return Effect.sync(() => {
      socket.destroy();
    });
  });

const decodedExchange = (path: string, line: string, clock?: SimulatedClock) =>
  Effect.gen(function* decodeReply() {
    const wire = yield* exchange(path, line, clock);
    expect(wire.endsWith("\n")).toBe(true);
    expect(wire.split("\n")).toHaveLength(2);

    return yield* Schema.decodeEffect(Schema.fromJsonString(Reply))(wire);
  });

const setup = Effect.gen(function* setupLauncher() {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "rk-" });
  yield* fs.chmod(directory, 0o700);
  const desk = yield* keypair;
  const workers = [yield* keypair, yield* keypair];
  const blocked: string[] = [];
  const registry = yield* makeRunRegistry(directory, "desk");

  const options = {
    desk: "desk",
    deskDid: "did:web:desk.example.invalid",
    key: desk.signer,
    onBlocked: (run: string, reason: string) =>
      Effect.sync(() => {
        blocked.push(`${run}: ${reason}`);
      }),
    registry,
    socket: socketPath(directory, "desk"),
  };

  const launcher = yield* makePassLauncher(options);
  const clock = new SimulatedClock();
  const socketScope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(socketScope, Exit.void));
  yield* servePassSocket(directory, "desk", launcher, { clock }).pipe(
    Effect.provideService(Scope.Scope, socketScope)
  );

  const proof = (run: string, worker: number, nonce: string, delta = 0) =>
    Effect.gen(function* signRenewal() {
      const key = workers[worker];

      if (key === undefined) {
        return yield* Effect.die("missing worker");
      }

      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000) + delta;
      const fields = { nonce, now, run };

      return {
        ...fields,
        signature: yield* key.signer.sign(renewalBytes(run, key.did, fields)),
      };
    });

  const request = (
    run: string,
    worker: number,
    nonce: string,
    token?: string,
    delta = 0
  ) =>
    Effect.gen(function* renewalRequest() {
      const body = {
        proof: yield* proof(run, worker, nonce, delta),
        run,
        workerDid: workers[worker]?.did ?? "",
      };

      return token === undefined ? body : { ...body, token };
    });

  return {
    blocked,
    clock,
    desk,
    directory,
    launcher,
    options,
    proof,
    request,
    socketScope,
    workers,
  };
});

const Action = Schema.Struct({
  kind: Schema.Literals([
    "start",
    "claim",
    "renew",
    "close",
    "second-worker",
    "late-line",
  ]),
  run: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 })),
});

interface Model {
  readonly runs: Map<
    number,
    {
      state: "open" | "bound" | "closed" | "compromised";
      token: string;
      worker: number;
    }
  >;
}

type Real = Effect.Success<typeof setup>;

const modelAllows = (
  row: Model["runs"] extends Map<number, infer R> ? R | undefined : never,
  kind: typeof Action.Type.kind,
  worker: number
) =>
  row !== undefined &&
  (kind === "renew"
    ? row.state === "bound" && row.worker === worker
    : row.state === "open" || (row.state === "bound" && row.worker === worker));

it.effect.prop(
  "socket commands follow a durable run model and every response is exactly one typed JSON line",
  [Arbitrary.schema(Schema.Array(Action).check(Schema.isMaxLength(20)))],
  ([generated]) =>
    Effect.gen(function* socketModel() {
      yield* TestClock.setTime(1_000_000);
      const real = yield* setup;

      const required: readonly (typeof Action.Type)[] = [
        { kind: "start", run: 0 },
        { kind: "claim", run: 0 },
        { kind: "renew", run: 0 },
        { kind: "second-worker", run: 0 },
        { kind: "renew", run: 0 },
        { kind: "start", run: 1 },
        { kind: "close", run: 1 },
        { kind: "claim", run: 1 },
        { kind: "start", run: 2 },
        { kind: "renew", run: 2 },
        { kind: "late-line", run: 2 },
      ];

      const commands = [...required, ...generated].map((action, index) => ({
        check: () => true,
        run: (model: Model, state: Real) =>
          Effect.gen(function* command() {
            const run = `worker:${action.run.toString(16).padStart(32, "0")}`;
            const row = model.runs.get(action.run);

            if (action.kind === "start") {
              const result = yield* state.launcher
                .start({
                  desk: "desk",
                  run,
                  scope: ["rk.send.plain"],
                  ttl: 2000,
                })
                .pipe(Effect.result);

              expect(Result.isSuccess(result)).toBe(row === undefined);

              if (Result.isSuccess(result)) {
                model.runs.set(action.run, {
                  state: "open",
                  token: result.success.env.RK_PASS_CLAIM,
                  worker: 0,
                });
              }

              return;
            }

            if (action.kind === "close") {
              yield* state.launcher.close(run);

              model.runs.set(action.run, {
                state: "closed",
                token: row?.token ?? "",
                worker: row?.worker ?? 0,
              });

              return;
            }

            if (action.kind === "late-line") {
              const reply = yield* decodedExchange(
                state.options.socket,
                "",
                state.clock
              );

              expect(reply.ok).toBe(false);

              return;
            }

            const worker = action.kind === "second-worker" ? 1 : 0;

            const token =
              action.kind === "renew" ? undefined : (row?.token ?? "bad");

            const body = yield* state.request(
              run,
              worker,
              `nonce-${index}`,
              token
            );

            const reply = yield* decodedExchange(
              state.options.socket,
              `${JSON.stringify(body)}\n`
            );

            const expected = modelAllows(row, action.kind, worker);

            expect(reply.ok).toBe(expected);

            if (
              row !== undefined &&
              action.kind !== "renew" &&
              row.state === "bound" &&
              row.worker !== worker
            ) {
              row.state = "compromised";
            } else if (reply.ok && row !== undefined) {
              row.state = "bound";
              row.worker = worker;
            }

            if (reply.ok) {
              expect(reply.pass.record.run).toBe(run);
              expect(reply.pass.record.exp).toBe(1600);
              expect(reply.pass.record.scope).toEqual(["rk.send.plain"]);
            }
          }),
        toString: () => JSON.stringify(action),
      }));

      yield* runEffectModel(
        () => ({ model: { runs: new Map() }, real }),
        commands
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 15 } }
);

it.effect.prop(
  "racing token claims compromise durably, notify once and retain the tombstone for 24 hours past the grant",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2000, minimum: 1 }))
    ),
  ],
  ([ttl]) =>
    Effect.gen(function* racingClaims() {
      yield* TestClock.setTime(1_000_000);
      const state = yield* setup;
      const revoked: string[] = [];

      const launcher = yield* makePassLauncher({
        ...state.options,
        onRevoke: (run) =>
          Effect.sync(() => {
            revoked.push(run);
          }),
      });

      yield* Scope.close(state.socketScope, Exit.void);
      yield* servePassSocket(state.directory, "desk", launcher);

      const { env } = yield* launcher.start({
        desk: "desk",
        run: "worker:00000000000000000000000000000009",
        scope: ["rk.send.plain"],
        ttl,
      });

      const first = yield* state.request(
        env.RK_PASS_RUN,
        0,
        "racing-first",
        env.RK_PASS_CLAIM
      );

      const second = yield* state.request(
        env.RK_PASS_RUN,
        1,
        "racing-second",
        env.RK_PASS_CLAIM
      );

      const replies = yield* Effect.all(
        [
          decodedExchange(env.RK_PASS_SOCKET, `${JSON.stringify(first)}\n`),
          decodedExchange(env.RK_PASS_SOCKET, `${JSON.stringify(second)}\n`),
        ],
        { concurrency: "unbounded" }
      );

      expect(replies.filter((reply) => reply.ok)).toHaveLength(1);
      expect(state.blocked).toHaveLength(1);
      expect(revoked).toEqual([env.RK_PASS_RUN]);

      const restarted = yield* makePassLauncher({
        ...state.options,
        registry: yield* makeRunRegistry(state.directory, "desk"),
      });

      for (const worker of [0, 1]) {
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              restarted.renew(
                yield* state.request(
                  env.RK_PASS_RUN,
                  worker,
                  `restart-${worker}`
                )
              )
            )
          )
        ).toBe(true);
      }

      yield* TestClock.setTime((1000 + ttl + 86_400) * 1000);

      const launch = {
        desk: "desk",
        run: env.RK_PASS_RUN,
        scope: ["rk.send.plain"],
        ttl,
      };

      expect(Exit.isFailure(yield* Effect.exit(restarted.start(launch)))).toBe(
        true
      );
      yield* TestClock.setTime((1001 + ttl + 86_400) * 1000);
      yield* restarted.start(launch);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 } }
);

it.effect.prop(
  "disconnect cancellation cannot skip the notification after a durable compromise",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2000, minimum: 1 }))
    ),
  ],
  ([ttl]) =>
    Effect.gen(function* cancellationFence() {
      yield* TestClock.setTime(1_000_000);
      const state = yield* setup;

      const { env } = yield* state.launcher.start({
        desk: "desk",
        run: "worker:0000000000000000000000000000000a",
        scope: ["rk.send.plain"],
        ttl,
      });

      yield* state.launcher.renew(
        yield* state.request(env.RK_PASS_RUN, 0, "bound", env.RK_PASS_CLAIM)
      );
      const revoking = yield* Deferred.make<null>();
      const release = yield* Deferred.make<null>();

      const launcher = yield* makePassLauncher({
        ...state.options,
        onRevoke: () =>
          Deferred.succeed(revoking, null).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.asVoid
          ),
      });

      const request = yield* state.request(
        env.RK_PASS_RUN,
        1,
        "compromising",
        env.RK_PASS_CLAIM
      );

      const claim = yield* launcher.renew(request).pipe(Effect.forkChild);
      yield* Deferred.await(revoking);
      const interrupted = yield* Fiber.interrupt(claim).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, null);
      yield* Fiber.join(interrupted);
      expect(state.blocked).toHaveLength(1);
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            state.launcher.renew(
              yield* state.request(env.RK_PASS_RUN, 0, "after-interrupt")
            )
          )
        )
      ).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 } }
);

const Plant = Schema.Literals([
  "malformed",
  "oversize",
  "signature",
  "mismatch",
  "skew",
  "replay",
  "unknown",
  "token",
  "expired-token",
  "other-worker",
  "expired-grant",
  "signing",
]);

it.effect.prop(
  "R1–R8 plants refuse without issuing a pass",
  [Arbitrary.schema(Plant)],
  ([plant]) =>
    Effect.gen(function* refusalPlants() {
      yield* TestClock.setTime(1_000_000);
      const state = yield* setup;
      const run = "worker:00000000000000000000000000000001";

      const { env } = yield* state.launcher.start({
        desk: "desk",
        run,
        scope: ["rk.send.plain"],
        ttl: 2000,
      });

      const body = yield* state.request(run, 0, "original", env.RK_PASS_CLAIM);

      let wire = `${JSON.stringify(body)}\n`;

      switch (plant) {
        case "malformed": {
          wire = "not json\n";
          break;
        }

        case "oversize": {
          wire = `${"x".repeat(16_385)}\n`;
          break;
        }

        case "signature": {
          wire = `${JSON.stringify({ ...body, proof: { ...body.proof, signature: "A".repeat(86) } })}\n`;
          break;
        }

        case "mismatch": {
          wire = `${JSON.stringify({ ...body, run: "worker:00000000000000000000000000000003" })}\n`;
          break;
        }

        case "skew": {
          wire = `${JSON.stringify(yield* state.request(run, 0, "skew", env.RK_PASS_CLAIM, 61))}\n`;
          break;
        }

        case "replay": {
          expect((yield* decodedExchange(env.RK_PASS_SOCKET, wire)).ok).toBe(
            true
          );
          break;
        }

        case "unknown": {
          wire = `${JSON.stringify(yield* state.request("worker:00000000000000000000000000000004", 0, "unknown", env.RK_PASS_CLAIM))}\n`;
          break;
        }

        case "token": {
          wire = `${JSON.stringify({ ...body, token: "wrong" })}\n`;
          break;
        }

        case "expired-token": {
          yield* TestClock.setTime(1_300_000);
          wire = `${JSON.stringify(yield* state.request(run, 0, "expired", env.RK_PASS_CLAIM))}\n`;
          break;
        }

        case "other-worker": {
          expect((yield* decodedExchange(env.RK_PASS_SOCKET, wire)).ok).toBe(
            true
          );
          wire = `${JSON.stringify(yield* state.request(run, 1, "other"))}\n`;
          break;
        }

        case "expired-grant": {
          yield* TestClock.setTime(3_000_000);
          wire = `${JSON.stringify(yield* state.request(run, 0, "expired-grant", env.RK_PASS_CLAIM))}\n`;
          break;
        }

        case "signing": {
          const launcher = yield* makePassLauncher({
            ...state.options,
            key: {
              publicKey: state.desk.publicKey,
              sign: () =>
                Effect.fail(
                  passFailure(
                    "ES256 signing failed",
                    "Signing refused",
                    "use the matching P-256 private key"
                  )
                ),
            },
          });

          yield* Scope.close(state.socketScope, Exit.void);
          yield* servePassSocket(state.directory, "desk", launcher);
          break;
        }

        default: {
          return yield* Effect.die("unexpected plant");
        }
      }

      expect((yield* decodedExchange(env.RK_PASS_SOCKET, wire)).ok).toBe(false);

      return yield* Effect.void;
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 36 } }
);

it.effect.prop(
  "restarts preserve bound runs and terminal tombstones, private modes, token hashing and grant limits",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 599, minimum: 1 }))
    ),
  ],
  ([ttl]) =>
    Effect.gen(function* restartProperty() {
      yield* TestClock.setTime(1_000_000);
      const state = yield* setup;
      const run = "worker:00000000000000000000000000000002";

      const { env } = yield* state.launcher.start({
        desk: "desk",
        run,
        scope: ["rk.send.plain"],
        ttl,
      });

      const first = yield* state.launcher.renew(
        yield* state.request(run, 0, "first", env.RK_PASS_CLAIM)
      );

      expect(first.pass.record.exp).toBe(1000 + ttl);
      const fs = yield* FileSystem.FileSystem;

      const saved = yield* fs.readFileString(
        `${state.directory}/desk.runs.json`
      );

      expect(saved).not.toContain(env.RK_PASS_CLAIM);
      expect(env.RK_PASS_CLAIM).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(first.pass.record.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/u);
      const stat = yield* privateStat(`${state.directory}/desk.runs.json`);
      expect(Option.isSome(stat) && stat.value.mode % 0o1000).toBe(0o600);
      yield* Scope.close(state.socketScope, Exit.void);

      const restarted = yield* makePassLauncher({
        ...state.options,
        registry: yield* makeRunRegistry(state.directory, "desk"),
      });

      yield* servePassSocket(state.directory, "desk", restarted);

      const renewed = yield* decodedExchange(
        env.RK_PASS_SOCKET,
        `${JSON.stringify(yield* state.request(run, 0, "after-restart"))}\n`
      );

      expect(renewed.ok).toBe(true);
      expect(renewed.ok && renewed.pass.record.nonce).not.toBe(
        first.pass.record.nonce
      );
      yield* restarted.close(run);

      const again = yield* makePassLauncher({
        ...state.options,
        registry: yield* makeRunRegistry(state.directory, "desk"),
      });

      yield* TestClock.setTime((1000 + ttl + 86_400) * 1000);
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            again.start({ desk: "desk", run, scope: ["rk.send.plain"], ttl })
          )
        )
      ).toBe(true);
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            again.renew(yield* state.request(run, 0, "closed"))
          )
        )
      ).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 } }
);

it.effect.prop(
  "the desk key is non-extractable and the public server graph contains no private JWK field",
  [
    Arbitrary.schema(
      Schema.Array(
        Schema.Int.check(Schema.isBetween({ maximum: 255, minimum: 0 }))
      ).check(Schema.isMaxLength(128))
    ),
  ],
  ([bytes]) =>
    Effect.gen(function* keyBoundary() {
      const algorithm = { name: "ECDSA", namedCurve: "P-256" };

      const keys = yield* Effect.tryPromise({
        catch: () => passFailure("test key generation failed"),
        try: crypto.subtle.generateKey.bind(crypto.subtle, algorithm, true, [
          "sign",
          "verify",
        ]),
      });

      if (!("privateKey" in keys)) {
        return yield* Effect.die("not a key pair");
      }

      const exported = yield* Effect.tryPromise({
        catch: () => passFailure("test key export failed"),
        try: crypto.subtle.exportKey.bind(
          crypto.subtle,
          "jwk",
          keys.privateKey
        ),
      });

      const jwk = yield* Schema.decodeUnknownEffect(PrivateJwk)(exported);

      const imported = yield* Effect.acquireRelease(
        Effect.sync(() => vi.spyOn(crypto.subtle, "importKey")),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore();
          })
      );

      const key = yield* importDeskSigningKey(jwk);
      expect(imported.mock.calls.at(-1)?.slice(0, 5)).toEqual([
        "jwk",
        jwk,
        algorithm,
        false,
        ["sign"],
      ]);
      const seen = new Set<object>();

      const Graph = Schema.Record(Schema.String, Schema.Unknown);

      const inspect = (value: typeof Graph.Type): void => {
        if (seen.has(value)) {
          return;
        }

        seen.add(value);
        expect(Object.hasOwn(value, "d")).toBe(false);

        for (const nested of Object.values(value)) {
          const decoded = Schema.decodeUnknownOption(Graph)(nested);

          if (Option.isSome(decoded)) {
            inspect(decoded.value);
          }
        }
      };

      const state = yield* setup;
      const launcher = yield* makePassLauncher({ ...state.options, key });
      inspect(yield* Schema.decodeUnknownEffect(Graph)({ key, launcher }));
      expect((yield* key.sign(Uint8Array.from(bytes))).length).toBe(86);

      return yield* Effect.void;
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "the ticket source is read for each claim and renewal, while request garbage always gets one typed response",
  [Arbitrary.schema(Schema.String)],
  ([garbage]) =>
    Effect.gen(function* ticketsAndWire() {
      yield* TestClock.setTime(1_000_000);
      const state = yield* setup;

      const ticket = (iat: number) =>
        signTicket(
          state.desk.signer,
          {
            $type: "sh.ratking.ticket",
            did: state.options.deskDid,
            exp: iat + 900,
            fingerprint: "a".repeat(64),
            iat,
            issuer: "issuer.example.invalid",
            name: "desk",
            namespace: "project/",
          },
          state.desk.publicKey
        );

      let current = yield* ticket(1000);
      const first = current;

      const launcher = yield* makePassLauncher({
        ...state.options,
        ticketSource: Effect.sync(() => current),
      });

      yield* Scope.close(state.socketScope, Exit.void);
      yield* servePassSocket(state.directory, "desk", launcher);

      const { env } = yield* launcher.start({
        desk: "desk",
        run: "worker:00000000000000000000000000000005",
        scope: ["rk.send.plain"],
        ttl: 2000,
      });

      const claimed = yield* decodedExchange(
        env.RK_PASS_SOCKET,
        `${JSON.stringify(yield* state.request(env.RK_PASS_RUN, 0, "ticket-claim", env.RK_PASS_CLAIM))}\n`
      );

      expect(claimed.ok && claimed.ticket).toEqual(first);
      current = yield* ticket(1001);

      const renewed = yield* decodedExchange(
        env.RK_PASS_SOCKET,
        `${JSON.stringify(yield* state.request(env.RK_PASS_RUN, 0, "ticket-renew"))}\n`
      );

      expect(renewed.ok && renewed.ticket).toEqual(current);

      const refused = yield* decodedExchange(
        env.RK_PASS_SOCKET,
        `${garbage}\n`
      );

      expect(refused.ok).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 15 } }
);

it.effect.prop(
  "proof freshness includes sixty seconds and nonce retention lasts exactly 120 seconds",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 60, minimum: -60 }))
    ),
  ],
  ([skew]) =>
    Effect.gen(function* proofBoundaries() {
      yield* TestClock.setTime(1_000_000);
      const state = yield* setup;

      const { env } = yield* state.launcher.start({
        desk: "desk",
        run: "worker:00000000000000000000000000000006",
        scope: ["rk.send.plain"],
        ttl: 2000,
      });

      yield* state.launcher.renew(
        yield* state.request(
          env.RK_PASS_RUN,
          0,
          "fresh",
          env.RK_PASS_CLAIM,
          skew
        )
      );

      const request = yield* state.request(
        env.RK_PASS_RUN,
        0,
        "future",
        undefined,
        60
      );

      yield* state.launcher.renew(request);
      yield* TestClock.setTime(1_119_000);
      expect(
        Exit.isFailure(yield* Effect.exit(state.launcher.renew(request)))
      ).toBe(true);
      yield* TestClock.setTime(1_120_000);
      yield* state.launcher.renew(request);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 12 } }
);

it.effect.prop(
  "live sockets, unsafe paths and wider scopes fail closed",
  [
    Arbitrary.schema(
      Schema.Literals([
        "live",
        "long",
        "directory-mode",
        "directory-symlink",
        "socket-mode",
        "dead",
        "file",
        "symlink",
        "scope",
        "run",
      ])
    ),
  ],
  ([plant]) =>
    Effect.gen(function* socketFence() {
      const state = yield* setup;
      const fs = yield* FileSystem.FileSystem;

      if (plant === "scope" || plant === "run") {
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              state.launcher.start({
                desk: "desk",
                run:
                  plant === "run"
                    ? "bad-run"
                    : "worker:00000000000000000000000000000007",
                scope:
                  plant === "scope"
                    ? ["rk.send.plain", "rk.ask"]
                    : ["rk.send.plain"],
                ttl: 2000,
              })
            )
          )
        ).toBe(true);

        return;
      }

      if (plant === "live") {
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              servePassSocket(state.directory, "desk", state.launcher)
            )
          )
        ).toBe(true);

        return;
      }

      if (plant === "long") {
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              servePassSocket(state.directory, "x".repeat(101), state.launcher)
            )
          )
        ).toBe(true);

        return;
      }

      if (plant === "socket-mode") {
        yield* fs.chmod(state.options.socket, 0o644);
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              servePassSocket(state.directory, "desk", state.launcher)
            )
          )
        ).toBe(true);
        yield* fs.chmod(state.options.socket, 0o600);

        return;
      }

      yield* Scope.close(state.socketScope, Exit.void);

      if (plant === "dead") {
        const path = socketPath(state.directory, "project/desk");
        expect(path.endsWith("project%2Fdesk.sock")).toBe(true);
        yield* plantDeadSocket(path);
        yield* servePassSocket(state.directory, "project/desk", state.launcher);
        expect((yield* decodedExchange(path, "invalid\n")).ok).toBe(false);

        return;
      }

      if (plant === "directory-symlink") {
        const alias = `${state.directory}/linked`;
        yield* fs.symlink(state.directory, alias);
        expect(
          Exit.isFailure(
            yield* Effect.exit(servePassSocket(alias, "desk", state.launcher))
          )
        ).toBe(true);

        return;
      }

      if (plant === "directory-mode") {
        yield* fs.chmod(state.directory, 0o755);
      } else if (plant === "file") {
        yield* fs.writeFileString(state.options.socket, "not a socket", {
          mode: 0o600,
        });
      } else {
        yield* fs.symlink(
          `${state.directory}/desk.runs.json`,
          state.options.socket
        );
      }

      expect(
        Exit.isFailure(
          yield* Effect.exit(
            servePassSocket(state.directory, "desk", state.launcher)
          )
        )
      ).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 21 } }
);
