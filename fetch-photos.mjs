#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   Squad Selector — photos SportMonks
   node fetch-photos.mjs england-sportsmole          → complète les joueurs sans photo
   node fetch-photos.mjs england-sportsmole --all    → re-vérifie tous les joueurs

   - Token : SPORTMONKS_API_TOKEN (variable d'environnement ou fichier .env)
   - Le fichier pays doit indiquer la nationalité SportMonks :
       countries/england.json → "sportmonksNationalityId": 462
   - Un joueur avec "sportmonksId" est récupéré directement par son id
     (c'est la façon de trancher un homonyme).
   - Sinon : recherche par nom, filtrée par nationalité, photos
     "placeholder" écartées. Si plusieurs candidats restent, rien n'est
     écrit et les ids possibles sont listés.
   ═══════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API = "https://api.sportmonks.com/v3/football";
const POSITIONS = ["gk", "def", "mid", "att"];
const PLACEHOLDER = /placeholder/i;

/* ── Token ───────────────────────────────────────────────────────── */
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const TOKEN = process.env.SPORTMONKS_API_TOKEN;
if (!TOKEN) {
  console.error("✖ SPORTMONKS_API_TOKEN manquant (voir .env.example).");
  process.exit(1);
}

/* ── Args ────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const id = args.find(a => !a.startsWith("--"));
const recheckAll = args.includes("--all");
if (!id) {
  console.error("Usage : node fetch-photos.mjs <selecteur> [--all]");
  process.exit(1);
}
const file = path.join(ROOT, "selectors", `${id}.json`);
if (!fs.existsSync(file)) {
  console.error(`✖ selectors/${id}.json introuvable`);
  process.exit(1);
}
const sel = JSON.parse(fs.readFileSync(file, "utf8"));
const countryFile = path.join(ROOT, "countries", `${sel.country}.json`);
const countryData = fs.existsSync(countryFile) ? JSON.parse(fs.readFileSync(countryFile, "utf8")) : {};
const nationalityId = countryData.sportmonksNationalityId;
if (!nationalityId) {
  console.error(`✖ Ajouter "sportmonksNationalityId": <id> dans countries/${sel.country}.json`);
  process.exit(1);
}

/* ── API helpers ─────────────────────────────────────────────────── */
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(pathAndQuery) {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${pathAndQuery}${sep}api_token=${TOKEN}`);
  if (!res.ok) throw new Error(`SportMonks ${res.status} ${res.statusText}`);
  await sleep(150);
  return res.json();
}

async function searchPlayers(query) {
  const json = await api(`/players/search/${encodeURIComponent(query)}?per_page=50`);
  return json.data || [];
}

const hasPhoto = p => p.image_path && !PLACEHOLDER.test(p.image_path);
const isCompatriot = p => p.nationality_id === nationalityId || p.country_id === nationalityId;

async function resolve(name) {
  const target = norm(name);
  const plain = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const lastName = name.trim().split(/\s+/).pop();
  const queries = [name, plain, plain.replace(/['’]/g, ""), plain.replace(/['’]/g, " "), lastName];

  const isExact = p => [p.name, p.display_name, `${p.firstname} ${p.lastname}`].some(n => norm(n) === target);
  const otherNationality = [];

  for (const q of [...new Set(queries)]) {
    const results = await searchPlayers(q);
    const found = results.filter(isCompatriot);
    const exact = found.filter(isExact);
    const pool = exact.length ? exact : (q === lastName ? [] : found);
    const withPhoto = pool.filter(hasPhoto);
    if (withPhoto.length === 1) return { player: withPhoto[0] };
    if (withPhoto.length > 1) return { ambiguous: withPhoto };
    if (pool.length) return { player: pool[0], noPhoto: true };
    results.filter(p => !isCompatriot(p) && isExact(p) && hasPhoto(p)).forEach(p => otherNationality.push(p));
  }

  // Binationaux : SportMonks enregistre parfois une autre nationalité (ex. England)
  const unique = [...new Map(otherNationality.map(p => [p.id, p])).values()];
  if (unique.length === 1) return { player: unique[0], toCheck: true };
  if (unique.length > 1) return { ambiguous: unique };
  return { notFound: true };
}

/* ── Main ────────────────────────────────────────────────────────── */
const report = { ok: [], noPhoto: [], toCheck: [], ambiguous: [], notFound: [] };

async function updatePlayer(p) {
  let result;
  if (p.sportmonksId) {
    const json = await api(`/players/${p.sportmonksId}`);
    result = json.data ? { player: json.data, noPhoto: !hasPhoto(json.data) } : { notFound: true };
  } else {
    result = await resolve(p.name);
  }

  if (result.player) {
    p.sportmonksId = result.player.id;
    if (result.noPhoto) {
      delete p.photo;
      report.noPhoto.push(`${p.name} (id ${result.player.id})`);
    } else {
      p.photo = result.player.image_path;
      report.ok.push(p.name);
    }
    if (result.toCheck) {
      report.toCheck.push(`${p.name} → id ${result.player.id} (nationalité SportMonks ${result.player.nationality_id}, né le ${result.player.date_of_birth || "?"})`);
    }
  } else if (result.ambiguous) {
    report.ambiguous.push(`${p.name} → ` + result.ambiguous
      .map(c => `id ${c.id} (${c.display_name || c.name}, né le ${c.date_of_birth || "?"})`).join(" | "));
  } else {
    report.notFound.push(p.name);
  }
}

for (const pos of POSITIONS) {
  const out = [];
  for (const entry of sel.players[pos]) {
    const p = typeof entry === "string" ? { name: entry } : { ...entry };
    const upToDate = p.photo && p.sportmonksId;
    if (!upToDate || recheckAll) {
      try {
        await updatePlayer(p);
      } catch (e) {
        report.notFound.push(`${p.name} (${e.message})`);
      }
    }
    out.push(p);
  }
  sel.players[pos] = out;
}

/* ── Écriture (un joueur par ligne) ──────────────────────────────── */
const ORDER = ["name", "displayName", "club", "sportmonksId", "photo"];
const playerLine = p => {
  const keys = ORDER.filter(k => p[k] !== undefined).concat(Object.keys(p).filter(k => !ORDER.includes(k)));
  if (keys.length === 1) return JSON.stringify(p.name);
  return "{" + keys.map(k => `${JSON.stringify(k)}: ${JSON.stringify(p[k])}`).join(", ") + "}";
};
const { players, ...head } = sel;
const headJson = Object.entries(head).map(([k, v]) =>
  k === "rules" || k === "sportmonks"
    ? `  ${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, "{ ").replace(/\}$/, " }")}`
    : `  ${JSON.stringify(k)}: ${JSON.stringify(v, null, 2).replace(/\n/g, "\n  ")}`
).join(",\n");
const playersJson = POSITIONS.map(pos =>
  `    "${pos}": [\n${players[pos].map(p => "      " + playerLine(p)).join(",\n")}\n    ]`
).join(",\n");
fs.writeFileSync(file, `{\n${headJson},\n  "players": {\n${playersJson}\n  }\n}\n`);

/* ── Rapport ─────────────────────────────────────────────────────── */
console.log(`✔ ${report.ok.length} photo(s) trouvée(s)`);
if (report.noPhoto.length) console.log(`⚠ Sans photo chez SportMonks (initiales affichées) :\n    ${report.noPhoto.join("\n    ")}`);
if (report.toCheck.length) console.log(`⚠ Trouvés sous une autre nationalité (binationaux ?), à vérifier :\n    ${report.toCheck.join("\n    ")}`);
if (report.ambiguous.length) console.log(`⚠ Homonymes : ajouter "sportmonksId" au bon joueur puis relancer :\n    ${report.ambiguous.join("\n    ")}`);
if (report.notFound.length) console.log(`✖ Introuvables :\n    ${report.notFound.join("\n    ")}`);
console.log(`\nselectors/${id}.json mis à jour. Lancer ensuite : node build.mjs ${id}`);
