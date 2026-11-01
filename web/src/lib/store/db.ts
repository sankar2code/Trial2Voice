// Browser storage (Track A). Track B replaces this module with Postgres behind
// the /api routes; the function signatures in repo.ts stay the same.
import Dexie, { type EntityTable } from "dexie";
import type { AuditEvent, ScriptVersion, Trial } from "../types";

export class Trial2VoiceDB extends Dexie {
  trials!: EntityTable<Trial, "nctId">;
  scripts!: EntityTable<ScriptVersion, "id">;
  audit!: EntityTable<AuditEvent, "seq">;

  constructor(name = "trial2voice") {
    super(name);
    this.version(1).stores({
      trials: "nctId",
      scripts: "id, nctId, [nctId+version], status",
      audit: "++seq, at, nctId, type",
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
