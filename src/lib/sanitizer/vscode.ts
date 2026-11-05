import { parseJsonc } from "@/lib/scanner/jsonc";

function reprint(source: string, value: unknown): string {
  const indentMatch = source.match(/\n(\t| {2}| {4})/);
  const indent = indentMatch?.[1] ?? 2;
  const printed = JSON.stringify(value, null, indent);
  return source.endsWith("\n") ? `${printed}\n` : printed;
}

export function sanitizeVscodeSettings(source: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonc(source);
  } catch {
    return source;
  }
  if (parsed["task.allowAutomaticTasks"] !== "on") return source;
  delete parsed["task.allowAutomaticTasks"];
  return reprint(source, parsed);
}
