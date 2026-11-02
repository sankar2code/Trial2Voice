// Nearest recruiting site from a ZIP code (PRD §4 P1). Zippopotam.us turns a
// US ZIP into a point (it allows browser requests); the study's own location
// list gives the sites. The ZIP itself is never stored.
import type { Location, Trial } from "./types";

export type SiteMatch = { facility: string; city: string; state: string; phone?: string; miles?: number };

export async function zipToPoint(zip: string, signal?: AbortSignal): Promise<{ lat: number; lon: number; state: string } | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { places?: { latitude: string; longitude: string; state: string }[] };
    const p = body.places?.[0];
    return p ? { lat: Number(p.latitude), lon: Number(p.longitude), state: p.state } : null;
  } catch {
    return null;
  }
}

export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const toMatch = (l: Location, miles?: number): SiteMatch => ({ facility: l.facility, city: l.city, state: l.state, phone: l.phone, miles: miles === undefined ? undefined : Math.round(miles) });

/** Closest recruiting site to a point; falls back to any site in the same state, then the first recruiting site. */
export function nearestTo(trial: Trial, point: { lat: number; lon: number; state?: string }): SiteMatch | null {
  const recruiting = trial.locations.filter((l) => l.status === "RECRUITING");
  const pool = recruiting.length ? recruiting : trial.locations;
  if (!pool.length) return null;
  const withGeo = pool.filter((l) => l.lat !== undefined && l.lon !== undefined);
  if (withGeo.length) {
    const best = withGeo.map((l) => ({ l, d: milesBetween(point, { lat: l.lat!, lon: l.lon! }) })).sort((a, b) => a.d - b.d)[0];
    return toMatch(best.l, best.d);
  }
  const sameState = point.state ? pool.find((l) => l.state.toLowerCase() === point.state!.toLowerCase()) : undefined;
  return toMatch(sameState ?? pool[0]);
}

export async function nearestSiteForZip(trial: Trial, zip: string, signal?: AbortSignal): Promise<SiteMatch | null> {
  const point = await zipToPoint(zip, signal);
  return point ? nearestTo(trial, point) : null;
}
