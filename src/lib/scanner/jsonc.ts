/** Parse VS Code JSON-with-comments without treating comment markers in strings as code. */
export function parseJsonc<T>(source: string): T {
  let out = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quoted) {
      out += c;
      if (c === "\\") out += source[++i] ?? "";
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; out += c; }
    else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
    } else if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " "; i += 1;
      }
      if (i >= source.length) throw new Error("Unclosed comment");
      i += 1; out += " ";
    } else out += c;
  }
  let clean = ""; quoted = false;
  for (let i = 0; i < out.length; i += 1) {
    const c = out[i];
    if (quoted) {
      clean += c;
      if (c === "\\") clean += out[++i] ?? "";
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; clean += c; }
    else if (c === "," && /^\s*[}\]]/.test(out.slice(i + 1))) continue;
    else clean += c;
  }
  return JSON.parse(clean) as T;
}
