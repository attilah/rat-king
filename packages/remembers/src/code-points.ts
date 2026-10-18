export const codePoints = (text: string): string[] => [
  ...text[Symbol.iterator](),
];
