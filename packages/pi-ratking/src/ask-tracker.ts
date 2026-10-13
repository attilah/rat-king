export interface AskTracker {
  readonly admitted: (id: string, did: string) => void;
  readonly answered: (id: string, did: string) => void;
  readonly count: () => number;
}

export const askTracker = (): AskTracker => {
  const pending = new Map<string, string>();
  const early = new Set<string>();

  return {
    admitted: (id, did) => {
      const key = `${did}:${id}`;

      if (!early.has(key)) {
        pending.set(id, did);
      }

      early.delete(key);
    },
    answered: (id, did) => {
      if (pending.get(id) === did) {
        pending.delete(id);
      } else {
        early.add(`${did}:${id}`);

        for (const key of [...early.keys()].slice(0, -200)) {
          early.delete(key);
        }
      }
    },
    count: () => pending.size,
  };
};
