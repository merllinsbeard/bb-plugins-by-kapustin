import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const resultSchema = z.object({
  answer: z.string().max(50000),
  suggestions: z.array(z.string().trim().min(1).max(500)).max(30),
});
export const hostContract = defineRpcContract({
  run: {
    input: z.object({
      jobId: z.string().uuid(),
      prompt: z.string().max(100000),
      model: z.literal("gpt-6-astra"),
      effort: z.literal("low"),
      mode: z.enum(["expand", "decompose", "help"]),
    }),
    output: resultSchema,
  },
});
export const outputSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    suggestions: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "suggestions"],
  additionalProperties: false,
};
