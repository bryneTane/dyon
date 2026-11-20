// Every request body is checked here before use. Agent, model and effort are checked again against the
// catalog the agents report (isValidSpec), which is only known at runtime.
import { z } from "zod";
import { MAX_COMPETITORS, VENDORS } from "./catalog";

export const MAX_PROMPT = 20_000;
export const MAX_CHECK = 5_000;

const prompt = z
  .string()
  .trim()
  .min(1, "Type a task first.")
  .max(MAX_PROMPT, `A task is at most ${MAX_PROMPT.toLocaleString("en-US")} characters.`);

const competitor = z.strictObject({
  vendor: z.enum(VENDORS),
  model: z.string().min(1).max(200),
  effort: z.string().min(1).max(50).nullable(),
});

/** The user's own API keys (bring your own keys). Never stored in clear, never returned by the API. */
const apiKey = z.string().trim().min(1).max(500).optional();
export const userKeysSchema = z.strictObject({ anthropic: apiKey, openai: apiKey });
export type UserKeys = z.infer<typeof userKeysSchema>;

export const createSchema = z.strictObject({
  prompt,
  keys: userKeysSchema.default({}),
  competitors: z
    .array(competitor)
    .min(1, "Pick at least one agent.")
    .max(MAX_COMPETITORS, `At most ${MAX_COMPETITORS} competitors.`),
  repeats: z.union([z.literal(1), z.literal(3), z.literal(5)]).default(1),
  check: z
    .string()
    .trim()
    .max(MAX_CHECK, `A check command is at most ${MAX_CHECK} characters.`)
    .nullable()
    .default(null)
    .transform((value) => value || null),
  blind: z.boolean().default(false),
});

export const followUpSchema = z.strictObject({ prompt, keys: userKeysSchema.default({}) });

export const verdictSchema = z.strictObject({
  winner: z.string().min(1).max(20),
  note: z.string().trim().max(2000, "A note is at most 2,000 characters.").default(""),
});

export type CreateBody = z.infer<typeof createSchema>;

/** The first problem, as a sentence the user can act on. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request.";
  const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return issue.message.endsWith(".") ? `${where}${issue.message}` : `${where}${issue.message}.`;
}
