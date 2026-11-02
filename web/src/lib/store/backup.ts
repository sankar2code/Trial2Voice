// Export / import of everything in IndexedDB as one JSON file, so the
// coordinator view can be shown on another machine (build plan, Phase 4).
//
// Settings and API keys are NOT part of a backup: they live in localStorage
// (see lib/settings), not in Dexie, and this module only reads Dexie tables.
import { z } from "zod";
import { db } from "./db";
import { appendAudit, verifyAuditChain } from "./repo";
import type { AuditEvent } from "../types";

export const BACKUP_FORMAT = "trial2voice-backup";
export const BACKUP_VERSION = 1;

export const TABLES = ["trials", "scripts", "audit", "calls", "referrals", "events", "evalRuns"] as const;
export type TableName = (typeof TABLES)[number];

export class BackupError extends Error {}

// Rows are kept as-is (looseObject); only the key field each table is indexed by is checked.
const row = <S extends z.core.$ZodLooseShape>(shape: S) => z.looseObject(shape);
const tablesSchema = z.object({
  trials: z.array(row({ nctId: z.string().min(1) })),
  scripts: z.array(row({ id: z.string().min(1), nctId: z.string().min(1) })),
  audit: z.array(row({ seq: z.number().int().optional(), hash: z.string().regex(/^[0-9a-f]{64}$/), prevHash: z.string().regex(/^[0-9a-f]{64}$/), at: z.string(), actor: z.string(), type: z.string() })),
  calls: z.array(row({ id: z.string().min(1) })),
  referrals: z.array(row({ id: z.string().min(1) })),
  events: z.array(row({ seq: z.number().int().optional(), at: z.string(), nctId: z.string(), type: z.string() })),
  evalRuns: z.array(row({ id: z.string().min(1) })),
});

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  app: z.object({ dbVersion: z.number() }),
  tables: tablesSchema,
});

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  app: { dbVersion: number };
  tables: Record<TableName, Record<string, unknown>[]>;
};

export async function exportAll(): Promise<Backup> {
  const d = db();
  const tables = {} as Backup["tables"];
  await d.transaction("r", TABLES.map((t) => d.table(t)), async () => {
    for (const t of TABLES) {
      const q = t === "audit" || t === "events" ? d.table(t).orderBy("seq") : d.table(t).toCollection();
      tables[t] = (await q.toArray()) as Record<string, unknown>[];
    }
  });
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), app: { dbVersion: d.verno }, tables };
}

/** Parse and check a backup file. Throws BackupError with a readable message. */
export function validateBackup(json: unknown): Backup {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new BackupError("Not a Trial2Voice backup: the file isn't a JSON object.");
  const o = json as Record<string, unknown>;
  if (o.format !== BACKUP_FORMAT) throw new BackupError(`Not a Trial2Voice backup: expected format "${BACKUP_FORMAT}", got ${o.format === undefined ? "none" : JSON.stringify(o.format)}.`);
  if (o.version !== BACKUP_VERSION) throw new BackupError(`Unsupported backup version ${JSON.stringify(o.version)}; this app reads version ${BACKUP_VERSION}.`);
  const r = backupSchema.safeParse(json);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new BackupError(`Invalid backup file — ${issues.join("; ")}${r.error.issues.length > 3 ? ` (+${r.error.issues.length - 3} more)` : ""}.`);
  }
  if (r.data.app.dbVersion > db().verno) throw new BackupError(`This backup is from a newer app (database v${r.data.app.dbVersion}; this app is v${db().verno}).`);
  return r.data as Backup;
}

export function backupCounts(b: Backup): Record<TableName, number> {
  return Object.fromEntries(TABLES.map((t) => [t, b.tables[t].length])) as Record<TableName, number>;
}

/**
 * Merge plan for the hash-chained audit log. Both chains are compared in seq order:
 * - incoming chain is already a prefix of the local chain → nothing to add (idempotent re-import);
 * - local chain is a prefix of the incoming chain (or empty) → append the new tail, which
 *   chains onto the last local event;
 * - otherwise the chains diverge → refuse, since interleaving them would break the chain.
 */
function planAuditMerge(local: AuditEvent[], incoming: AuditEvent[]): AuditEvent[] {
  let k = 0;
  while (k < local.length && k < incoming.length && local[k].hash === incoming[k].hash) k++;
  if (k === incoming.length) return [];
  if (k === local.length) return incoming.slice(k);
  throw new BackupError(
    `Can't merge: the audit log in this file and the one in this browser are different histories (they diverge at event ${k + 1}). ` +
      "The audit log is a hash chain, so mixing two histories would make it fail verification. " +
      "Use Replace to restore the file's data and audit log as-is, or merge into a browser whose log is a copy of (or empty compared to) the file's.",
  );
}

function withoutSeq<T extends { seq?: unknown }>(r: T): Omit<T, "seq"> {
  const copy = { ...r };
  delete copy.seq;
  return copy;
}

const eventKey = (e: Record<string, unknown>) => JSON.stringify([e.at, e.nctId, e.type, e.callId ?? null, e.embedded ?? null]);

export async function importAll(
  backup: Backup,
  mode: "replace" | "merge",
  actor = "unknown",
): Promise<{ counts: Record<string, number>; auditChainOk: boolean }> {
  const d = db();
  const counts: Record<string, number> = {};
  await d.transaction("rw", TABLES.map((t) => d.table(t)), async () => {
    if (mode === "replace") {
      for (const t of TABLES) await d.table(t).clear();
      for (const t of TABLES) {
        await d.table(t).bulkAdd(structuredClone(backup.tables[t]));
        counts[t] = backup.tables[t].length;
      }
      return;
    }
    for (const t of ["trials", "scripts", "calls", "referrals", "evalRuns"] as const) {
      await d.table(t).bulkPut(structuredClone(backup.tables[t]));
      counts[t] = backup.tables[t].length;
    }
    // Funnel events: local seq numbers mean nothing on another machine, so dedupe by content.
    const have = new Set((await d.events.toArray()).map((e) => eventKey(e as unknown as Record<string, unknown>)));
    const newEvents = backup.tables.events.filter((e) => !have.has(eventKey(e))).map(withoutSeq);
    await d.table("events").bulkAdd(newEvents);
    counts.events = newEvents.length;
    // Audit: append only what extends the local chain (see planAuditMerge).
    const local = await d.audit.orderBy("seq").toArray();
    const incoming = [...(backup.tables.audit as unknown as AuditEvent[])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const tail = planAuditMerge(local, incoming).map(withoutSeq);
    await d.audit.bulkAdd(structuredClone(tail));
    counts.audit = tail.length;
  });
  // Verify the restored log before adding to it, so a tampered file shows up as broken.
  const chain = await verifyAuditChain();
  await appendAudit(actor, "data.imported", { mode, exportedAt: backup.exportedAt, counts, auditChainOk: chain.ok });
  return { counts, auditChainOk: chain.ok };
}
