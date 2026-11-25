export type MetricKey =
  | "orderClarity"
  | "counterReadiness"
  | "assemblyDepth"
  | "timerTension"
  | "platingQuality"
  | "audioFeedback";

export type KitchenMetrics = Record<MetricKey, number>;

export interface SnapshotItem {
  id: string;
  name: string;
  category: string;
  station: string;
  prepSeconds: number;
  complexity: number;
  status: string;
  tags: string[];
  notes: string;
  metrics: KitchenMetrics;
}

export interface Snapshot {
  version: string;
  generatedAt: string;
  kitchen: string;
  seed: string;
  items: SnapshotItem[];
  meta: Record<string, string | number | boolean>;
}

export interface RadarAxis {
  key: MetricKey;
  label: string;
  weight: number;
  average: number;
  leaderId: string;
  leaderScore: number;
}

export interface RankedItem {
  rank: number;
  id: string;
  name: string;
  category: string;
  station: string;
  score: number;
  tier: "S" | "A" | "B" | "C";
  prepSeconds: number;
  complexity: number;
  status: string;
  tags: string[];
  metrics: KitchenMetrics;
  strengths: string[];
  risks: string[];
}

export interface RadarModel {
  version: string;
  generatedAt: string;
  kitchen: string;
  seed: string;
  totalItems: number;
  meanScore: number;
  medianScore: number;
  spread: number;
  axes: RadarAxis[];
  ranked: RankedItem[];
  items: RankedItem[];
  topPick: RankedItem | null;
  summary: string;
  fingerprint: string;
}

export interface BoardTicket {
  ticketId: string;
  rank: number;
  itemId: string;
  dish: string;
  station: string;
  priority: "RUSH" | "STANDARD" | "HOLD";
  targetSeconds: number;
  score: number;
  status: string;
  checklist: string[];
}

export interface BoardIssue {
  issueId: string;
  version: string;
  generatedAt: string;
  kitchen: string;
  title: string;
  headline: string;
  status: "READY" | "WATCH" | "EMPTY";
  overallScore: number;
  totalDishes: number;
  topDish: string;
  axes: RadarAxis[];
  rankings: RankedItem[];
  tickets: BoardTicket[];
  alerts: string[];
  highlights: string[];
  summary: string;
  fingerprint: string;
  markdown: string;
}

export interface DataScriptOptions {
  globalName?: string;
  id?: string;
  format?: "global" | "json";
}

const MODEL_VERSION = "1.0.0";
const DEFAULT_EPOCH = "2026-11-25T01:37:00Z";
const DEFAULT_KITCHEN = "Copper & Ember Bistro";
const DEFAULT_SEED = "best-cooking-game-20261125-0137";

const AXIS_DEFS: ReadonlyArray<{ key: MetricKey; label: string; weight: number }> = [
  { key: "orderClarity", label: "Order Board Clarity", weight: 0.2 },
  { key: "counterReadiness", label: "Counter Prep Flow", weight: 0.18 },
  { key: "assemblyDepth", label: "Mid-Assembly Tactility", weight: 0.2 },
  { key: "timerTension", label: "Timer Pacing", weight: 0.16 },
  { key: "platingQuality", label: "Plating Polish", weight: 0.16 },
  { key: "audioFeedback", label: "Kitchen Audio Juice", weight: 0.1 },
];

const METRIC_LABELS: Record<MetricKey, string> = {
  orderClarity: "Order Board Clarity",
  counterReadiness: "Counter Prep Flow",
  assemblyDepth: "Mid-Assembly Tactility",
  timerTension: "Timer Pacing",
  platingQuality: "Plating Polish",
  audioFeedback: "Kitchen Audio Juice",
};

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function toRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function toStr(v: unknown, fallback: string): string {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : fallback;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function toNum(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function slugify(input: string, fallback: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : fallback;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object" && value !== null) {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(rec).sort(cmpStr);
    for (const k of keys) {
      if (rec[k] !== undefined) out[k] = canonicalValue(rec[k]);
    }
    return out;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function escapeScriptJson(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function deriveMetric(seedKey: string, axis: MetricKey, baseScore: number | null): number {
  const hex = fnv1aHex(`${seedKey}:${axis}`);
  const offset = (parseInt(hex.slice(0, 4), 16) % 19) - 9;
  const center = baseScore !== null ? baseScore : 78;
  return round(clamp(center + offset * 0.65, 45, 98), 2);
}

function normalizeMetrics(raw: unknown, seedKey: string, baseScore: number | null): KitchenMetrics {
  const rec = toRecord(raw);
  const out = {} as KitchenMetrics;
  for (const def of AXIS_DEFS) {
    const direct = rec ? rec[def.key] : undefined;
    const val = direct !== undefined
      ? clamp(toNum(direct, deriveMetric(seedKey, def.key, baseScore)), 0, 100)
      : deriveMetric(seedKey, def.key, baseScore);
    out[def.key] = round(val, 2);
  }
  return out;
}

function defaultSnapshotItems(): SnapshotItem[] {
  return [
    {
      id: "ember-herb-flatbread",
      name: "Ember Herb Flatbread",
      category: "hearth",
      station: "Hearth Deck",
      prepSeconds: 42,
      complexity: 3,
      status: "ready",
      tags: ["plated", "crispy", "signature"],
      notes: "Blistered dough brushed with rosemary oil, plated hot on the pass.",
      metrics: {
        orderClarity: 93,
        counterReadiness: 91,
        assemblyDepth: 89,
        timerTension: 88,
        platingQuality: 95,
        audioFeedback: 90,
      },
    },
    {
      id: "saffron-miso-broth",
      name: "Saffron Miso Broth Bowl",
      category: "simmer",
      station: "Kettle Range",
      prepSeconds: 50,
      complexity: 4,
      status: "assembling",
      tags: ["mid-assembly", "ladled", "aromatic"],
      notes: "Hand-cut noodles layered with charred scallion and golden broth.",
      metrics: {
        orderClarity: 90,
        counterReadiness: 88,
        assemblyDepth: 94,
        timerTension: 91,
        platingQuality: 89,
        audioFeedback: 87,
      },
    },
    {
      id: "citrus-char-skewer",
      name: "Citrus Char Skewer",
      category: "grill",
      station: "Coal Grill",
      prepSeconds: 36,
      complexity: 2,
      status: "queued",
      tags: ["fast-fire", "glaze", "rush"],
      notes: "Skewered market peppers and glazed mushrooms over live embers.",
      metrics: {
        orderClarity: 88,
        counterReadiness: 92,
        assemblyDepth: 83,
        timerTension: 90,
        platingQuality: 85,
        audioFeedback: 92,
      },
    },
    {
      id: "buckwheat-egg-galette",
      name: "Buckwheat Crackle Galette",
      category: "griddle",
      station: "Iron Griddle",
      prepSeconds: 46,
      complexity: 3,
      status: "queued",
      tags: ["folded", "savory", "golden"],
      notes: "Crisp folded crepe with caramelized leek and soft-set yolk.",
      metrics: {
        orderClarity: 86,
        counterReadiness: 85,
        assemblyDepth: 88,
        timerTension: 84,
        platingQuality: 88,
        audioFeedback: 84,
      },
    },
    {
      id: "ginger-steam-dumplings",
      name: "Ginger Steam Dumplings",
      category: "steam",
      station: "Bamboo Steamer",
      prepSeconds: 54,
      complexity: 4,
      status: "queued",
      tags: ["pleated", "chili-oil", "delicate"],
      notes: "Hand-pleated parcels finished with toasted sesame and ginger oil.",
      metrics: {
        orderClarity: 84,
        counterReadiness: 82,
        assemblyDepth: 90,
        timerTension: 86,
        platingQuality: 87,
        audioFeedback: 82,
      },
    },
    {
      id: "roasted-fig-tartlet",
      name: "Roasted Fig Honey Tartlet",
      category: "pastry",
      station: "Cold Pass",
      prepSeconds: 38,
      complexity: 2,
      status: "ready",
      tags: ["dessert", "glazed", "garnish"],
      notes: "Flaky tart shell filled with thyme mascarpone and roasted figs.",
      metrics: {
        orderClarity: 87,
        counterReadiness: 89,
        assemblyDepth: 81,
        timerTension: 80,
        platingQuality: 92,
        audioFeedback: 79,
      },
    },
  ];
}

function normalizeItem(raw: unknown, idx: number, seed: string): SnapshotItem {
  const rec = toRecord(raw) ?? {};
  const name = toStr(rec.name ?? rec.title ?? rec.dish, `Kitchen Dish ${idx + 1}`);
  const id = slugify(toStr(rec.id, name), `dish-${idx + 1}`);
  const rawScore = rec.score !== undefined ? clamp(toNum(rec.score, 80), 0, 100) : null;
  const tagsRaw = Array.isArray(rec.tags) ? rec.tags : [];
  const tags = Array.from(
    new Set(
      tagsRaw
        .map((t) => toStr(t, "").toLowerCase())
        .filter((t) => t.length > 0),
    ),
  ).sort(cmpStr);
  return {
    id,
    name,
    category: toStr(rec.category ?? rec.type, "entree").toLowerCase(),
    station: toStr(rec.station, "Main Pass"),
    prepSeconds: round(clamp(toNum(rec.prepSeconds ?? rec.prepTime ?? rec.timer, 45), 10, 300), 1),
    complexity: Math.round(clamp(toNum(rec.complexity ?? rec.steps, 3), 1, 5)),
    status: toStr(rec.status ?? rec.state, "queued").toLowerCase(),
    tags,
    notes: toStr(rec.notes ?? rec.description, `${name} prepared to order.`),
    metrics: normalizeMetrics(rec.metrics ?? rec.scores ?? rec, `${seed}:${id}`, rawScore),
  };
}

function parseRawTextLines(text: string): unknown[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  return lines.map((line, i) => {
    const parts = line.split(/[|,]/).map((p) => p.trim());
    return {
      id: slugify(parts[0] ?? `dish-${i + 1}`, `dish-${i + 1}`),
      name: parts[0] || `Dish ${i + 1}`,
      station: parts[1] || "Main Pass",
      score: parts[2] !== undefined ? toNum(parts[2], 80) : undefined,
      status: parts[3] || "queued",
    };
  });
}

export function parseSnapshot(input?: unknown): Snapshot {
  let rawObj: Record<string, unknown> | null = null;
  let rawItems: unknown[] | null = null;

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) rawItems = parsed;
        else rawObj = toRecord(parsed);
      } catch {
        rawItems = parseRawTextLines(trimmed);
      }
    }
  } else if (Array.isArray(input)) {
    rawItems = input;
  } else {
    rawObj = toRecord(input);
  }

  const version = toStr(rawObj?.version, MODEL_VERSION);
  const generatedAt = toStr(rawObj?.generatedAt ?? rawObj?.timestamp, DEFAULT_EPOCH);
  const kitchen = toStr(rawObj?.kitchen ?? rawObj?.title ?? rawObj?.name, DEFAULT_KITCHEN);
  const seed = toStr(rawObj?.seed, DEFAULT_SEED);

  const candidateList = rawItems
    ?? (Array.isArray(rawObj?.items) ? rawObj.items : null)
    ?? (Array.isArray(rawObj?.dishes) ? rawObj.dishes : null)
    ?? (Array.isArray(rawObj?.orders) ? rawObj.orders : null)
    ?? (Array.isArray(rawObj?.entries) ? rawObj.entries : null);

  const items: SnapshotItem[] = candidateList && candidateList.length > 0
    ? candidateList.map((entry, idx) => normalizeItem(entry, idx, seed))
    : defaultSnapshotItems();

  const seen = new Map<string, number>();
  const uniqueItems = items.map((item) => {
    const count = seen.get(item.id) ?? 0;
    seen.set(item.id, count + 1);
    return count === 0 ? item : { ...item, id: `${item.id}-${count + 1}` };
  });
  uniqueItems.sort((a, b) => cmpStr(a.id, b.id));

  const meta: Record<string, string | number | boolean> = {};
  const rawMeta = toRecord(rawObj?.meta);
  if (rawMeta) {
    for (const k of Object.keys(rawMeta).sort(cmpStr)) {
      const v = rawMeta[k];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        meta[k] = v;
      }
    }
  }

  return { version, generatedAt, kitchen, seed, items: uniqueItems, meta };
}

function resolveWeights(custom?: Partial<Record<MetricKey, number>>): Record<MetricKey, number> {
  const raw = {} as Record<MetricKey, number>;
  let sum = 0;
  for (const def of AXIS_DEFS) {
    const w = custom && custom[def.key] !== undefined ? Math.max(0, toNum(custom[def.key], def.weight)) : def.weight;
    raw[def.key] = w;
    sum += w;
  }
  const norm = {} as Record<MetricKey, number>;
  for (const def of AXIS_DEFS) {
    norm[def.key] = sum > 0 ? raw[def.key] / sum : def.weight;
  }
  return norm;
}

function isRadarModel(v: unknown): v is RadarModel {
  const rec = toRecord(v);
  return Boolean(rec && Array.isArray(rec.ranked) && Array.isArray(rec.axes) && typeof rec.fingerprint === "string");
}

function tierFor(score: number): "S" | "A" | "B" | "C" {
  if (score >= 88) return "S";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  return "C";
}

export function buildRadar(
  input?: Snapshot | unknown,
  customWeights?: Partial<Record<MetricKey, number>>,
): RadarModel {
  const snapshot = parseSnapshot(input);
  const weights = resolveWeights(customWeights);

  const scored: RankedItem[] = snapshot.items.map((item) => {
    let weighted = 0;
    for (const def of AXIS_DEFS) {
      weighted += item.metrics[def.key] * weights[def.key];
    }
    const paceBonus = clamp((60 - item.prepSeconds) * 0.04, -1.5, 1.5);
    const score = round(clamp(weighted + paceBonus, 0, 100), 2);

    const sortedAxes = [...AXIS_DEFS].sort((a, b) => {
      const diff = item.metrics[b.key] - item.metrics[a.key];
      return diff !== 0 ? diff : cmpStr(a.key, b.key);
    });
    const strengths = sortedAxes.slice(0, 2).map((a) => `${a.label} (${item.metrics[a.key]})`);
    const risks = sortedAxes
      .filter((a) => item.metrics[a.key] < 75)
      .map((a) => `${a.label} (${item.metrics[a.key]})`);

    return {
      rank: 0,
      id: item.id,
      name: item.name,
      category: item.category,
      station: item.station,
      score,
      tier: tierFor(score),
      prepSeconds: item.prepSeconds,
      complexity: item.complexity,
      status: item.status,
      tags: item.tags,
      metrics: item.metrics,
      strengths,
      risks,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.metrics.platingQuality !== a.metrics.platingQuality) {
      return b.metrics.platingQuality - a.metrics.platingQuality;
    }
    if (a.prepSeconds !== b.prepSeconds) return a.prepSeconds - b.prepSeconds;
    return cmpStr(a.id, b.id);
  });

  const ranked = scored.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
  const totalItems = ranked.length;
  const scores = ranked.map((r) => r.score);
  const meanScore = totalItems > 0 ? round(scores.reduce((s, v) => s + v, 0) / totalItems, 2) : 0;
  const mid = Math.floor(totalItems / 2);
  const medianScore = totalItems === 0
    ? 0
    : totalItems % 2 === 1
      ? scores[mid]
      : round((scores[mid - 1] + scores[mid]) / 2, 2);
  const spread = totalItems > 1 ? round(scores[0] - scores[totalItems - 1], 2) : 0;

  const axes: RadarAxis[] = AXIS_DEFS.map((def) => {
    let sum = 0;
    let leaderId = "";
    let leaderScore = -1;
    for (const item of ranked) {
      const val = item.metrics[def.key];
      sum += val;
      if (val > leaderScore || (val === leaderScore && cmpStr(item.id, leaderId) < 0)) {
        leaderScore = val;
        leaderId = item.id;
      }
    }
    return {
      key: def.key,
      label: def.label,
      weight: round(weights[def.key], 4),
      average: totalItems > 0 ? round(sum / totalItems, 2) : 0,
      leaderId,
      leaderScore: leaderScore < 0 ? 0 : round(leaderScore, 2),
    };
  });

  const topPick = ranked[0] ?? null;
  const summary = topPick
    ? `${snapshot.kitchen}: ${totalItems} dishes evaluated (mean ${meanScore}, spread ${spread}); top pass dish is ${topPick.name} at ${topPick.score} (Tier ${topPick.tier}).`
    : `${snapshot.kitchen}: no dishes queued.`;

  const fingerprint = fnv1aHex(
    canonicalJson({
      version: snapshot.version,
      kitchen: snapshot.kitchen,
      ranked: ranked.map((r) => ({ id: r.id, score: r.score, rank: r.rank })),
      axes: axes.map((a) => ({ key: a.key, average: a.average })),
    }),
  );

  return {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    kitchen: snapshot.kitchen,
    seed: snapshot.seed,
    totalItems,
    meanScore,
    medianScore,
    spread,
    axes,
    ranked,
    items: ranked,
    topPick,
    summary,
    fingerprint,
  };
}

export function boardIssue(
  input?: RadarModel | Snapshot | unknown,
  options?: { title?: string; issueId?: string },
): BoardIssue {
  const radar = isRadarModel(input) ? input : buildRadar(input);
  const issueId = toStr(options?.issueId, `BOARD-${radar.fingerprint.toUpperCase()}`);
  const title = toStr(options?.title, `${radar.kitchen} Service Board`);

  const tickets: BoardTicket[] = radar.ranked.map((item) => {
    const priority: "RUSH" | "STANDARD" | "HOLD" = item.status === "assembling" || item.prepSeconds <= 38
      ? "RUSH"
      : item.score < 72
        ? "HOLD"
        : "STANDARD";
    return {
      ticketId: `TKT-${String(item.rank).padStart(2, "0")}-${item.id.slice(0, 6).toUpperCase()}`,
      rank: item.rank,
      itemId: item.id,
      dish: item.name,
      station: item.station,
      priority,
      targetSeconds: item.prepSeconds,
      score: item.score,
      status: item.status,
      checklist: [
        `Prep counter ingredients for ${item.name}`,
        `Fire at ${item.station} within ${item.prepSeconds}s target`,
        `Plate and verify garnish at pass (${item.tier}-tier standard)`,
      ],
    };
  });

  const alerts: string[] = [];
  for (const axis of radar.axes) {
    if (axis.average < 78) {
      alerts.push(`${axis.label} average is ${axis.average}; tighten kitchen execution.`);
    }
  }
  for (const item of radar.ranked) {
    if (item.risks.length > 0) {
      alerts.push(`${item.name}: watch ${item.risks.join(", ")}.`);
    }
  }

  const highlights: string[] = [];
  if (radar.topPick) {
    highlights.push(`Lead Dish: ${radar.topPick.name} (${radar.topPick.score}, Tier ${radar.topPick.tier}) at ${radar.topPick.station}.`);
  }
  const bestAxis = [...radar.axes].sort((a, b) => (b.average !== a.average ? b.average - a.average : cmpStr(a.key, b.key)))[0];
  if (bestAxis) {
    highlights.push(`Strongest Axis: ${METRIC_LABELS[bestAxis.key]} averaging ${bestAxis.average}.`);
  }
  const readyCount = radar.ranked.filter((r) => r.status === "ready").length;
  const assemblingCount = radar.ranked.filter((r) => r.status === "assembling").length;
  highlights.push(`Pass Status: ${readyCount} ready to serve, ${assemblingCount} mid-assembly, ${radar.totalItems - readyCount - assemblingCount} queued.`);

  const status: "READY" | "WATCH" | "EMPTY" = radar.totalItems === 0
    ? "EMPTY"
    : alerts.length === 0 && radar.meanScore >= 82
      ? "READY"
      : "WATCH";

  const topDish = radar.topPick ? radar.topPick.name : "None";
  const headline = radar.topPick
    ? `${title} — ${topDish} leads at ${radar.topPick.score} (${status})`
    : `${title} — No active tickets`;

  const lines = [
    `# ${title}`,
    `Issue: ${issueId} | Status: ${status} | Mean Score: ${radar.meanScore}`,
    "",
    "## Pass Rankings",
    ...radar.ranked.map(
      (r) => `${r.rank}. ${r.name} [${r.tier}] — ${r.score} (${r.station}, ${r.prepSeconds}s, ${r.status})`,
    ),
    "",
    "## Highlights",
    ...highlights.map((h) => `- ${h}`),
  ];
  if (alerts.length > 0) {
    lines.push("", "## Kitchen Alerts", ...alerts.map((a) => `- ${a}`));
  }

  return {
    issueId,
    version: radar.version,
    generatedAt: radar.generatedAt,
    kitchen: radar.kitchen,
    title,
    headline,
    status,
    overallScore: radar.meanScore,
    totalDishes: radar.totalItems,
    topDish,
    axes: radar.axes,
    rankings: radar.ranked,
    tickets,
    alerts,
    highlights,
    summary: radar.summary,
    fingerprint: radar.fingerprint,
    markdown: lines.join("\n"),
  };
}

export function dataScript(payload: unknown, nameOrOptions?: string | DataScriptOptions): string {
  const opts: DataScriptOptions = typeof nameOrOptions === "string"
    ? { globalName: nameOrOptions }
    : (nameOrOptions ?? {});
  const safeJson = escapeScriptJson(canonicalJson(payload));
  const rawId = opts.id ? opts.id.replace(/[^a-zA-Z0-9_-]/g, "") : "";
  const idAttr = rawId.length > 0 ? ` id="${rawId}"` : "";

  if (opts.format === "json") {
    return `<script${idAttr} type="application/json">${safeJson}</script>`;
  }

  const rawVar = (opts.globalName ?? "__MAKEFUN_DATA__").replace(/^window\./, "");
  const safeVar = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawVar) ? rawVar : "__MAKEFUN_DATA__";
  return `<script${idAttr}>window.${safeVar} = ${safeJson};</script>`;
}