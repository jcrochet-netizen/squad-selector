#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   Squad Selector — build
   node build.mjs                         → génère tous les widgets, dans toutes les langues
   node build.mjs england-sportsmole ...  → génère seulement ceux-là (toutes leurs langues)

   Entrées : selectors/<id>.json   (site, pays, événement, règles, joueurs)
             countries/<pays>.json (nom du pays traduit + nationalité SportMonks)
             events/<event>.json   (libellé de l'événement traduit)
             sites/<site>.json     (nom du média, thème)
             locales/<langue>.json (textes de l'interface)
             src/template.html     (moteur commun)
   Sortie  : docs/<id>-<langue>.html (fichiers autonomes, prêts pour GitHub Pages)
             docs/index.html          (liste de tous les widgets)
   ═══════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(ROOT, "docs");
const POSITIONS = ["gk", "def", "mid", "att"];
const ID_BASE = { gk: 1, def: 101, mid: 201, att: 301 };
const PLAYER_FIELDS = ["name", "displayName", "club", "photo", "sportmonksId"];
const RUNTIME_PLACEHOLDERS = ["n", "min", "pos"];

/* ── Helpers ─────────────────────────────────────────────────────── */
function readJson(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error(`${rel} introuvable`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${rel} : JSON invalide (${e.message})`);
  }
}

function listIds(dir) {
  return fs.readdirSync(path.join(ROOT, dir))
    .filter(f => f.endsWith(".json"))
    .map(f => f.slice(0, -5))
    .sort();
}

const outName = (id, lang) => `${id}-${lang.toLowerCase()}.html`;

const fmt = (str, vars) => str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const slugify = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function joinList(items, locale) {
  if (items.length < 2) return items.join("");
  return items.slice(0, -1).join(locale.listSep) + locale.listLast + items[items.length - 1];
}

/* "3 goalkeepers, 7 to 9 defenders, 6 to 9 midfielders and 7 to 9 forwards" */
function rulesSentence(rules, locale) {
  return joinList(POSITIONS.map(pos => {
    const { min, max } = rules.positions[pos];
    const [one, many] = locale.units[pos];
    return min === max
      ? fmt(locale.rangeExact, { n: min, unit: min === 1 ? one : many })
      : fmt(locale.rangeBetween, { min, max, unit: many });
  }), locale);
}

/* ── Validation / normalisation ──────────────────────────────────── */
function normalizeRules(raw, errors) {
  const positions = {};
  POSITIONS.forEach(pos => {
    const r = raw[pos];
    const ok = Array.isArray(r) && r.length === 2 && r.every(Number.isInteger) && r[0] >= 0 && r[0] <= r[1];
    if (!ok) errors.push(`rules.${pos} doit être [min, max], ex : [7, 9]`);
    positions[pos] = ok ? { min: r[0], max: r[1] } : { min: 0, max: 0 };
  });
  const total = raw.total;
  const sumMin = POSITIONS.reduce((s, p) => s + positions[p].min, 0);
  const sumMax = POSITIONS.reduce((s, p) => s + positions[p].max, 0);
  if (!Number.isInteger(total) || total < 1) {
    errors.push("rules.total doit être un entier positif");
  } else if (sumMin > total || sumMax < total) {
    errors.push(`rules : un total de ${total} est impossible avec ces fourchettes (minimums cumulés ${sumMin}, maximums cumulés ${sumMax})`);
  }
  return { total, positions };
}

function normalizePlayers(raw, rules, errors, warnings) {
  const players = {};
  const seen = new Map();
  POSITIONS.forEach(pos => {
    const list = raw && raw[pos];
    if (!Array.isArray(list)) {
      errors.push(`players.${pos} manquant (liste de joueurs attendue)`);
      players[pos] = [];
      return;
    }
    if (list.length > 100) errors.push(`players.${pos} : 100 joueurs maximum par poste`);

    players[pos] = list.map((entry, i) => {
      const p = typeof entry === "string" ? { name: entry } : { ...entry };
      if (typeof p.name !== "string" || !p.name.trim()) {
        errors.push(`players.${pos}[${i}] : champ "name" manquant`);
        p.name = "?";
      }
      const name = p.name.trim().replace(/\s+/g, " ");
      const key = slugify(name);
      if (seen.has(key)) errors.push(`"${name}" apparaît deux fois (${seen.get(key)} et ${pos})`);
      seen.set(key, pos);

      const unknown = Object.keys(p).filter(k => !PLAYER_FIELDS.includes(k));
      if (unknown.length) warnings.push(`${name} : champ(s) ignoré(s) → ${unknown.join(", ")}`);
      if (p.photo && !/^https:\/\/[^\s'"()]+$/.test(p.photo)) errors.push(`${name} : URL de photo invalide`);

      const out = { id: ID_BASE[pos] + i, name };
      ["displayName", "club", "photo"].forEach(k => { if (p[k]) out[k] = String(p[k]).trim(); });
      return out;
    });

    const { min, max } = rules.positions[pos];
    const n = players[pos].length;
    if (n < min) errors.push(`${pos} : ${n} joueur(s) dans la liste alors qu'il en faut au moins ${min}`);
    else if (n < max) warnings.push(`${pos} : ${n} joueur(s) dans la liste pour un maximum de ${max}`);
  });

  const pool = POSITIONS.reduce((s, p) => s + players[p].length, 0);
  if (Number.isInteger(rules.total) && pool < rules.total) {
    errors.push(`seulement ${pool} joueurs au total pour une liste de ${rules.total}`);
  }
  return players;
}

function themeCss(site, sel, errors) {
  const vars = {
    "--widget-max": `${site.maxWidth || 720}px`,
    "--grid-cols": site.gridCols || "repeat(2,1fr)",
    ...(site.vars || {}),
    ...(sel.vars || {})
  };
  Object.entries(vars).forEach(([k, v]) => {
    if (!/^--[a-z0-9-]+$/.test(k) || /[<>{};]/.test(String(v))) errors.push(`variable CSS invalide : ${k}: ${v}`);
  });
  const rootBlock = `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
  return site.css ? `${rootBlock}\n${site.css}` : rootBlock;
}

/* ── Load one selector (partie commune à toutes les langues) ─────── */
function loadSelector(id, allLangs) {
  const errors = [];
  const warnings = [];
  const sel = readJson(`selectors/${id}.json`);
  const site = readJson(`sites/${sel.site}.json`);

  if (typeof sel.country !== "string") errors.push(`"country" doit référencer un fichier de countries/ (ex : "england")`);
  if (typeof sel.event !== "string") errors.push(`"event" doit référencer un fichier de events/ (ex : "2026-10")`);
  const country = typeof sel.country === "string" ? readJson(`countries/${sel.country}.json`) : {};
  const event = typeof sel.event === "string" ? readJson(`events/${sel.event}.json`) : {};

  const languages = sel.languages || allLangs;
  languages.forEach(l => {
    if (!allLangs.includes(l)) errors.push(`langue "${l}" inconnue (disponibles : ${allLangs.join(", ")})`);
  });

  const rules = normalizeRules(sel.rules || {}, errors);
  const players = normalizePlayers(sel.players, rules, errors, warnings);
  const css = themeCss(site, sel, errors);
  return { id, sel, site, country, event, languages, rules, players, css, errors, warnings };
}

/* ── Build one language variant ──────────────────────────────────── */
function buildVariant(ctx, lang, template, baseLocale) {
  const errors = [];
  const warnings = [];
  const { id, sel, site, rules, players } = ctx;
  const locale = readJson(`locales/${lang}.json`);
  const country = ctx.country[lang] || {};
  const event = ctx.event[lang] || {};
  if (!country.name) errors.push(`countries/${sel.country}.json : "${lang}.name" manquant`);
  if (!event.long || !event.short) errors.push(`events/${sel.event}.json : "${lang}.long" et "${lang}.short" manquants`);
  if (errors.length) return { errors, warnings };

  const vars = {
    site: site.name,
    country: country.name,
    countryOf: country.of || country.name,
    countryAdj: country.adj || country.name,
    countryDemonym: country.demonym || country.name,
    event: event.long,
    eventShort: event.short,
    total: rules.total,
    rules: rulesSentence(rules, locale),
    tabs: joinList(POSITIONS.map(p => locale.pos[p]), locale),
    slug: slugify(country.name),
    eventSlug: slugify(event.short)
  };

  // Priorité des textes : selector.text[langue] > site.text[langue] > locales/<langue> > locales/en
  const rawText = { ...locale.t, ...((site.text || {})[lang] || {}), ...((sel.text || {})[lang] || {}) };
  Object.keys(baseLocale.t).forEach(k => {
    if (!(k in rawText)) {
      warnings.push(`locales/${lang}.json : clé "${k}" manquante, texte anglais utilisé`);
      rawText[k] = baseLocale.t[k];
    }
  });
  const t = {};
  Object.entries(rawText).forEach(([k, v]) => {
    t[k] = fmt(v, vars);
    const leftovers = [...t[k].matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(x => !RUNTIME_PLACEHOLDERS.includes(x));
    if (leftovers.length) warnings.push(`texte "${k}" : variable(s) inconnue(s) {${leftovers.join("}, {")}}`);
  });

  const config = {
    id,
    lang,
    rules,
    players,
    pos: locale.pos,
    posFull: locale.posFull,
    t: {
      validateBtn: t.validateBtn,
      validateBtnReady: t.validateBtnReady,
      hintIncomplete: t.hintIncomplete,
      hintMin: t.hintMin,
      hintRemainingOne: t.hintRemainingOne,
      hintRemainingMany: t.hintRemainingMany,
      shareText: t.shareText,
      instagramAlert: t.instagramAlert,
      errorFileProto: t.errorFileProto,
      errorPrefix: t.errorPrefix,
      downloadFilename: t.downloadFilename
    }
  };

  const data = {
    ...t,
    id,
    htmlLang: lang,
    total: rules.total,
    builtAt: new Date().toISOString().slice(0, 10),
    themeCss: ctx.css,
    configJson: JSON.stringify(config).replace(/</g, "\\u003c")
  };

  const missing = new Set();
  const html = template.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (m, raw, escaped) => {
    const key = raw || escaped;
    if (!(key in data)) { missing.add(key); return m; }
    return raw ? String(data[key]) : escHtml(data[key]);
  });
  if (missing.size) errors.push(`template : variable(s) non fournie(s) ${[...missing].join(", ")}`);
  if (errors.length) return { errors, warnings };

  const file = outName(id, lang);
  fs.writeFileSync(path.join(OUT_DIR, file), html);
  return { errors, warnings, file, summary: `${country.name} · ${event.short}` };
}

/* ── Index page ──────────────────────────────────────────────────── */
function buildIndex(allLangs) {
  const rows = listIds("selectors").map(id => {
    try {
      const sel = readJson(`selectors/${id}.json`);
      const site = readJson(`sites/${sel.site}.json`);
      const links = (sel.languages || allLangs).map(lang => {
        const file = outName(id, lang);
        return fs.existsSync(path.join(OUT_DIR, file)) ? `<a href="${file}">${escHtml(lang)}</a>` : `<s>${escHtml(lang)}</s>`;
      }).join(" · ");
      return `<tr><td>${escHtml(id)}</td><td>${escHtml(site.name)}</td><td>${escHtml(sel.event)}</td><td>${links}</td></tr>`;
    } catch {
      return `<tr><td>${escHtml(id)}</td><td colspan="3">config invalide</td></tr>`;
    }
  }).join("\n");
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow"><title>Squad Selector</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:24px 16px;color:#1a1a1a;background:#fff}
main{max-width:860px;margin:0 auto}h1{font-size:1.4rem;margin-bottom:4px}p{color:#666;margin-top:0}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap}
th{font-size:.75rem;text-transform:uppercase;letter-spacing:.5px;color:#777}a{color:#e30613;font-weight:600}s{color:#bbb}</style></head>
<body><main><h1>⚽ Squad Selector</h1><p>Mis à jour le ${new Date().toISOString().slice(0, 10)}</p>
<div class="wrap"><table><thead><tr><th>Widget</th><th>Site</th><th>Événement</th><th>Langues</th></tr></thead>
<tbody>
${rows}
</tbody></table></div></main></body></html>
`;
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
}

/* ── Main ────────────────────────────────────────────────────────── */
const requested = process.argv.slice(2);
const allIds = listIds("selectors");
const allLangs = listIds("locales");
const unknown = requested.filter(id => !allIds.includes(id));
if (unknown.length) {
  console.error(`✖ Widget(s) inconnu(s) : ${unknown.join(", ")}\n  Disponibles : ${allIds.join(", ")}`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const template = fs.readFileSync(path.join(ROOT, "src/template.html"), "utf8");
const baseLocale = readJson("locales/en.json");
const targets = requested.length ? requested : allIds;
const expected = new Set();   // fichiers attendus pour les widgets traités
const untouched = new Set();  // widgets en erreur de chargement : on ne supprime pas leurs anciens fichiers
let failed = 0;

for (const id of targets) {
  let ctx;
  try {
    ctx = loadSelector(id, allLangs);
  } catch (e) {
    ctx = { id, errors: [e.message], warnings: [] };
  }
  if (ctx.errors.length) {
    failed++;
    untouched.add(id);
    console.log(`✖ ${id}`);
    ctx.errors.forEach(e => console.log(`    erreur : ${e}`));
    ctx.warnings.forEach(w => console.log(`    ⚠ ${w}`));
    continue;
  }

  const pool = POSITIONS.reduce((s, p) => s + ctx.players[p].length, 0);
  console.log(`● ${id}  (${ctx.site.name} · ${pool} joueurs · liste de ${ctx.rules.total})`);
  ctx.warnings.forEach(w => console.log(`    ⚠ ${w}`));

  for (const lang of ctx.languages) {
    expected.add(outName(id, lang));
    let result;
    try {
      result = buildVariant(ctx, lang, template, baseLocale);
    } catch (e) {
      result = { errors: [e.message], warnings: [] };
    }
    if (result.errors.length) {
      failed++;
      console.log(`    ✖ ${lang}`);
      result.errors.forEach(e => console.log(`        erreur : ${e}`));
    } else {
      console.log(`    ✔ ${lang.padEnd(5)} → docs/${result.file}  (${result.summary})`);
    }
    result.warnings.forEach(w => console.log(`        ⚠ ${w}`));
  }
}

/* Nettoyage : anciennes pages de widgets (langue retirée, ancien nommage sans langue) */
for (const file of fs.readdirSync(OUT_DIR)) {
  if (!file.endsWith(".html") || file === "index.html" || expected.has(file)) continue;
  const owner = allIds.find(id => file === `${id}.html` || file.startsWith(`${id}-`));
  const isTarget = owner && targets.includes(owner) && !untouched.has(owner);
  const isOrphan = !owner && !requested.length;
  if (isTarget || isOrphan) {
    fs.unlinkSync(path.join(OUT_DIR, file));
    console.log(`🗑  docs/${file} supprimé (plus généré)`);
  }
}

buildIndex(allLangs);
console.log(failed ? `\n${failed} erreur(s), fichiers concernés non générés.` : "\nBuild terminé.");
process.exit(failed ? 1 : 0);
