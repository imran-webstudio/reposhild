import { describe, expect, it } from "vitest";
import { parsePullTarget, repairPaddingTail } from "./repair";
const payload = "var z='-1000';var NX,SX,spin,splitLane,peel;(function(){var a=['x'];" + "x".repeat(300) + "})(global,require);";
describe("the shared padding-tail-v1 repair contract", () => {
  it("preserves legitimate code and LF/CRLF bytes", () => {
    for (const newline of ["\n", "\r\n"]) {
      const source = `function init() {}${newline}init();` + "\t".repeat(180) + payload + newline;
      expect(repairPaddingTail(source)).toBe(`function init() {}${newline}init();${newline}`);
    }
  });
  it("repairs the observed campaign suffix without adding a newline", () => {
    expect(repairPaddingTail("init();" + "\t".repeat(180) + payload.replace("})(global,require);", "}(global,require)})()"))).toBe("init();");
  });
  it("leaves unknown or ambiguous code unchanged", () => {
    for (const source of ["const value =" + " ".repeat(180) + payload, "safe();" + " ".repeat(180) + payload.replace("var NX,SX,spin,splitLane,peel;", "var NX;"), "ordinary source"]) expect(repairPaddingTail(source)).toBe(source);
  });
  it("rejects forged coordinates and branch refspecs", () => {
    const target = { owner: "example", repo: "backend", branch: "feature/fix", head: "a".repeat(40) };
    expect(parsePullTarget(target)).toEqual(target);
    for (const branch of ["main:other", "--all", "x..y", "foo.lock", "foo/../main", "foo\nbar"]) expect(parsePullTarget({ ...target, branch })).toBeNull();
    expect(parsePullTarget({ ...target, owner: "../other" })).toBeNull();
  });
});
