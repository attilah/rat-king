import type { Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";

export const defineReadOnlyContract = <
  const Name extends string,
  Input extends Schema.Constraint,
  Output extends Schema.Constraint,
  Failure extends Schema.Constraint,
>(
  name: Name,
  description: string,
  input: Input,
  output: Output,
  failure: Failure
) =>
  Tool.make(name, { description, failure, parameters: input, success: output })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.OpenWorld, false);

export const projectToolkit = Toolkit.make;

export const EmptyInput = Tool.EmptyParams;
