// @effect-diagnostics nodeBuiltinImport:off -- The ancestry port reads /proc or ps synchronously at the host boundary.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type ParentOf = (pid: number) => number | null;

const ANCESTOR_LIMIT = 64;

const positive = (value: number) =>
  Number.isInteger(value) && value > 0 ? value : null;

export const parentFromStat = (stat: string) => {
  const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");

  return positive(Number(rest[1]));
};

export const parentFromPs = (output: string) => positive(Number(output.trim()));

export const parentOfProcess: ParentOf = (pid) => {
  try {
    return parentFromStat(readFileSync(`/proc/${pid}/stat`, "utf-8"));
  } catch {
    try {
      return parentFromPs(
        execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 2000,
        })
      );
    } catch {
      return null;
    }
  }
};

export const ancestorsOf = (pid: number, parentOf: ParentOf) => {
  const chain: number[] = [];
  let next = parentOf(pid);

  while (
    next !== null &&
    !chain.includes(next) &&
    chain.length < ANCESTOR_LIMIT
  ) {
    chain.push(next);
    next = parentOf(next);
  }

  return chain;
};
