// Trials, script versions, approval lock and audit log.
// Rules enforced here (not just in the UI):
// - Only drafts can be edited. A locked version is frozen; changes need a new version.
// - Locking requires a clean validation and a script built from the current registry record.
// - Every state change writes a hash-chained audit event.
import { db } from "./db";
import { sha256Hex, stableStringify } from "../hash";
import { fetchRegistryVersion, fetchStudy } from "../ctgov";
import { splitEligibility } from "../bullets";
import { withDerivedRows } from "../script/derived";
import { validateScript } from "../script/validate";
import type { Approval, AuditEvent, ScriptVersion, Trial } from "../types";

export class RepoError extends Error {}

// --- Audit log (hash chain) --------------------------------------------------

const GENESIS = "0".repeat(64);
let auditQueue: Promise<unknown> = Promise.resolve();

function auditBody(e: Omit<AuditEvent, "hash" | "seq">) {
  return stableStringify({ at: e.at, actor: e.actor, type: e.type, nctId: e.nctId, payload: e.payload, prevHash: e.prevHash });
}

export function appendAudit(actor: string, type: string, payload: unknown, nctId?: string): Promise<AuditEvent> {
  // Serialized so each event chains to the one before it (single browser tab).
  const run = auditQueue.then(async () => {
    const last = await db().audit.orderBy("seq").last();
    const event: Omit<AuditEvent, "hash" | "seq"> = {
      at: new Date().toISOString(),
      actor,
      type,
      nctId,
      payload,
      prevHash: last?.hash ?? GENESIS,
    };
    const full: AuditEvent = { ...event, hash: await sha256Hex(auditBody(event)) };
    full.seq = await db().audit.add(full);
    return full;
  });
  auditQueue = run.catch(() => undefined);
  return run;
}

export async function verifyAuditChain(): Promise<{ ok: boolean; count: number; brokenAt?: number }> {
  const events = await db().audit.orderBy("seq").toArray();
  let prev = GENESIS;
  for (const e of events) {
    if (e.prevHash !== prev || (await sha256Hex(auditBody(e))) !== e.hash) return { ok: false, count: events.length, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, count: events.length };
}

// --- Script fingerprint ------------------------------------------------------

/** Everything that defines what a caller hears and how answers are scored. */
export function lockedContent(s: ScriptVersion) {
  return stableStringify({
    nctId: s.nctId,
    version: s.version,
    sourceLastUpdate: s.sourceLastUpdate,
    sourceEligibilityText: s.sourceEligibilityText,
    bullets: s.bullets,
    criteria: s.criteria,
    groups: s.groups,
    glossary: s.glossary,
    confidenceThreshold: s.confidenceThreshold,
    stopOnConfirmedFail: s.stopOnConfirmedFail,
    verbatimOnly: s.verbatimOnly,
    approval: s.approval && { approver: s.approval.approver, irbRef: s.approval.irbRef, date: s.approval.date, lockedAt: s.approval.lockedAt },
  });
}

export async function verifyScriptIntegrity(s: ScriptVersion): Promise<boolean> {
  if (!s.approval) return false;
  return (await sha256Hex(lockedContent(s))) === s.approval.sha256;
}

// --- Trials ------------------------------------------------------------------

export async function saveTrial(trial: Trial, actor: string, how: string) {
  const existing = await db().trials.get(trial.nctId);
  await db().trials.put(existing ? { ...trial, stale: existing.stale, callsPaused: existing.callsPaused, latestRegistryUpdate: existing.latestRegistryUpdate, latestEligibilityText: existing.latestEligibilityText } : trial);
  await appendAudit(actor, existing ? "trial.refreshed" : "trial.ingested", { how, lastUpdatePostDate: trial.lastUpdatePostDate }, trial.nctId);
}

export async function ingestTrial(nctId: string, actor: string): Promise<Trial> {
  const trial = await fetchStudy(nctId);
  const existing = await db().trials.get(trial.nctId);
  if (existing) {
    await checkForRegistryChange(trial.nctId, actor);
    return (await db().trials.get(trial.nctId))!;
  }
  await saveTrial(trial, actor, "ClinicalTrials.gov API v2");
  return trial;
}

export async function deleteTrial(nctId: string, actor: string) {
  await db().transaction("rw", db().trials, db().scripts, async () => {
    await db().scripts.where("nctId").equals(nctId).delete();
    await db().trials.delete(nctId);
  });
  await appendAudit(actor, "trial.removed", {}, nctId);
}

// --- Script versions ---------------------------------------------------------

export async function listVersions(nctId: string): Promise<ScriptVersion[]> {
  const all = await db().scripts.where("nctId").equals(nctId).toArray();
  return all.sort((a, b) => b.version - a.version);
}

export async function nextVersion(nctId: string) {
  const v = await listVersions(nctId);
  return (v[0]?.version ?? 0) + 1;
}

/** The version calls would run on: the newest locked one. */
export function activeLocked(versions: ScriptVersion[]) {
  return versions.find((v) => v.status === "locked" || v.status === "stale") ?? null;
}

/** Save a new draft. Any other open draft for the trial is superseded. */
export async function saveNewDraft(draft: ScriptVersion, actor: string, how: string) {
  if (draft.status !== "draft") throw new RepoError("Only drafts can be created this way.");
  await db().transaction("rw", db().scripts, async () => {
    if (await db().scripts.get(draft.id)) throw new RepoError(`${draft.id} already exists.`);
    const open = await db().scripts.where({ nctId: draft.nctId, status: "draft" }).toArray();
    for (const d of open) await db().scripts.update(d.id, { status: "superseded" });
    await db().scripts.add(draft);
  });
  await appendAudit(actor, "script.draft_created", { id: draft.id, how, basedOn: draft.basedOn }, draft.nctId);
}

export async function updateDraft(id: string, mutate: (s: ScriptVersion) => ScriptVersion, actor: string) {
  const current = await db().scripts.get(id);
  if (!current) throw new RepoError(`${id} not found.`);
  if (current.status !== "draft") throw new RepoError(`${id} is ${current.status} and can't be edited. Start a new version.`);
  const next = mutate(structuredClone(current));
  // Identity and provenance fields can't be changed by an edit.
  const safe: ScriptVersion = {
    ...next,
    id: current.id, nctId: current.nctId, version: current.version, createdAt: current.createdAt,
    createdBy: current.createdBy, basedOn: current.basedOn, sourceLastUpdate: current.sourceLastUpdate,
    sourceEligibilityText: current.sourceEligibilityText, bullets: current.bullets, status: "draft", approval: null,
  };
  await db().scripts.put(safe);
  await appendAudit(actor, "script.draft_saved", { id }, current.nctId);
  return safe;
}

/**
 * Start a new draft from an existing version. With `fromRegistry`, the draft is
 * rebased on the newest registry text: bullets are re-split and every
 * criterion is kept, so validation shows what no longer matches.
 */
export async function newDraftFrom(
  sourceId: string,
  actor: string,
  fromRegistry?: { lastUpdatePostDate: string; eligibilityText: string; trial: Trial },
): Promise<ScriptVersion> {
  const src = await db().scripts.get(sourceId);
  if (!src) throw new RepoError(`${sourceId} not found.`);
  const version = await nextVersion(src.nctId);
  const draft: ScriptVersion = {
    ...structuredClone(src),
    id: `${src.nctId}-v${version}`,
    version,
    createdAt: new Date().toISOString(),
    createdBy: "editor",
    basedOn: src.id,
    status: "draft",
    approval: null,
  };
  if (fromRegistry) {
    draft.sourceLastUpdate = fromRegistry.lastUpdatePostDate;
    draft.sourceEligibilityText = fromRegistry.eligibilityText;
    draft.bullets = splitEligibility(fromRegistry.eligibilityText);
    draft.criteria = withDerivedRows(fromRegistry.trial, draft.criteria);
  }
  await saveNewDraft(draft, actor, fromRegistry ? "rebased on registry update" : `copied from v${src.version}`);
  return draft;
}

export async function discardDraft(id: string, actor: string) {
  const s = await db().scripts.get(id);
  if (!s || s.status !== "draft") throw new RepoError("Only drafts can be discarded.");
  await db().scripts.update(id, { status: "superseded" });
  await appendAudit(actor, "script.draft_discarded", { id }, s.nctId);
}

export async function lockScript(id: string, input: Omit<Approval, "sha256" | "lockedAt">, actor: string): Promise<ScriptVersion> {
  const s = await db().scripts.get(id);
  if (!s) throw new RepoError(`${id} not found.`);
  if (s.status !== "draft") throw new RepoError(`${id} is already ${s.status}.`);
  if (!input.approver.trim() || !input.irbRef.trim() || !input.date) throw new RepoError("Approver, IRB reference and approval date are required.");
  const v = validateScript(s);
  if (!v.canApprove) throw new RepoError(`Fix ${v.errors} error(s) before approving.`);
  const trial = await db().trials.get(s.nctId);
  if (trial?.stale && trial.latestRegistryUpdate && trial.latestRegistryUpdate !== s.sourceLastUpdate)
    throw new RepoError("The registry record changed after this draft was built. Start a draft from the latest registry record.");

  const approval: Approval = { ...input, approver: input.approver.trim(), irbRef: input.irbRef.trim(), lockedAt: new Date().toISOString(), sha256: "" };
  const locked: ScriptVersion = { ...s, status: "locked", approval };
  approval.sha256 = await sha256Hex(lockedContent(locked));

  await db().transaction("rw", db().scripts, db().trials, async () => {
    const older = await db().scripts.where("nctId").equals(s.nctId).toArray();
    for (const o of older) if (o.id !== id && (o.status === "locked" || o.status === "stale")) await db().scripts.update(o.id, { status: "superseded" });
    await db().scripts.put(locked);
    if (trial && trial.latestRegistryUpdate === s.sourceLastUpdate)
      await db().trials.update(s.nctId, { stale: false, callsPaused: false, lastUpdatePostDate: s.sourceLastUpdate, eligibilityText: s.sourceEligibilityText });
    else if (trial && !trial.stale) await db().trials.update(s.nctId, { callsPaused: false });
  });
  await appendAudit(actor, "script.locked", { id, approver: approval.approver, irbRef: approval.irbRef, date: approval.date, sha256: approval.sha256 }, s.nctId);
  return locked;
}

// --- Protocol-change watch (runs on admin page load in Track A) --------------

export type ChangeCheck =
  | { state: "unchanged"; lastUpdatePostDate: string }
  | { state: "changed"; lastUpdatePostDate: string; eligibilityChanged: boolean }
  | { state: "error"; message: string };

async function markStale(nctId: string, latest: { lastUpdatePostDate: string; eligibilityText: string }, actor: string, reason: string) {
  const trial = await db().trials.get(nctId);
  if (!trial) return;
  const versions = await listVersions(nctId);
  const locked = activeLocked(versions);
  await db().transaction("rw", db().trials, db().scripts, async () => {
    await db().trials.update(nctId, { stale: true, callsPaused: true, latestRegistryUpdate: latest.lastUpdatePostDate, latestEligibilityText: latest.eligibilityText });
    if (locked?.status === "locked") await db().scripts.update(locked.id, { status: "stale" });
  });
  await appendAudit(actor, "trial.registry_changed", { reason, latestRegistryUpdate: latest.lastUpdatePostDate, scriptMarkedStale: locked?.id ?? null, callsPaused: true }, nctId);
}

export async function checkForRegistryChange(nctId: string, actor: string): Promise<ChangeCheck> {
  const trial = await db().trials.get(nctId);
  if (!trial) return { state: "error", message: "Unknown trial" };
  let latest;
  try {
    latest = await fetchRegistryVersion(nctId);
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : "Registry unreachable" };
  }
  const versions = await listVersions(nctId);
  const baseline = activeLocked(versions)?.sourceLastUpdate ?? trial.lastUpdatePostDate;
  // A script rebased on a simulated change can't be compared with the real registry.
  if (baseline.endsWith("(simulated)")) return { state: "unchanged", lastUpdatePostDate: baseline };
  if (latest.lastUpdatePostDate === baseline) {
    if (trial.stale && trial.latestRegistryUpdate === undefined) await db().trials.update(nctId, { stale: false });
    return { state: "unchanged", lastUpdatePostDate: latest.lastUpdatePostDate };
  }
  if (trial.stale && trial.latestRegistryUpdate === latest.lastUpdatePostDate)
    return { state: "changed", lastUpdatePostDate: latest.lastUpdatePostDate, eligibilityChanged: latest.eligibilityText !== trial.eligibilityText };
  await markStale(nctId, latest, actor, "Registry last-update date differs from the script's source date");
  return { state: "changed", lastUpdatePostDate: latest.lastUpdatePostDate, eligibilityChanged: latest.eligibilityText !== trial.eligibilityText };
}

/** Demo only: pretend the registry record changed, to show the stale flow. */
export async function simulateRegistryChange(nctId: string, actor: string) {
  const trial = await db().trials.get(nctId);
  if (!trial) throw new RepoError("Unknown trial");
  const today = new Date().toISOString().slice(0, 10);
  const text = `${trial.eligibilityText}\n* Simulated change (demo): Use of any GLP-1 receptor agonist medication in the past 30 days`;
  await markStale(nctId, { lastUpdatePostDate: `${today} (simulated)`, eligibilityText: text }, actor, "Simulated registry change (demo)");
}

/** Re-fetch the full record so a rebased draft gets fresh structured fields. */
export async function latestRegistryTrial(nctId: string): Promise<Trial> {
  const trial = await db().trials.get(nctId);
  if (!trial) throw new RepoError("Unknown trial");
  if (trial.latestRegistryUpdate?.endsWith("(simulated)")) {
    return { ...trial, lastUpdatePostDate: trial.latestRegistryUpdate, eligibilityText: trial.latestEligibilityText ?? trial.eligibilityText };
  }
  const fresh = await fetchStudy(nctId);
  return { ...fresh, stale: trial.stale, callsPaused: trial.callsPaused, latestRegistryUpdate: trial.latestRegistryUpdate, latestEligibilityText: trial.latestEligibilityText };
}

// --- Calls -------------------------------------------------------------------

export async function saveCall(call: import("../call/types").CallRecord) {
  await db().calls.put(structuredClone(call));
  if (call.status !== "in_progress")
    await appendAudit("call agent", "call.ended", { callId: call.id, status: call.status, decision: call.decision ?? null, scriptVersionId: call.scriptVersionId }, call.nctId);
}

// --- Funnel events -----------------------------------------------------------

export async function logEvent(e: Omit<import("./db").AppEvent, "seq" | "at">) {
  try {
    await db().events.add({ ...e, at: new Date().toISOString() });
  } catch {
    /* analytics must never break a call */
  }
}
