import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { Trial2VoiceDB, db, useDatabase as setDatabase } from "./db";
import { appendAudit, verifyAuditChain } from "./repo";
import { BackupError, exportAll, importAll, validateBackup, type Backup } from "./backup";

let n = 0;
const fresh = () => setDatabase(new Trial2VoiceDB(`backup-test-${++n}`));

async function seed() {
  await db().trials.put({ nctId: "NCT00000001", title: "Demo trial" } as never);
  await db().scripts.put({ id: "NCT00000001-v1", nctId: "NCT00000001", version: 1, status: "draft" } as never);
  await db().calls.put({ id: "call-1", nctId: "NCT00000001", startedAt: "2026-11-01T00:00:00Z", status: "completed", transcript: [] } as never);
  await db().referrals.put({ id: "ref-1", nctId: "NCT00000001", createdAt: "2026-11-01T00:00:00Z" } as never);
  await db().events.add({ at: "2026-11-01T00:00:00Z", nctId: "NCT00000001", type: "call_started", callId: "call-1" });
  await db().evalRuns.put({ id: "eval-1", at: "2026-11-01T00:00:00Z", interpreter: "keyword", trials: [], summary: {}, results: [] });
  await appendAudit("tester", "trial.ingested", { how: "test" }, "NCT00000001");
  await appendAudit("tester", "script.draft_created", { id: "NCT00000001-v1" }, "NCT00000001");
}

// Simulate writing the file and reading it back.
const viaJson = (b: Backup) => validateBackup(JSON.parse(JSON.stringify(b)));

beforeEach(fresh);

describe("export / import", () => {
  test("round-trip: export, then replace-import into a fresh database", async () => {
    await seed();
    const backup = viaJson(await exportAll());
    expect(backup.format).toBe("trial2voice-backup");
    expect(backup.tables.audit).toHaveLength(2);

    fresh();
    const r = await importAll(backup, "replace", "importer");
    expect(r.auditChainOk).toBe(true);
    expect(r.counts).toMatchObject({ trials: 1, scripts: 1, audit: 2, calls: 1, referrals: 1, events: 1, evalRuns: 1 });
    expect(await db().calls.get("call-1")).toMatchObject({ status: "completed" });
    const audit = await db().audit.orderBy("seq").toArray();
    expect(audit.map((e) => e.type)).toEqual(["trial.ingested", "script.draft_created", "data.imported"]);
    expect(audit[2].actor).toBe("importer");
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  test("replace clears rows that aren't in the file", async () => {
    await seed();
    const backup = viaJson(await exportAll());
    await db().trials.put({ nctId: "NCT99999999" } as never);
    await importAll(backup, "replace");
    expect(await db().trials.get("NCT99999999")).toBeUndefined();
  });

  test("merge is idempotent and keeps the audit chain valid", async () => {
    await seed();
    const backup = viaJson(await exportAll());
    fresh();
    const first = await importAll(backup, "merge");
    expect(first.counts.audit).toBe(2);
    const second = await importAll(backup, "merge");
    expect(second.counts.audit).toBe(0);
    expect(second.counts.events).toBe(0);
    expect(second.auditChainOk).toBe(true);
    expect(await db().trials.count()).toBe(1);
    expect(await db().events.count()).toBe(1);
    // 2 restored + 2 "data.imported"
    expect((await db().audit.toArray()).map((e) => e.type)).toEqual(["trial.ingested", "script.draft_created", "data.imported", "data.imported"]);
  });

  test("merge appends an audit tail that extends the local chain", async () => {
    await seed();
    const machineA = db();
    const fromA = viaJson(await exportAll());
    // Machine B restores A's file, does more work, and exports.
    fresh();
    await importAll(fromA, "replace", "coordinator B");
    await appendAudit("coordinator B", "referral.updated", {}, "NCT00000001");
    const fromB = viaJson(await exportAll());
    // Back on A: B's log starts with A's, so its tail is appended.
    setDatabase(machineA);
    const r = await importAll(fromB, "merge", "coordinator A");
    expect(r.counts.audit).toBe(2);
    expect(r.auditChainOk).toBe(true);
    expect((await db().audit.orderBy("seq").toArray()).map((e) => e.type)).toEqual([
      "trial.ingested", "script.draft_created", "data.imported", "referral.updated", "data.imported",
    ]);
  });

  test("merge refuses an audit log with a different history", async () => {
    await seed();
    const backup = viaJson(await exportAll());
    fresh();
    await appendAudit("someone else", "trial.ingested", {}, "NCT00000002");
    await expect(importAll(backup, "merge")).rejects.toThrow(/different histories/);
    // Nothing was written.
    expect(await db().trials.count()).toBe(0);
    expect(await db().audit.count()).toBe(1);
  });

  test("a tampered audit event is detected after import", async () => {
    await seed();
    const backup = viaJson(await exportAll());
    (backup.tables.audit[0].payload as Record<string, unknown>).how = "edited by hand";
    fresh();
    const r = await importAll(backup, "replace");
    expect(r.auditChainOk).toBe(false);
  });
});

describe("validateBackup", () => {
  const good = async () => JSON.parse(JSON.stringify(await exportAll()));

  test("rejects non-backups with clear messages", async () => {
    expect(() => validateBackup("hello")).toThrow(/isn't a JSON object/);
    expect(() => validateBackup([])).toThrow(BackupError);
    expect(() => validateBackup({ format: "something-else" })).toThrow(/expected format "trial2voice-backup"/);
    expect(() => validateBackup({ format: "trial2voice-backup", version: 2 })).toThrow(/Unsupported backup version 2/);
  });

  test("rejects missing tables and rows without their key field", async () => {
    const noTable = await good();
    delete noTable.tables.calls;
    expect(() => validateBackup(noTable)).toThrow(/tables\.calls/);

    const badRow = await good();
    badRow.tables.trials = [{ title: "no id" }];
    expect(() => validateBackup(badRow)).toThrow(/tables\.trials\.0\.nctId/);

    const notArray = await good();
    notArray.tables.audit = {};
    expect(() => validateBackup(notArray)).toThrow(/tables\.audit/);
  });
});
