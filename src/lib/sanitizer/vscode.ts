import { parseJsonc } from "@/lib/scanner/jsonc";

function reprint(source: string, value: unknown): string {
  const indentMatch = source.match(/\n(\t| {2}| {4})/);
  const indent = indentMatch?.[1] ?? 2;
  const printed = JSON.stringify(value, null, indent);
  return source.endsWith("\n") ? `${printed}\n` : printed;
}

export function sanitizeVscodeTasks(source: string): string {
  let parsed: { tasks?: Array<{ runOn?: string; runOptions?: { runOn?: string } }> };
  try {
    parsed = parseJsonc(source);
  } catch {
    return source;
  }
  if (!Array.isArray(parsed.tasks)) return source;
  const tasks = parsed.tasks.filter((task) => task?.runOptions?.runOn !== "folderOpen" && task?.runOn !== "folderOpen");
  if (tasks.length === parsed.tasks.length) return source;
  parsed.tasks = tasks;
  return reprint(source, parsed);
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
