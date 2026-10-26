import { beforeEach, describe, expect, it, vi } from "vitest";
import { rememberUser, readScan, recordRemediation } from "@/lib/persistence/history";
import type { RemediationResult } from "@/lib/scanner/types";
const { db } = vi.hoisted(() => ({ db: {
  user: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  scan: { findFirst: vi.fn() }, scanRepo: { findFirst: vi.fn() },
  remediation: { create: vi.fn() }, $transaction: vi.fn(),
} }));
vi.mock("@/lib/db", () => ({ getPrisma: () => db }));
vi.mock("@/lib/activity", () => ({ recordActivity: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); db.$transaction.mockImplementation((fn) => fn(db)); });
describe("identity and pending cleanup safety", () => {
  it("upserts by GitHub ID, retaining the same account after a rename", async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: "old-user" }).mockResolvedValueOnce(null);
    await rememberUser({ githubId: "123", login: "renamed" });
    expect(db.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { githubId: "123" }, update: expect.objectContaining({ login: "renamed" }) }));
  });
  it("does not grant a reused username access to the old owner's data", async () => {
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "previous-owner", githubId: "456" });
    await rememberUser({ githubId: "123", login: "reused" });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "previous-owner" }, data: { login: "retired:previous-owner" } });
    expect(db.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { githubId: "123" } }));
  });
  it("refuses to associate history without an immutable identity", async () => {
    expect(await rememberUser({ login: "legacy" })).toBeNull(); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("authorizes saved scans using the GitHub ID", async () => {
    db.scan.findFirst.mockResolvedValue(null); await readScan("123", "scan-id");
    expect(db.scan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "scan-id", user: { githubId: "123" } } }));
  });
  it("records an opened PR without modifying findings or file snapshots", async () => {
    db.user.findUnique.mockResolvedValue({ id: "user" });
    await recordRemediation("123", "scan", { mode: "pr", owner: "owner", name: "demo", changes: [] } as unknown as RemediationResult);
    expect(db.remediation.create).toHaveBeenCalled(); expect(db.scanRepo.findFirst).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
});
