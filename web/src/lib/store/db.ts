// Browser storage (Track A). Track B replaces this module with Postgres behind
// the /api routes; the function signatures in repo.ts stay the same.
import Dexie, { type EntityTable } from "dexie";
import type { AuditEvent, ScriptVersion, Trial } from "../types";
import type { CallRecord } from "../call/types";
import type { Referral } from "./referrals";

/** Lightweight funnel events (PRD §12). No PHI: trial, type, time, call id. */
export type AppEvent = { seq?: number; at: string; nctId: string; type: "call_page_opened" | "call_started"; callId?: string; embedded?: boolean };

/** A stored eval run (simulated callers), for comparing releases (PRD §9). */
export type EvalRunRecord = { id: string; at: string; interpreter: string; trials: string[]; summary: unknown; results: unknown[] };

export class Trial2VoiceDB extends Dexie {
  trials!: EntityTable<Trial, "nctId">;
  scripts!: EntityTable<ScriptVersion, "id">;
  audit!: EntityTable<AuditEvent, "seq">;
  calls!: EntityTable<CallRecord, "id">;
  referrals!: EntityTable<Referral, "id">;
  events!: EntityTable<AppEvent, "seq">;
  evalRuns!: EntityTable<EvalRunRecord, "id">;

  constructor(name = "trial2voice") {
    super(name);
    this.version(1).stores({
      trials: "nctId",
      scripts: "id, nctId, [nctId+version], status",
      audit: "++seq, at, nctId, type",
    });
    this.version(2).stores({
      calls: "id, nctId, startedAt, status",
    });
    this.version(3).stores({
      referrals: "id, nctId, createdAt",
    });
    this.version(4).stores({
      events: "++seq, nctId, type, at",
      evalRuns: "id, at",
    });
  }
}

let instance: Trial2VoiceDB | null = null;
export function db(): Trial2VoiceDB {
  if (!instance) instance = new Trial2VoiceDB();
  return instance;
}

/** Tests only. */
export function useDatabase(d: Trial2VoiceDB) {
  instance = d;
}
