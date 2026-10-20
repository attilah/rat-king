import { createConnection, createServer } from "node:net";
import type { Socket } from "node:net";

import { TrustFailure } from "@rat-king/lexicon/trust";
import { Effect, Exit, FileSystem, Option, Schema } from "effect";
import { createActor, createMachine } from "xstate";
import type { SimulatedClock } from "xstate";

import { RenewRequest } from "./pass-launcher.ts";
import type { PassLauncher, PassResult } from "./pass-launcher.ts";
import { passFailure, privateDirectory, privateStat } from "./pass-registry.ts";

const malformed = {
  next: "send one JSON line within 5 seconds",
  ok: false as const,
  what: "Renewal refused",
  why: "request line is malformed or late",
};

type Response = typeof malformed | ({ readonly ok: true } & PassResult);

export const socketPath = (directory: string, label: string) =>
  `${directory}/${label.replaceAll("/", "%2F")}.sock`;

const socketOperation = <A>(
  register: (resolve: (value: A) => void, reject: () => void) => () => void
) =>
  Effect.callback<A, TrustFailure>((resume) => {
    const cancel = register(
      (value) => {
        resume(Effect.succeed(value));
      },
      () => {
        resume(Effect.fail(passFailure("pass socket operation failed")));
      }
    );

    return Effect.sync(cancel);
  });

export const servePassSocket = (
  directory: string,
  label: string,
  launcher: PassLauncher["Service"],
  options?: {
    readonly clock?: Pick<SimulatedClock, "setTimeout" | "clearTimeout">;
  }
) =>
  Effect.gen(function* serveSocket() {
    const path = socketPath(directory, label);

    if (Buffer.byteLength(path) > 100) {
      return yield* passFailure("socket path exceeds 100 bytes");
    }

    yield* privateDirectory(directory);
    const fs = yield* FileSystem.FileSystem;
    const context = yield* Effect.context();
    const previous = yield* privateStat(path);

    if (Option.isSome(previous)) {
      const stat = previous.value;

      if (
        !stat.isSocket() ||
        stat.uid !== process.getuid?.() ||
        stat.mode % 0o1000 !== 0o600
      ) {
        return yield* passFailure(
          "existing socket owner, type or mode is unsafe"
        );
      }

      const live = yield* socketOperation<boolean>((resolve) => {
        const peer = createConnection(path);
        peer.setTimeout(250);
        peer.once("connect", () => {
          peer.destroy();
          resolve(true);
        });
        peer.once("timeout", () => {
          peer.destroy();
          resolve(true);
        });
        peer.once("error", (error) => {
          peer.destroy();
          resolve(!("code" in error && error.code === "ECONNREFUSED"));
        });

        return () => {
          peer.destroy();
        };
      });

      if (live) {
        return yield* passFailure("a live peer holds the socket path");
      }

      const current = yield* privateStat(path);

      if (
        Option.isNone(current) ||
        current.value.ino !== stat.ino ||
        current.value.dev !== stat.dev
      ) {
        return yield* passFailure("socket changed during liveness check");
      }

      yield* fs.remove(path);
    }

    const connections = new Set<Socket>();

    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      let reply: Response = malformed;
      let sent = false;
      const controller = new AbortController();

      const write = () => {
        if (!sent && !socket.destroyed) {
          if (!reply.ok) {
            Effect.runForkWith(context)(Effect.logDebug(reply.what, reply.why));
          }

          sent = true;
          socket.end(`${JSON.stringify(reply)}\n`, () => {
            socket.destroy();
          });
        }
      };

      const actor = createActor(
        createMachine({
          after: { 5000: { target: ".closed" } },
          initial: "reading",
          states: {
            closed: {
              entry: () => {
                controller.abort();
                write();
              },
              type: "final",
            },
            handling: { on: { RESULT: { target: "writing" } } },
            reading: {
              on: { BAD: { target: "writing" }, LINE: { target: "handling" } },
            },
            writing: { entry: write, on: { DONE: { target: "closed" } } },
          },
        }),
        options
      );

      connections.add(socket);
      socket.once("error", () => {
        socket.destroy();
      });
      socket.once("close", () => {
        controller.abort();
        actor.stop();
        connections.delete(socket);
      });
      socket.once("finish", () => {
        actor.send({ type: "DONE" });
      });
      actor.start();
      socket.on("data", (data) => {
        if (!actor.getSnapshot().matches("reading")) {
          return;
        }

        const newline = data.indexOf(10);
        const chunk = newline === -1 ? data : data.subarray(0, newline);

        if (buffer.length + chunk.length > 16_384) {
          actor.send({ type: "BAD" });

          return;
        }

        buffer = Buffer.concat([buffer, chunk]);

        if (newline === -1) {
          return;
        }

        const decoded = Schema.decodeExit(Schema.fromJsonString(RenewRequest))(
          buffer.toString("utf-8")
        );

        if (Exit.isFailure(decoded)) {
          actor.send({ type: "BAD" });

          return;
        }

        actor.send({ type: "LINE" });

        const handle = launcher.renew(decoded.value).pipe(
          Effect.match({
            onFailure: (error): Response => {
              const [
                what = "Renewal refused",
                why = "renewal failed",
                next = "ask the desk for a new run",
              ] = error.reason.split(";").map((part) => part.trim());

              return { next, ok: false, what, why };
            },
            onSuccess: (result): Response => ({ ok: true, ...result }),
          }),
          Effect.tap((response) =>
            Effect.sync(() => {
              if (actor.getSnapshot().matches("handling")) {
                reply = response;
                actor.send({ type: "RESULT" });
              }
            })
          )
        );

        Effect.runForkWith(context)(handle, { signal: controller.signal });
      });
    });

    server.on("error", () => {
      Effect.runForkWith(context)(
        Effect.logError("Desk pass socket server failed")
      );
    });
    let owned: { readonly dev: number; readonly ino: number } | undefined;

    const release = Effect.gen(function* releaseSocket() {
      for (const socket of connections) {
        socket.destroy();
      }

      yield* socketOperation<null>((resolve) => {
        server.close(() => {
          resolve(null);
        });

        return () => {
          connections.clear();
        };
      });
      const stat = yield* privateStat(path);

      if (
        Option.isSome(stat) &&
        owned !== undefined &&
        stat.value.ino === owned.ino &&
        stat.value.dev === owned.dev
      ) {
        yield* fs.remove(path);
      }
    }).pipe(Effect.ignore);

    yield* Effect.acquireRelease(
      Effect.gen(function* listenSocket() {
        yield* socketOperation<null>((resolve, reject) => {
          server.once("error", reject);
          server.listen(path, () => {
            server.off("error", reject);
            resolve(null);
          });

          return () => {
            server.off("error", reject);
          };
        });
        const first = yield* privateStat(path);

        if (Option.isNone(first)) {
          return yield* passFailure("listening socket disappeared");
        }

        owned = first.value;
        yield* fs.chmod(path, 0o600);
        const stat = yield* privateStat(path);

        if (
          Option.isNone(stat) ||
          !stat.value.isSocket() ||
          stat.value.uid !== process.getuid?.() ||
          stat.value.mode % 0o1000 !== 0o600
        ) {
          return yield* passFailure(
            "listening socket owner, type or mode is unsafe"
          );
        }

        return yield* Effect.void;
      }).pipe(
        Effect.onExit((exit) => (Exit.isFailure(exit) ? release : Effect.void))
      ),
      () => release
    );

    return path;
  }).pipe(
    Effect.mapError((failure) =>
      Schema.is(TrustFailure)(failure)
        ? failure
        : passFailure("pass socket operation failed")
    )
  );
