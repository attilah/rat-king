import { Transport } from "../lexicon/transport.js";
import { Effect } from "effect";
import { MailboxClientError } from "./error.js";
export interface ReaderPresence {
    readonly held: boolean;
    readonly renders?: readonly string[];
}
export declare const readerCannotRender: (name: string, type: string, presence: ReaderPresence | undefined) => string | undefined;
export declare const recordType: (body: string) => string;
export declare const lookupPresence: (did: string) => Effect.Effect<{
    readonly [x: string]: import("../lexicon/runtime.js").LexValue;
    readonly did: string & import("effect/Brand").Brand<"Lexicon:did">;
    readonly held: boolean;
    readonly lastHeldAt?: string & import("effect/Brand").Brand<"Lexicon:datetime">;
    readonly renders?: readonly string[];
}, MailboxClientError, Transport>;
