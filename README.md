# ⚽ Squad Selector

Widget « compose ta sélection » réutilisable à chaque rassemblement, pour n'importe quel pays, site et langue.
Successeur de `wc26-squad-pickup` : même design, même fonctionnement (onglets par poste, terrain, image téléchargeable, partage X / Facebook / WhatsApp / Instagram, redimensionnement auto en iframe), mais un seul moteur commun au lieu d'un fichier HTML copié-collé par site.

## Structure

```
selectors/   un fichier JSON par widget : site, pays, règles, joueurs   ← ce qu'on modifie au quotidien
countries/   un JSON par pays : nom traduit dans chaque langue + nationalité SportMonks
sites/       un JSON par média : nom, thème (couleurs), largeur
locales/     textes de l'interface : en, es, fr, pt-BR
src/         template.html : le moteur commun (HTML + CSS + JS)
docs/        fichiers générés, un par widget et par langue : <widget>-<langue>.html (ne pas modifier à la main)
build.mjs    script de génération (Node, aucune dépendance)
```

## Mettre à jour une liste de joueurs

1. Modifier `selectors/<id>.json` (ex. `selectors/england-sportsmole.json`)
2. Lancer :
   ```bash
   node build.mjs england-sportsmole
   ```
   (`node build.mjs` sans argument régénère tout)
3. Publier le dossier `docs/`

Le build vérifie la config et refuse de générer en cas d'erreur : doublon de joueur, pas assez de joueurs pour un poste, règles impossibles, URL de photo invalide, texte manquant…

### Format d'un sélecteur

```json
{
  "site": "sportsmole",
  "country": "england",
  "rules": { "total": 26, "gk": [3,3], "def": [7,9], "mid": [6,9], "att": [7,9] },
  "players": {
    "gk":  ["Jordan Pickford", "Dean Henderson"],
    "def": [{ "name": "Marc Guéhi", "club": "Crystal Palace", "sportmonksId": 4536500, "photo": "https://cdn.sportmonks.com/..." }],
    "mid": [{ "name": "Vinícius Júnior", "displayName": "Vinicius Jr" }],
    "att": ["Harry Kane"]
  }
}
```

| Champ | Rôle |
|---|---|
| `site` | nom d'un fichier de `sites/` (thème + nom du média) |
| `country` | nom d'un fichier de `countries/` |
| `languages` | optionnel : limiter les langues générées, ex. `["fr", "en"]` (par défaut : toutes celles de `locales/`) |
| `rules` | taille de la liste et fourchette `[min, max]` par poste |
| `players` | un joueur = un nom, ou un objet avec `name` + options `displayName` (nom sur le terrain), `club` (affiché sous le nom), `sportmonksId`, `photo` (URL https, initiales en secours si l'image ne charge pas) |
| `text` | optionnel, par langue : `{ "fr": { "introTitle": "…" } }` remplace un texte pour ce widget seulement |
| `vars` | optionnel : remplace une couleur du thème pour ce widget seulement |

### Pays : `countries/<pays>.json`

```json
{
  "sportmonksNationalityId": 462,
  "en": { "name": "England" },
  "fr": { "name": "Angleterre", "of": "de l'Angleterre", "adj": "anglaise", "demonym": "anglais" },
  "es": { "name": "Inglaterra", "of": "de Inglaterra" },
  "pt-BR": { "name": "Inglaterra", "of": "da Inglaterra" }
}
```

`of` / `adj` / `demonym` sont les formes grammaticales utilisées dans les phrases (« Ma sélection **de l'Angleterre** », « la sélection **anglaise** », « les joueurs **anglais** »).

Les textes ne mentionnent aucune date ni aucun rassemblement : un widget reste valable d'une trêve à l'autre, seule la liste de joueurs change.

## Photos SportMonks

```bash
node fetch-photos.mjs england-sportsmole
```

- Token lu dans `.env` (`SPORTMONKS_API_TOKEN`, voir `.env.example`, fichier exclu de git).
- Le fichier pays doit indiquer la nationalité SportMonks : `"sportmonksNationalityId": 462` dans `countries/england.json` (716 = Nigeria).
- Binationaux : si le joueur n'existe que sous une autre nationalité chez SportMonks, il est pris s'il est unique et signalé « à vérifier ».
- Chaque joueur est cherché par nom, filtré par nationalité, en écartant les photos « placeholder ». Le script écrit `sportmonksId` + `photo` dans le JSON.
- **Homonymes** : le script n'écrit rien et liste les ids possibles avec les dates de naissance. Ajouter le bon `"sportmonksId"` au joueur puis relancer.
- Par défaut, seuls les joueurs sans photo ou sans id sont traités ; `--all` revérifie tout le monde.
- Relancer ensuite `node build.mjs <id>`.

## Ajouter un widget (nouveau pays ou nouveau site)

Copier un JSON de `selectors/` proche, le renommer `<pays>-<site>.json`, adapter. Si le pays est nouveau, créer aussi `countries/<pays>.json` (toutes les langues). Lancer le build : le widget est généré dans chaque langue.

## Ajouter un site

Créer `sites/<site>.json` :

```json
{
  "name": "Nom du média",
  "maxWidth": 800,
  "gridCols": "repeat(2,1fr)",
  "vars": { "--accent": "#e30613", "--accent-dark": "#b8050f" },
  "text": { "fr": { "introTitle": "⚠️ Texte propre à ce site" } }
}
```

Variables de thème disponibles (valeurs par défaut = thème clair rouge, voir `src/template.html`) :
`--bg --card --card-hover --card-selected --accent --accent-dark --accent-text --text --text-muted --heading --border --tab-active-bg --tab-active-border --tab-active-text --done-bg --done-text --validate --validate-hover --validate-disabled --initials-ring --photo-bg --pitch-green --pitch-dark --pos-gk --pos-def --pos-mid --pos-att`.
Exemple de thème sombre : `sites/afrikfoot.json`.

## Ajouter une langue

Copier `locales/en.json` en `locales/<code>.json` (ex. `it.json`) et traduire, puis ajouter la langue dans chaque fichier de `countries/`. Le build signale tout ce qui manque. Au build suivant, chaque widget est aussi généré dans cette langue. Variables utilisables dans les textes :
`{country} {countryOf} {countryAdj} {countryDemonym} {site} {total} {rules} {tabs}`.
`{rules}` (« 3 gardiens, 7 à 9 défenseurs… ») et `{tabs}` (« GB, DÉF, MIL et ATT ») sont générés à partir des règles, donc toujours à jour.

## Tester en local

```bash
node serve.mjs
```

Puis ouvrir http://localhost:8765 (le téléchargement d'image ne fonctionne pas en `file://`).

## Intégration WordPress (iframe)

Le widget envoie sa hauteur et demande l'URL de la page parente (pour les liens de partage) via `postMessage`.
Les anciens messages `wc2026-*` et `xilegende-*` sont toujours émis : les intégrations existantes continuent de marcher en changeant seulement l'URL de l'iframe.

```html
<iframe id="squad-selector-england" src="https://jcrochet-netizen.github.io/squad-selector/england-sportsmole-en.html"
        title="Pick your England squad" loading="lazy" scrolling="no"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        referrerpolicy="strict-origin-when-cross-origin"
        style="width:100%;border:0;display:block;height:1400px;overflow:hidden"></iframe>
<script>
(function () {
  var WIDGET_ORIGIN = "https://jcrochet-netizen.github.io";
  var f = document.getElementById("squad-selector-england");
  if (!f) return;
  function sendUrl() {
    try { f.contentWindow.postMessage({ type: "squad-selector-url", url: location.href }, WIDGET_ORIGIN); } catch (e) {}
  }
  f.addEventListener("load", sendUrl);
  window.addEventListener("message", function (e) {
    if (e.origin !== WIDGET_ORIGIN || e.source !== f.contentWindow || !e.data) return;
    if (e.data.type === "squad-selector-getUrl") sendUrl();
    if (e.data.type === "squad-selector-resize") {
      var h = parseInt(e.data.height, 10);
      if (h > 0 && h < 20000) { f.style.height = h + "px"; f.style.minHeight = "0"; }
    }
  });
})();
</script>
```

`height:1400px` n'est qu'une hauteur d'attente : dès le premier message, le script la remplace par la hauteur réelle du widget (et neutralise un éventuel `min-height` imposé par le thème WordPress), donc pas de vide blanc.

`sandbox` : chaque autorisation est nécessaire au widget, ne pas en retirer.
| Autorisation | Pourquoi |
|---|---|
| `allow-scripts` | le widget est en JavaScript |
| `allow-same-origin` | garde l'origine `jcrochet-netizen.github.io` : sans elle l'origine devient `null`, la vérification `e.origin` échoue (plus de redimensionnement ni d'URL de partage) et les photos ne passent plus en CORS pour l'image. Sans risque ici car l'iframe est sur un autre domaine que la page |
| `allow-popups` + `allow-popups-to-escape-sandbox` | fenêtres de partage X / Facebook / WhatsApp, qui doivent fonctionner normalement |
| `allow-downloads` | bouton « Télécharger l'image » |
| `allow-modals` | messages d'alerte (Instagram, erreurs) |

Non accordés volontairement : `allow-top-navigation`, `allow-forms`, `allow-pointer-lock`, etc.

Règles de sécurité (des deux côtés) :
- **Page parente** : origine du widget vérifiée (`e.origin`) + fenêtre émettrice vérifiée (`e.source`), URL envoyée uniquement à `WIDGET_ORIGIN` (jamais `"*"`), hauteur passée par `parseInt` et bornée.
- **Widget** : n'accepte que les messages de sa fenêtre parente directe et de son origine, n'accepte que des URL http(s), cible ses messages sortants sur l'origine de la page parente.
- Un `id` d'iframe différent par widget si plusieurs sont sur la même page.

## Publication (GitHub Pages)

Repo GitHub → Settings → Pages → *Deploy from a branch* → `main` / dossier `/docs`.
Les widgets sont alors servis à `https://jcrochet-netizen.github.io/squad-selector/<widget>-<langue>.html` (langue en minuscules : `en`, `es`, `fr`, `pt-br`), et `index.html` liste tous les widgets avec leurs langues.
