// Deterministic pre-pass: split registry eligibility text into top-level
// inclusion / exclusion bullets. Nested sub-items stay inside their parent
// bullet. The script builder then turns each bullet into atomic criteria, and
// the coverage check makes sure every bullet is mapped.
import type { Bullet } from "./types";
import { unescapeRegistry } from "./text";

const LIST_ITEM = /^(\s*)(?:\d+[.)]|[*\-•·]|[a-zA-Z][.)]|[ivxIVX]+[.)])\s+(.*)$/;

function headingKind(line: string): "inclusion" | "exclusion" | null {
  const t = line.trim().replace(/^[#*\s]+|[*\s]+$/g, "");
  if (!t.endsWith(":") || t.length > 250) return null;
  if (/\bexclusion\b/i.test(t)) return "exclusion";
  if (/\binclusion\b/i.test(t)) return "inclusion";
  return null;
}

const indentOf = (line: string) => line.match(/^\s*/)![0].replace(/\t/g, "    ").length;

export function splitEligibility(rawText: string): Bullet[] {
  const lines = unescapeRegistry(rawText).split("\n");
  const bullets: Bullet[] = [];
  const counters = { inclusion: 0, exclusion: 0 };

  let kind: "inclusion" | "exclusion" | null = null;
  let section = "Criteria";
  let baseIndent: number | null = null; // indent of top-level items in this section
  let current: { kind: "inclusion" | "exclusion"; section: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (text) {
      counters[current.kind] += 1;
      const prefix = current.kind === "inclusion" ? "I" : "E";
      bullets.push({
        id: `${prefix}${counters[current.kind]}`,
        kind: current.kind,
        section: current.section,
        text,
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = indentOf(line);
    const item = line.match(LIST_ITEM);

    // Section headings are only recognised outside a deeper nesting level.
    const hk = headingKind(item ? item[2] : line);
    if (hk && (baseIndent === null || indent <= baseIndent)) {
      flush();
      kind = hk;
      section = line.trim().replace(/^[#*\-\s]+/, "").replace(/:$/, "");
      baseIndent = null;
      continue;
    }

    const k = kind ?? "inclusion";
    if (item) {
      if (baseIndent === null) baseIndent = indent;
      if (indent <= baseIndent) {
        flush();
        current = { kind: k, section, lines: [item[2].trim()] };
      } else if (current) {
        current.lines.push(`${"  ".repeat(Math.min(3, Math.ceil((indent - baseIndent) / 3)))}${item[2].trim()}`);
      } else {
        current = { kind: k, section, lines: [item[2].trim()] };
      }
      continue;
    }

    // Plain text line.
    const t = line.trim();
    if (current && baseIndent !== null && indent > baseIndent) {
      current.lines.push(`  ${t}`); // continuation of a nested item
    } else if (t.endsWith(":") && !current) {
      // Intro line such as "Participants must meet the following:" — not a criterion.
      continue;
    } else if (t.endsWith(":") && current) {
      // Intro line between items, e.g. "Females must meet all of:" followed by nested items.
      flush();
      current = { kind: k, section, lines: [t] };
    } else {
      // Paragraph-style criterion (no list marker).
      flush();
      current = { kind: k, section, lines: [t] };
    }
  }
  flush();
  return bullets;
}
