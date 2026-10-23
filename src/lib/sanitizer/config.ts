import { editConfigLine } from "@/lib/scanner/patterns";

/**
 * Remove tail-appended or padding-hidden payload lines from a config module.
 * A clean file is returned unchanged.
 */
export function sanitizeConfigSource(source: string): string {
  const crlf = source.includes("\r\n");
  const normalized = crlf ? source.replace(/\r\n/g, "\n") : source;
  const endsWithNewline = normalized.endsWith("\n");
  const rawLines = normalized.split("\n");
  if (endsWithNewline) rawLines.pop();

  const kept: string[] = [];
  for (const line of rawLines) {
    const edit = editConfigLine(line);
    if (edit.kind === "drop") continue;
    kept.push(edit.kind === "trim" ? edit.text : line);
  }

  const changed = kept.length !== rawLines.length || kept.some((line, index) => line !== rawLines[index]);
  if (changed) {
    while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") kept.pop();
  }

  let result = kept.join("\n");
  if ((endsWithNewline || changed) && result.length > 0) result += "\n";
  return crlf ? result.replace(/\n/g, "\r\n") : result;
}
