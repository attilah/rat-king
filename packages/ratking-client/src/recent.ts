export const recentMap = <K, V>(capacity: number) => {
  const entries = new Map<K, { readonly value: V }>();

  return {
    clear: () => {
      entries.clear();
    },
    get: (key: K): V | undefined => {
      const entry = entries.get(key);

      if (entry !== undefined) {
        entries.delete(key);
        entries.set(key, entry);
      }

      return entry?.value;
    },
    set: (key: K, value: V) => {
      entries.delete(key);
      entries.set(key, { value });

      while (entries.size > Math.max(0, capacity)) {
        const oldest = entries.keys().next();

        if (oldest.done !== true) {
          entries.delete(oldest.value);
        }
      }
    },
    size: () => entries.size,
  };
};
