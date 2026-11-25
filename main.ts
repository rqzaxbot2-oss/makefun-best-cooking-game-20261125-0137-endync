import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface FileRecord {
  path: string;
  bytes: number;
  sha256: string;
  lines: number | null;
}

interface ScreenshotRecord {
  path: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  format: string;
}

interface SourceOutline {
  path: string;
  bytes: number;
  lines: number;
  sha256: string;
  symbols: string[];
}

interface RequirementsReport {
  licensePresent: boolean;
  mainEntrypointPresent: boolean;
  vendorKitPresent: boolean;
  gameIndexPresent: boolean;
  screenshotsCountValid: boolean;
  noRuntimeNetworkCalls: boolean;
  networkFindings: string[];
}

interface ContractReport {
  contract: string;
  bounty: string;
  title: string;
  game: {
    entrypoint: string;
    present: boolean;
    fileCount: number;
    totalBytes: number;
    files: FileRecord[];
  };
  screenshots: {
    count: number;
    items: ScreenshotRecord[];
  };
  dashboard: {
    path: string;
    source: "copied" | "generated";
  };
  requirements: RequirementsReport;
  sourceOutline: SourceOutline[];
  digestSha256: string;
}

const DEFAULT_TITLE = "Copper & Flame — Kitchen Service";
const TEXT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".html", ".css", ".json", ".md", ".svg", ".txt"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"]);

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function isFile(p: string): boolean {
  return Boolean(fs.statSync(p, { throwIfNoEntry: false })?.isFile());
}

function isDirectory(p: string): boolean {
  return Boolean(fs.statSync(p, { throwIfNoEntry: false })?.isDirectory());
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function countLines(buf: Buffer): number {
  if (buf.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0a) count += 1;
  }
  return buf[buf.length - 1] === 0x0a ? count - 1 : count;
}

function walkFilesSorted(dir: string, relBase = ""): string[] {
  if (!isDirectory(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => compareStrings(a.name, b.name));
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFilesSorted(full, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function writeFileDeterministic(dstPath: string, data: Buffer | string): void {
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.writeFileSync(dstPath, data);
}

function copyFileIfDistinct(srcPath: string, dstPath: string): Buffer {
  const buf = fs.readFileSync(srcPath);
  if (path.resolve(srcPath) !== path.resolve(dstPath)) {
    writeFileDeterministic(dstPath, buf);
  }
  return buf;
}

function copyTree(srcDir: string, dstDir: string, prefix: string): FileRecord[] {
  const records: FileRecord[] = [];
  for (const rel of walkFilesSorted(srcDir)) {
    const buf = copyFileIfDistinct(path.join(srcDir, rel), path.join(dstDir, rel));
    records.push({
      path: toPosix(path.join(prefix, rel)),
      bytes: buf.length,
      sha256: sha256(buf),
      lines: isTextFile(rel) ? countLines(buf) : null,
    });
  }
  records.sort((a, b) => compareStrings(a.path, b.path));
  return records;
}

function parseImageInfo(buf: Buffer, ext: string): { width: number; height: number; format: string } {
  const lower = ext.toLowerCase();
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf.toString("ascii", 12, 16) === "IHDR"
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "png" };
  }
  if (buf.length >= 10 && (buf.toString("ascii", 0, 6) === "GIF89a" || buf.toString("ascii", 0, 6) === "GIF87a")) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: "gif" };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 1 < buf.length) {
      if (buf[i] !== 0xff) break;
      while (i < buf.length && buf[i] === 0xff) i += 1;
      if (i >= buf.length) break;
      const marker = buf[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (i + 2 > buf.length) break;
      const len = buf.readUInt16BE(i);
      if (len < 2 || i + len > buf.length) break;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof && len >= 7) {
        return { height: buf.readUInt16BE(i + 3), width: buf.readUInt16BE(i + 5), format: "jpeg" };
      }
      i += len;
    }
    return { width: 0, height: 0, format: "jpeg" };
  }
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), format: "webp" };
    }
    if (chunk === "VP8 " && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: "webp" };
    }
    if (chunk === "VP8L" && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
    }
    return { width: 0, height: 0, format: "webp" };
  }
  if (lower === ".svg") {
    const head = buf.toString("utf8", 0, Math.min(buf.length, 2048));
    const vb = head.match(/viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
    if (vb) {
      const w = Math.round(Number(vb[1]));
      const h = Math.round(Number(vb[2]));
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h, format: "svg" };
    }
    const wMatch = head.match(/<svg\b[^>]*\bwidth=["']([\d.]+)(?:px)?["']/i);
    const hMatch = head.match(/<svg\b[^>]*\bheight=["']([\d.]+)(?:px)?["']/i);
    if (wMatch && hMatch) {
      const w = Math.round(Number(wMatch[1]));
      const h = Math.round(Number(hMatch[1]));
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h, format: "svg" };
    }
    return { width: 0, height: 0, format: "svg" };
  }
  return { width: 0, height: 0, format: lower.replace(".", "") || "unknown" };
}

function extractSymbols(relPath: string, text: string): string[] {
  const ext = path.extname(relPath).toLowerCase();
  const found = new Set<string>();
  if (ext === ".ts" || ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    const patterns = [
      /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
      /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
      /(?:^|\n)\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
      /(?:^|\n)\s*export\s+(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    ];
    for (const re of patterns) {
      for (const m of text.matchAll(re)) if (m[1]) found.add(m[1]);
    }
  } else if (ext === ".html") {
    for (const m of text.matchAll(/\bid=["']([A-Za-z0-9_-]+)["']/g)) if (m[1]) found.add(`#${m[1]}`);
  } else if (ext === ".css") {
    for (const m of text.matchAll(/(?:^|\n)\s*([.#][A-Za-z0-9_-]+)\s*[,{]/g)) if (m[1]) found.add(m[1]);
  }
  return Array.from(found).sort(compareStrings).slice(0, 60);
}

function auditOfflineCompliance(gameDir: string, files: FileRecord[]): string[] {
  const findings = new Set<string>();
  const checks: Array<{ label: string; regex: RegExp }> = [
    { label: "fetch() call", regex: /\bfetch\s*\(/ },
    { label: "XMLHttpRequest usage", regex: /\bXMLHttpRequest\b/ },
    { label: "WebSocket usage", regex: /\bnew\s+WebSocket\b/ },
    { label: "EventSource usage", regex: /\bnew\s+EventSource\b/ },
    { label: "sendBeacon usage", regex: /\bsendBeacon\s*\(/ },
    { label: "external HTTP asset reference", regex: /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i },
    { label: "external CSS url()", regex: /url\(\s*["']?(?:https?:)?\/\//i },
    { label: "external module import", regex: /\bimport(?:\s+[^"']*from\s*|\s*\(\s*)["']https?:\/\//i },
  ];
  for (const file of files) {
    if (!isTextFile(file.path)) continue;
    const rel = file.path.startsWith("game/") ? file.path.slice("game/".length) : file.path;
    const full = path.join(gameDir, rel);
    if (!isFile(full)) continue;
    const stripped = fs.readFileSync(full, "utf8").replace(/https?:\/\/(?:www\.)?w3\.org\/[^\s"'<>)]+/gi, "");
    for (const check of checks) {
      if (check.regex.test(stripped)) findings.add(`${file.path}: ${check.label}`);
    }
  }
  return Array.from(findings).sort(compareStrings);
}

function extractHtmlTitle(gameDir: string): string {
  const indexPath = path.join(gameDir, "index.html");
  if (!isFile(indexPath)) return DEFAULT_TITLE;
  const match = fs.readFileSync(indexPath, "utf8").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match || !match[1]) return DEFAULT_TITLE;
  const decoded = match[1]
    .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&#39;", "'")
    .replaceAll("&mdash;", "—").replaceAll("&ndash;", "–")
    .replace(/\s+/g, " ").trim();
  return decoded || DEFAULT_TITLE;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function buildDossierMarkdown(report: ContractReport): string {
  const lines: string[] = [
    `# ${report.title}`, "",
    `- **Bounty**: \`${report.bounty}\``,
    `- **Contract**: \`${report.contract}\``,
    `- **Entrypoint**: \`${report.game.entrypoint}\``,
    `- **Offline Verified**: ${report.requirements.noRuntimeNetworkCalls ? "yes" : "no"}`,
    `- **Game Files**: ${report.game.fileCount} (${report.game.totalBytes} bytes)`,
    `- **Screenshots**: ${report.screenshots.count}`,
    `- **Digest (SHA-256)**: \`${report.digestSha256}\``, "",
    "## Verification Checklist", "",
    `- LICENSE present: ${report.requirements.licensePresent ? "pass" : "fail"}`,
    `- main.ts present: ${report.requirements.mainEntrypointPresent ? "pass" : "fail"}`,
    `- vendor/makefun-game.ts present: ${report.requirements.vendorKitPresent ? "pass" : "pending"}`,
    `- game/index.html present: ${report.requirements.gameIndexPresent ? "pass" : "pending"}`,
    `- 3-4 screenshots present: ${report.requirements.screenshotsCountValid ? "pass" : "pending"}`,
    `- Zero runtime network calls: ${report.requirements.noRuntimeNetworkCalls ? "pass" : "fail"}`, "",
    "## Screenshots", "",
  ];
  if (report.screenshots.items.length === 0) {
    lines.push("- None captured yet.");
  } else {
    for (const s of report.screenshots.items) {
      lines.push(`- \`${s.path}\` — ${s.width}x${s.height} ${s.format.toUpperCase()} (${s.bytes} bytes, sha256 \`${s.sha256.slice(0, 12)}\`)`);
    }
  }
  lines.push("", "## Source Outline", "");
  for (const item of report.sourceOutline) {
    const syms = item.symbols.length > 0 ? item.symbols.slice(0, 14).join(", ") : "static asset";
    lines.push(`- \`${item.path}\` (${item.lines} lines, ${item.bytes} bytes): ${syms}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildDashboardHtml(report: ContractReport): string {
  const shotCards = report.screenshots.items
    .map((s) => `<figure class="shot"><img src="${escapeHtml(s.path)}" alt="${escapeHtml(s.path)}" /><figcaption>${escapeHtml(s.path)} (${s.width}x${s.height})</figcaption></figure>`)
    .join("\n");
  const outlineRows = report.sourceOutline
    .map((item) => `<tr><td><code>${escapeHtml(item.path)}</code></td><td>${item.lines}</td><td>${item.bytes}</td><td>${escapeHtml(item.symbols.slice(0, 10).join(", "))}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(report.title)} — Submission Dashboard</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#161310;color:#f5ede1;padding:24px;}
main{max-width:1100px;margin:0 auto;}
h1,h2{color:#f4b350;}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0;}
.card{background:#231e19;border:1px solid #3c3228;border-radius:10px;padding:12px 16px;}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin:16px 0;}
.shot{margin:0;background:#231e19;border:1px solid #3c3228;border-radius:10px;overflow:hidden;}
.shot img{display:block;width:100%;height:auto;}
.shot figcaption{padding:8px 12px;font-size:13px;color:#cbbba5;}
table{width:100%;border-collapse:collapse;background:#231e19;border-radius:10px;overflow:hidden;}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #342b22;font-size:13px;}
a.play{display:inline-block;padding:10px 16px;background:#e07a32;color:#161310;font-weight:700;border-radius:8px;text-decoration:none;}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(report.title)}</h1>
<p><a class="play" href="${escapeHtml(report.game.entrypoint)}">Launch Playable Game</a></p>
<section class="meta">
<div class="card"><strong>Bounty</strong><br />${escapeHtml(report.bounty)}</div>
<div class="card"><strong>Game Files</strong><br />${report.game.fileCount} (${report.game.totalBytes} bytes)</div>
<div class="card"><strong>Screenshots</strong><br />${report.screenshots.count}</div>
<div class="card"><strong>Offline Check</strong><br />${report.requirements.noRuntimeNetworkCalls ? "PASS" : "FAIL"}</div>
</section>
<h2>Screenshots</h2>
<section class="shots">${shotCards || "<p>No screenshots captured yet.</p>"}</section>
<h2>Source Outline</h2>
<table><thead><tr><th>File</th><th>Lines</th><th>Bytes</th><th>Key Symbols</th></tr></thead><tbody>${outlineRows}</tbody></table>
</main>
</body>
</html>
`;
}

function collectSourceOutline(repoRoot: string, gameFiles: FileRecord[]): SourceOutline[] {
  const candidates = new Set<string>();
  for (const fixed of ["main.ts", "vendor/makefun-game.ts"]) {
    if (isFile(path.join(repoRoot, fixed))) candidates.add(fixed);
  }
  for (const gf of gameFiles) {
    if (isTextFile(gf.path)) candidates.add(gf.path);
  }
  const outlines: SourceOutline[] = [];
  for (const rel of Array.from(candidates).sort(compareStrings)) {
    const full = path.join(repoRoot, rel);
    if (!isFile(full)) continue;
    const buf = fs.readFileSync(full);
    outlines.push({
      path: rel,
      bytes: buf.length,
      lines: countLines(buf),
      sha256: sha256(buf),
      symbols: extractSymbols(rel, buf.toString("utf8")),
    });
  }
  return outlines;
}

function main(): void {
  const repoRoot = path.dirname(fileURLToPath(import.meta.url));
  const envOut = process.env.MAKEFUN_OUTPUT_DIR?.trim();
  const outDir = path.resolve(envOut || path.join(repoRoot, "output"));
  fs.mkdirSync(outDir, { recursive: true });

  const gameSrcDir = path.join(repoRoot, "game");
  const gameFiles = isDirectory(gameSrcDir) ? copyTree(gameSrcDir, path.join(outDir, "game"), "game") : [];

  const shotsSrcDir = path.join(repoRoot, "screenshots");
  const shotFileRecords = isDirectory(shotsSrcDir)
    ? copyTree(shotsSrcDir, path.join(outDir, "screenshots"), "screenshots")
    : [];

  const screenshots: ScreenshotRecord[] = shotFileRecords
    .filter((rec) => isImageFile(rec.path))
    .map((rec) => {
      const rel = rec.path.slice("screenshots/".length);
      const buf = fs.readFileSync(path.join(shotsSrcDir, rel));
      const info = parseImageInfo(buf, path.extname(rel));
      return {
        path: rec.path,
        bytes: rec.bytes,
        sha256: rec.sha256,
        width: info.width,
        height: info.height,
        format: info.format,
      };
    });

  const dashboardDirSrc = path.join(repoRoot, "dashboard");
  if (isDirectory(dashboardDirSrc)) {
    copyTree(dashboardDirSrc, path.join(outDir, "dashboard"), "dashboard");
  }

  let dashboardSource: "copied" | "generated" = "generated";
  const rootDashboard = path.join(repoRoot, "dashboard.html");
  const nestedDashboard = path.join(dashboardDirSrc, "index.html");
  const outDashboard = path.join(outDir, "dashboard.html");
  if (isFile(rootDashboard)) {
    copyFileIfDistinct(rootDashboard, outDashboard);
    dashboardSource = "copied";
  } else if (isFile(nestedDashboard)) {
    copyFileIfDistinct(nestedDashboard, outDashboard);
    dashboardSource = "copied";
  }

  const networkFindings = auditOfflineCompliance(gameSrcDir, gameFiles);
  const sourceOutline = collectSourceOutline(repoRoot, gameFiles);
  const totalGameBytes = gameFiles.reduce((sum, f) => sum + f.bytes, 0);
  const gameIndexPresent = isFile(path.join(gameSrcDir, "index.html"));

  const baseReport: Omit<ContractReport, "digestSha256"> = {
    contract: "makefun-game/v1",
    bounty: "best-cooking-game-20261125-0137",
    title: extractHtmlTitle(gameSrcDir),
    game: {
      entrypoint: "game/index.html",
      present: gameIndexPresent,
      fileCount: gameFiles.length,
      totalBytes: totalGameBytes,
      files: gameFiles,
    },
    screenshots: {
      count: screenshots.length,
      items: screenshots,
    },
    dashboard: {
      path: "dashboard.html",
      source: dashboardSource,
    },
    requirements: {
      licensePresent: isFile(path.join(repoRoot, "LICENSE")),
      mainEntrypointPresent: isFile(path.join(repoRoot, "main.ts")),
      vendorKitPresent: isFile(path.join(repoRoot, "vendor", "makefun-game.ts")),
      gameIndexPresent,
      screenshotsCountValid: screenshots.length >= 3 && screenshots.length <= 4,
      noRuntimeNetworkCalls: networkFindings.length === 0,
      networkFindings,
    },
    sourceOutline,
  };

  const digestSha256 = sha256(Buffer.from(JSON.stringify(baseReport), "utf8"));
  const report: ContractReport = { ...baseReport, digestSha256 };

  if (dashboardSource === "generated") {
    writeFileDeterministic(outDashboard, buildDashboardHtml(report));
  }

  const rootDossierMd = path.join(repoRoot, "dossier.md");
  const outDossierMd = path.join(outDir, "dossier.md");
  if (isFile(rootDossierMd)) {
    copyFileIfDistinct(rootDossierMd, outDossierMd);
  } else {
    writeFileDeterministic(outDossierMd, buildDossierMarkdown(report));
  }

  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  writeFileDeterministic(path.join(outDir, "manifest.json"), reportJson);
  writeFileDeterministic(path.join(outDir, "dossier.json"), reportJson);
  writeFileDeterministic(path.join(outDir, "scorecard.json"), reportJson);

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      contract: report.contract,
      title: report.title,
      gameFiles: report.game.fileCount,
      screenshots: report.screenshots.count,
      digestSha256: report.digestSha256,
    })}\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}