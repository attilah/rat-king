import { Effect, Semaphore } from "effect";

import { handleContact } from "./session.ts";
import type { SessionStorage } from "./session.ts";

export const contactDispatcher = <R>(
  desk: string,
  storage: SessionStorage<R>
) =>
  Effect.gen(function* initializeDispatcher() {
    const gate = yield* Semaphore.make(1);

    return (request: Request, body: string, externalId: string) =>
      gate.withPermits(1)(
        handleContact(request, body, externalId, desk, storage)
      );
  });
