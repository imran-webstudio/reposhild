import { isGitignoreCloak } from "@/lib/scanner/patterns";

export function sanitizeGitignore(source: string): string {
  const crlf = source.includes("\r\n");
  const normalized = crlf ? source.replace(/\r\n/g, "\n") : source;
  const endsWithNewline = normalized.endsWith("\n");
  const kept = normalized
    .split("\n")
    .filter((line, index, all) => {
      if (index === all.length - 1 && line === "") return true;
      return !isGitignoreCloak(line);
    });
  let result = kept.join("\n");
  if (endsWithNewline && !result.endsWith("\n")) result += "\n";
  return crlf ? result.replace(/\n/g, "\r\n") : result;
}
