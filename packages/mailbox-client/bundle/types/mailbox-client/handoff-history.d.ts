export declare const HANDOFF_HISTORY_CAPACITY = 2048;
export declare const handoffHistory: () => {
    add: (key: string) => void;
    delete: (key: string) => boolean;
    has: (key: string) => boolean;
    size: () => number;
};
