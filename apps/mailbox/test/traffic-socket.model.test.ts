import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { socketCodes } from "../src/socket.ts";
import { trafficSockets } from "../src/traffic-socket.ts";

const Steps = Arbitrary.schema(
  Schema.Array(Schema.Literals(["authenticate", "broadcast", "close"])).check(
    Schema.isMaxLength(20)
  )
);

const unsupported = (): never => {
  throw new Error("Unexpected platform call");
};

const Attachment = Schema.Struct({
  deadline: Schema.Int,
  expiresAt: Schema.Int,
  state: Schema.String,
});

const fixture = (expired = false) => {
  let attachment = {
    deadline: expired ? 0 : Number.MAX_SAFE_INTEGER,
    expiresAt: Number.MAX_SAFE_INTEGER,
    state: "awaitingAuth",
  };

  const sent: string[] = [];
  const closed: number[] = [];

  const socket: WebSocket = {
    accept: unsupported,
    addEventListener: unsupported,
    binaryType: "arraybuffer",
    close: (code) => {
      if (code !== undefined) {
        closed.push(code);
      }
    },
    deserializeAttachment: () => attachment,
    dispatchEvent: unsupported,
    extensions: null,
    protocol: null,
    readyState: 1,
    removeEventListener: unsupported,
    send: (value) => {
      sent.push(Schema.decodeUnknownSync(Schema.String)(value));
    },
    serializeAttachment: (value: typeof attachment) => {
      attachment = Schema.decodeUnknownSync(Attachment)(value);
    },
    url: null,
  };

  const ctx: DurableObjectState = {
    abort: unsupported,
    acceptWebSocket: unsupported,
    blockConcurrencyWhile: unsupported,
    get exports() {
      return unsupported();
    },
    get facets() {
      return unsupported();
    },
    getHibernatableWebSocketEventTimeout: unsupported,
    getTags: unsupported,
    getWebSocketAutoResponse: unsupported,
    getWebSocketAutoResponseTimestamp: unsupported,
    getWebSockets: () => [socket],
    get id() {
      return unsupported();
    },
    props: undefined,
    setHibernatableWebSocketEventTimeout: unsupported,
    setWebSocketAutoResponse: unsupported,
    get storage() {
      return unsupported();
    },
    waitUntil: unsupported,
  };

  let authCalls = 0;

  const api = trafficSockets(
    ctx,
    () =>
      Effect.sync(() => {
        authCalls += 1;

        return {
          aud: "observer",
          exp: 8_000_000_000,
          iat: 0,
          iss: "observer",
          jti: "0123456789abcdef",
          lxm: "traffic",
        };
      }),
    () => 42
  );

  return {
    api,
    authCalls: () => authCalls,
    closed,
    sent,
    socket,
    state: () => attachment.state,
  };
};

interface Model {
  authCalls: number;
  authenticated: boolean;
  closed: boolean;
  notices: number;
}

type Real = ReturnType<typeof fixture>;

type RunCommand = (effect: Effect.Effect<void>) => Promise<void>;

const runCommand: RunCommand = Effect.runPromise;

it.effect.prop(
  "traffic subscriptions authenticate once, never leak notices before authentication, and stay closed",
  [Steps],
  ([steps]) => {
    const real = fixture();

    const model: Model = {
      authCalls: 0,
      authenticated: false,
      closed: false,
      notices: 0,
    };

    const commands: AsyncCommand<Model, Real>[] = steps.map((step) => {
      const run = Effect.gen(function* command() {
        if (step === "authenticate") {
          yield* Effect.promise(
            real.api.message.bind(
              undefined,
              real.socket,
              JSON.stringify({
                $type: "sh.mschf.ratking.mailbox.subscribeTraffic#auth",
                token: "test-token",
              })
            )
          );

          if (!model.closed && !model.authenticated) {
            model.authenticated = true;
            model.authCalls += 1;
            model.notices += 1;
          } else {
            model.closed = true;
          }
        } else if (step === "close") {
          real.api.close(real.socket);
          model.closed = true;
        } else {
          real.api.broadcast();

          if (model.authenticated && !model.closed) {
            model.notices += 1;
          }
        }

        let state = "awaitingAuth";

        if (model.authenticated) {
          state = "authenticated";
        }

        if (model.closed) {
          state = "closed";
        }

        expect(real.state()).toBe(state);
        expect(real.authCalls()).toBe(model.authCalls);
        expect(real.sent).toEqual(
          Array.from({ length: model.notices }, () =>
            JSON.stringify({
              $type: "sh.mschf.ratking.mailbox.subscribeTraffic#notice",
              seq: 42,
            })
          )
        );
      });

      return {
        check: () => true,
        run: runCommand.bind(undefined, run),
        toString: () => step,
      };
    });

    return Effect.promise(
      asyncModelRun.bind(undefined, () => ({ model, real }), commands)
    );
  }
);

it.effect.prop(
  "expired or malformed authentication closes the subscription without disclosing a watermark",
  [Arbitrary.schema(Schema.Boolean)],
  ([expired]) => {
    const real = fixture(expired);

    const message = expired
      ? JSON.stringify({
          $type: "sh.mschf.ratking.mailbox.subscribeTraffic#auth",
          token: "test-token",
        })
      : "!";

    return Effect.promise(
      real.api.message.bind(undefined, real.socket, message)
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(real.state()).toBe("closed");
          expect(real.sent).toEqual([]);
          expect(real.closed).toEqual([socketCodes.auth]);
          expect(real.authCalls()).toBe(0);
        })
      )
    );
  }
);
