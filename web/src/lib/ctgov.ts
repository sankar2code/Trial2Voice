// ClinicalTrials.gov API v2 client. The API sends `Access-Control-Allow-Origin: *`,
// so this runs straight from the browser.
import type { Location, Trial } from "./types";
import { unescapeRegistry } from "./text";

const API = "https://clinicaltrials.gov/api/v2/studies";

export const NCT_ID = /^NCT\d{8}$/;

export class RegistryError extends Error {}

/** "18 Years" → 18, "6 Months" → 0.5, "N/A" / undefined → undefined */
export function parseAgeYears(age: string | undefined): number | undefined {
  if (!age) return undefined;
  const m = age.trim().match(/^(\d+(?:\.\d+)?)\s*(year|month|week|day|hour|minute)s?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const perYear: Record<string, number> = {
    year: 1,
    month: 12,
    week: 52.1775,
    day: 365.25,
    hour: 8766,
    minute: 525960,
  };
  return Math.round((n / perYear[unit]) * 100) / 100;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- raw registry JSON */
export function mapStudy(raw: any, fetchedAt = new Date().toISOString()): Trial {
  const p = raw?.protocolSection;
  if (!p) throw new RegistryError("Unexpected response: no protocolSection");
  const id = p.identificationModule;
  const status = p.statusModule;
  const elig = p.eligibilityModule ?? {};
  const locs: any[] = p.contactsLocationsModule?.locations ?? [];

  const locations: Location[] = locs.map((l) => ({
    facility: l.facility ?? "Unnamed site",
    city: l.city ?? "",
    state: l.state ?? "",
    zip: l.zip,
    country: l.country ?? "",
    status: l.status ?? "UNKNOWN",
    phone: l.contacts?.find((c: any) => c.phone)?.phone,
    lat: l.geoPoint?.lat,
    lon: l.geoPoint?.lon,
  }));

  return {
    nctId: id.nctId,
    briefTitle: id.briefTitle,
    shortName: id.acronym || id.briefTitle,
    overallStatus: status.overallStatus,
    lastUpdatePostDate: status.lastUpdatePostDateStruct?.date ?? "",
    minAgeYears: parseAgeYears(elig.minimumAge),
    maxAgeYears: parseAgeYears(elig.maximumAge),
    sex: elig.sex === "FEMALE" || elig.sex === "MALE" ? elig.sex : "ALL",
    genderBased: Boolean(elig.genderBased),
    genderDescription: elig.genderDescription,
    healthyVolunteers: Boolean(elig.healthyVolunteers),
    eligibilityText: unescapeRegistry(elig.eligibilityCriteria ?? ""),
    locations,
    fetchedAt,
    stale: false,
    callsPaused: false,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fetchStudy(nctIdInput: string, signal?: AbortSignal): Promise<Trial> {
  const nctId = nctIdInput.trim().toUpperCase();
  if (!NCT_ID.test(nctId)) throw new RegistryError(`"${nctIdInput}" isn't an NCT ID (NCT + 8 digits).`);
  const res = await fetch(`${API}/${nctId}`, { signal });
  if (res.status === 404) throw new RegistryError(`${nctId} wasn't found on ClinicalTrials.gov.`);
  if (!res.ok) throw new RegistryError(`ClinicalTrials.gov returned ${res.status}.`);
  const trial = mapStudy(await res.json());
  if (!trial.eligibilityText.trim()) throw new RegistryError(`${nctId} has no eligibility criteria text.`);
  return trial;
}

/** Light check used by the protocol-change watch: only the fields we compare. */
export async function fetchRegistryVersion(
  nctId: string,
): Promise<{ lastUpdatePostDate: string; eligibilityText: string; overallStatus: string }> {
  const fields = "LastUpdatePostDate,EligibilityCriteria,OverallStatus";
  const res = await fetch(`${API}/${nctId}?fields=${fields}`);
  if (!res.ok) throw new RegistryError(`ClinicalTrials.gov returned ${res.status}.`);
  const raw = await res.json();
  const p = raw.protocolSection;
  return {
    lastUpdatePostDate: p.statusModule?.lastUpdatePostDateStruct?.date ?? "",
    eligibilityText: unescapeRegistry(p.eligibilityModule?.eligibilityCriteria ?? ""),
    overallStatus: p.statusModule?.overallStatus ?? "",
  };
}
