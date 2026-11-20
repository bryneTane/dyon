/**
 * Shortens text for display and says how much was left out.
 * `keep: "end"` keeps the tail, which is the useful part of command output.
 */
export function clip(text: string, max: number, keep: "start" | "end" = "start"): string {
  if (text.length <= max) return text;
  const marker = `[${(text.length - max).toLocaleString("en-US")} characters omitted]`;
  return keep === "start" ? `${text.slice(0, max)}\n${marker}` : `${marker}\n${text.slice(-max)}`;
}

/** Any value as readable text: strings as they are, everything else as JSON when possible. */
export function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The message of a thrown value, whatever was thrown. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : stringify(error);
}
