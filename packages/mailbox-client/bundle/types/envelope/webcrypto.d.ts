import { Effect } from "effect";
import { EnvelopeFailure } from "./failure.js";
export declare const cryptoOperation: <A>(operation: () => Promise<A>) => Effect.Effect<A, EnvelopeFailure, never>;
