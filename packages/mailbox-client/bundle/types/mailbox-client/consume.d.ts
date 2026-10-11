import * as Defs from "../lexicon/defs.js";
import type * as Lease from "../lexicon/runtime.lease.js";
import { Effect, Option } from "effect";
import { MailboxClientError } from "./error.js";
import type { LeaseFence, OpenedMessage, RatKingMailbox } from "./mailbox.js";
export declare const consumerMachine: import("xstate").StateMachine<{}, {
    type: string;
}, {
    [x: string]: import("xstate").AnyActor;
}, "acquiring" | "closed" | "consuming" | "releasing" | "waiting", string, unknown, undefined, {
    type: string;
}, never, {
    readonly context: {};
    readonly id: "mailbox-consumer";
    readonly initial: "acquiring";
    readonly states: {
        readonly acquiring: {
            readonly on: {
                readonly ACQUIRED: {
                    readonly target: "consuming";
                };
                readonly HELD: {
                    readonly target: "waiting";
                };
            };
        };
        readonly closed: {
            readonly type: "final";
        };
        readonly consuming: {
            readonly on: {
                readonly LOST: {
                    readonly target: "releasing";
                };
                readonly STOP: {
                    readonly target: "releasing";
                };
            };
        };
        readonly releasing: {
            readonly on: {
                readonly RELEASED: {
                    readonly target: "closed";
                };
            };
        };
        readonly waiting: {
            readonly on: {
                readonly RETRY: {
                    readonly target: "acquiring";
                };
            };
        };
    };
}, Record<string, (...args: any[]) => void | {
    context?: any;
    children?: any;
}>, Record<string, import("xstate").AnyActorLogic>, Record<string, Function>, Record<string, number | Function>, never, never> & {
    states: {
        readonly context: {};
        readonly id: "mailbox-consumer";
        readonly initial: "acquiring";
        readonly states: {
            readonly acquiring: {
                readonly on: {
                    readonly ACQUIRED: {
                        readonly target: "consuming";
                    };
                    readonly HELD: {
                        readonly target: "waiting";
                    };
                };
            };
            readonly closed: {
                readonly type: "final";
            };
            readonly consuming: {
                readonly on: {
                    readonly LOST: {
                        readonly target: "releasing";
                    };
                    readonly STOP: {
                        readonly target: "releasing";
                    };
                };
            };
            readonly releasing: {
                readonly on: {
                    readonly RELEASED: {
                        readonly target: "closed";
                    };
                };
            };
            readonly waiting: {
                readonly on: {
                    readonly RETRY: {
                        readonly target: "acquiring";
                    };
                };
            };
        };
    };
} & {
    readonly id: "mailbox-consumer";
    readonly version: undefined;
};
export interface MessageMeta {
    readonly seq: number;
}
export interface Skipped {
    readonly seq: number;
    readonly reason: "expired" | "settled" | "unopenable";
}
export interface ConsumeOptions {
    readonly harness: Lease.MainValue["harness"];
    readonly renders?: readonly string[];
    readonly resume?: LeaseFence;
    readonly afterSeq?: number;
    readonly onLease?: (lease: Lease.MainValue) => Effect.Effect<void>;
    readonly unopenable?: (event: Defs.MessageEventValue, error: MailboxClientError) => Effect.Effect<Option.Option<OpenedMessage>>;
    readonly onSkip?: (skipped: Skipped) => Effect.Effect<void>;
}
export declare const consume: <E, R>(mailbox: typeof RatKingMailbox.Service, did: string, handler: (message: OpenedMessage, meta: MessageMeta) => Effect.Effect<void, E, R>, options: ConsumeOptions) => Effect.Effect<void, E | MailboxClientError, R>;
