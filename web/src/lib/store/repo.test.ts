import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Trial2VoiceDB, db, useDatabase } from "./db";
import {
  appendAudit, checkForRegistryChange, lockScript, listVersions, newDraftFrom, saveNewDraft,
  saveTrial, updateDraft, verifyAuditChain, verifyScriptIntegrity, RepoError, simulateRegistryChange, latestRegistryTrial,
} from "./repo";
import { mapStudy } from "../ctgov";
import { splitEligibility } from "../bullets";
import { assembleDraft } from "../script/assemble";
import type { BuilderOutput } from "../script/builder";
import type { Criterion } from "../types";

const raw = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "__fixtures__", "NCT07599982.json"), "utf8"));
const trial = mapStudy(raw, "2026-11-01T00:00:00Z");
const bullets = splitEligibility(trial.eligibilityText);

// A minimal but valid script: every bullet confirmed at site, one asked question.
function output(): BuilderOutput {
  const criteria: Criterion[] = bullets
    .filter((b) => b.id !== "I3")
    .map((b, i) => ({
      id: `${b.kind === "inclusion" ? "IN" : "EX"}-${String(i + 1).padStart(2, "0")}`,
      kind: b.kind, bulletIds: [b.id], sourceText: b.text.split("\n")[0], mode: "confirm_at_site",
      question: { en: "", es: "" }, questionProxy: { en: "", es: "" }, altPhrasings: { en: [], es: [] },
      answerType: null, unit: null, enumOptions: [], rule: null,
      readBackText: { en: "", es: "" }, readBackTextProxy: { en: "", es: "" },
      groupId: null, registryDerived: false, siteCheckNote: "Check at site.",
    }));
  return { criteria, groups: [], glossary: [], derivedBulletIds: { age: ["I3"], sex: [] } };
}

const draftV1 = () => assembleDraft({ trial, bullets, output: output(), version: 1, createdBy: "test" });
const approval = { approver: "Dr. Test", irbRef: "IRB-2026-001", date: "2026-11-01" };

let n = 0;
beforeEach(async () => {
  useDatabase(new Trial2VoiceDB(`test-${++n}`));
  await saveTrial(trial, "tester", "fixture");
});
afterEach(() => vi.unstubAllGlobals());

describe("versions and approval lock", () => {
  test("lock freezes a version and fingerprints it", async () => {
    await saveNewDraft(draftV1(), "tester", "test");
    const locked = await lockScript(`${trial.nctId}-v1`, approval, "tester");
    expect(locked.status).toBe("locked");
    expect(locked.approval?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyScriptIntegrity(locked)).toBe(true);
    await expect(updateDraft(locked.id, (s) => s, "tester")).rejects.toThrow(RepoError);
  });

  test("tampering with a locked script is detected", async () => {
    await saveNewDraft(draftV1(), "tester", "test");
    const locked = await lockScript(`${trial.nctId}-v1`, approval, "tester");
    const tampered = structuredClone(locked);
    tampered.criteria[0].siteCheckNote = "changed silently";
    expect(await verifyScriptIntegrity(tampered)).toBe(false);
  });

  test("approval needs a clean validation", async () => {
    const d = draftV1();
    d.criteria = d.criteria.slice(0, 3); // drops coverage
    await saveNewDraft(d, "tester", "test");
    await expect(lockScript(d.id, approval, "tester")).rejects.toThrow(/error/);
  });

  test("approval needs approver and IRB reference", async () => {
    await saveNewDraft(draftV1(), "tester", "test");
    await expect(lockScript(`${trial.nctId}-v1`, { ...approval, irbRef: " " }, "tester")).rejects.toThrow(/required/);
  });

  test("a new version supersedes the old lock once approved", async () => {
    await saveNewDraft(draftV1(), "tester", "test");
    await lockScript(`${trial.nctId}-v1`, approval, "tester");
    const v2 = await newDraftFrom(`${trial.nctId}-v1`, "tester");
    expect(v2.version).toBe(2);
    expect(v2.basedOn).toBe(`${trial.nctId}-v1`);
    await updateDraft(v2.id, (s) => ({ ...s, confidenceThreshold: 0.85 }), "tester");
    await lockScript(v2.id, approval, "tester");
    const versions = await listVersions(trial.nctId);
    expect(versions.map((v) => [v.version, v.status])).toEqual([[2, "locked"], [1, "superseded"]]);
  });

  test("edits can't change provenance fields", async () => {
    await saveNewDraft(draftV1(), "tester", "test");
    const saved = await updateDraft(`${trial.nctId}-v1`, (s) => ({ ...s, sourceEligibilityText: "hacked", version: 9 }), "tester");
    expect(saved.version).toBe(1);
    expect(saved.sourceEligibilityText).toBe(trial.eligibilityText);
  });
});

describe("audit log", () => {
  test("events form a verifiable hash chain", async () => {
    await appendAudit("tester", "x", { a: 1 });
    await appendAudit("tester", "y", { b: 2 });
    expect((await verifyAuditChain()).ok).toBe(true);
    const second = (await db().audit.orderBy("seq").toArray())[1];
    await db().audit.update(second.seq!, { payload: { b: 3 } });
    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(second.seq);
  });
});

describe("protocol-change watch", () => {
  const stubRegistry = (date: string, text = raw.protocolSection.eligibilityModule.eligibilityCriteria) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      protocolSection: { statusModule: { lastUpdatePostDateStruct: { date }, overallStatus: "RECRUITING" }, eligibilityModule: { eligibilityCriteria: text } },
    }))));

  test("unchanged registry keeps calls running", async () => {
    await saveNewDraft(draftV1(), "tester", "test");
    await lockScript(`${trial.nctId}-v1`, approval, "tester");
    stubRegistry(trial.lastUpdatePostDate);
    expect((await checkForRegistryChange(trial.nctId, "watch")).state).toBe("unchanged");
    expect((await db().trials.get(trial.nctId))!.callsPaused).toBe(false);
  });

  test("a registry update marks the script stale and pauses calls", async () => {
    await saveNewDraft(draftV1(), "tester", "test");
    await lockScript(`${trial.nctId}-v1`, approval, "tester");
    stubRegistry("2026-12-01", "Inclusion Criteria:\n\n1. Something new");
    const r = await checkForRegistryChange(trial.nctId, "watch");
    expect(r).toMatchObject({ state: "changed", eligibilityChanged: true });
    const t = (await db().trials.get(trial.nctId))!;
    expect([t.stale, t.callsPaused, t.latestRegistryUpdate]).toEqual([true, true, "2026-12-01"]);
    expect((await listVersions(trial.nctId))[0].status).toBe("stale");
  });

  test("a stale trial can't lock an out-of-date draft, but a rebased one clears it", async () => {
    await saveNewDraft(draftV1(), "tester", "test");
    await lockScript(`${trial.nctId}-v1`, approval, "tester");
    await simulateRegistryChange(trial.nctId, "tester");

    const old = await newDraftFrom(`${trial.nctId}-v1`, "tester");
    await expect(lockScript(old.id, approval, "tester")).rejects.toThrow(/registry record changed/);

    const latest = await latestRegistryTrial(trial.nctId);
    const rebased = await newDraftFrom(`${trial.nctId}-v1`, "tester", { lastUpdatePostDate: latest.lastUpdatePostDate, eligibilityText: latest.eligibilityText, trial: latest });
    // The simulated change adds a bullet, so coverage fails until it's mapped.
    await expect(lockScript(rebased.id, approval, "tester")).rejects.toThrow(/error/);
    const newBullet = rebased.bullets[rebased.bullets.length - 1];
    await updateDraft(rebased.id, (s) => ({
      ...s,
      criteria: [...s.criteria, { ...s.criteria[s.criteria.length - 1], id: "IN-99", bulletIds: [newBullet.id], sourceText: "Use of any GLP-1 receptor agonist medication in the past 30 days" }],
    }), "tester");
    await lockScript(rebased.id, approval, "tester");
    const t = (await db().trials.get(trial.nctId))!;
    expect([t.stale, t.callsPaused]).toEqual([false, false]);
  });
});
