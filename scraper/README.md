# 7DS Origin scraper v2

Scraper modulaire pour trois sources communautaires autour de **Seven Deadly Sins: Origin**:

- `https://7dsorigin.gg/`
- `https://www.hideoutgacha.com/games/seven-deadly-sins-origin`
- `https://genshin.gg/7dso/`

## Ce que fait la V2

La V2 ajoute trois couches utiles pour un bot:

1. **crawl brut** par site
2. **entités structurées** (`character`, `character_weapon_profile`, `skill`, `potential`, `weapon`, `banner`, `boss`, `guide`, `team_comp`, `resource_collection`)
3. **schéma canonique fusionné cross-source** avec rapport de couverture

## Couverture visée

### Personnages

- armes utilisables par personnage
- profils par type d'arme
- compétences par type d'arme
- potentiels par type d'arme
- icônes de type d'arme
- icônes de compétences lorsque l'alt/src est disponible
- image du personnage
- icône d'élément lorsque disponible
- stats de base si présentes

### Armes

- liste des armes
- type d'arme
- rareté
- attaque
- statistique secondaire
- description
- image

### Autres données

- bannières
- boss
- guides Hideout
- teams Hideout
- collections de base (`pets`, `fishing`, `items`, `foods`)
- carte interactive / compteurs lorsque présents

## Architecture

- `sds_origin_scraper/fetch.py`
  - HTTP standard via `httpx`
  - rendu navigateur optionnel via `Playwright`
  - cache léger avec checksum + `ETag` / `Last-Modified`
- `sds_origin_scraper/crawler.py`
  - crawl same-domain
  - découverte via `robots.txt` / `sitemap.xml`
- `sds_origin_scraper/parsers/`
  - parseurs spécialisés par source
- `sds_origin_scraper/merger.py`
  - fusion cross-source vers schéma canonique
- `sds_origin_scraper/report.py`
  - rapport de couverture de parsing
- `sds_origin_scraper/exporters.py`
  - export SQLite des couches brute + canonique

## Installation

### Sans rendu navigateur

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

### Avec rendu navigateur

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[browser]'
playwright install chromium
```

## Utilisation

### Tout crawler + merge + SQLite

```bash
7dso-scraper --site all --out data --sqlite
```

### Un seul site

```bash
7dso-scraper --site 7dsorigin --out data
7dso-scraper --site hideout --out data
7dso-scraper --site genshin --out data
```

### Forcer le rendu navigateur

```bash
7dso-scraper --site all --force-browser --out data --sqlite
```

### Sortie brute seulement

```bash
7dso-scraper --site all --raw-only --out data
```

## Sortie

```text
data/
  7dsorigin_gg/
    pages.jsonl
    entities.jsonl
    _fetch_state.json
  www_hideoutgacha_com/
    pages.jsonl
    entities.jsonl
    _fetch_state.json
  genshin_gg/
    pages.jsonl
    entities.jsonl
    _fetch_state.json
  all_pages.jsonl
  all_raw_entities.jsonl
  canonical/
    all.jsonl
    character.jsonl
    character_weapon_profile.jsonl
    weapon.jsonl
    banner.jsonl
    boss.jsonl
    guide.jsonl
    team_comp.jsonl
    resource_collection.jsonl
    coverage_report.json
  7dso_scrape.sqlite
```

## Remarques importantes

- La carte interactive et certains écrans très JS peuvent nécessiter **Playwright**.
- `7dsorigin.gg` et `genshin.gg` sont les meilleures sources pour **skills/potentials par arme**.
- `hideoutgacha.com` apporte surtout **guides**, **compos d'équipe**, **stats de base**, et **couples arme/élément**.
- Les collections `pets`, `fishing`, `items`, `foods` sont présentes dans le schéma même si le site les remplit partiellement.

## Limites actuelles

- Certaines pages ont des placeholders "coming soon". Le parseur les signale mais ne fabrique pas de données.
- Le merge cross-source est conservateur: priorité aux champs les plus riches, tout en gardant les sources d'origine.
- Le cache `ETag` / `Last-Modified` est léger: il aide au refresh incrémental mais ne remplace pas une vraie pipeline distribuée.

## Contenu du projet

- `README.md`
- `pyproject.toml`
- `sds_origin_scraper/`
  - `cli.py`
  - `crawler.py`
  - `exporters.py`
  - `fetch.py`
  - `merger.py`
  - `models.py`
  - `report.py`
  - `utils.py`
  - `parsers/`
    - `base.py`
    - `helpers.py`
    - `seven_ds_origin_gg.py`
    - `hideout_gacha.py`
    - `genshin_gg.py`

