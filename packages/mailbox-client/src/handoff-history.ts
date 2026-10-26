export const HANDOFF_HISTORY_CAPACITY = 2048;

export const handoffHistory = () => {
  const keys = new Set<string>();

  const remember = (key: string) => {
    keys.delete(key);
    keys.add(key);

    if (keys.size > HANDOFF_HISTORY_CAPACITY) {
      const oldest = keys.values().next();

      if (oldest.done !== true) {
        keys.delete(oldest.value);
      }
    }
  };

  return {
    add: remember,
    delete: (key: string) => keys.delete(key),
    has: (key: string) => {
      if (!keys.has(key)) {
        return false;
      }

      remember(key);

      return true;
    },
    size: () => keys.size,
  };
};
