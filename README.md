# 7DS Origin Discord Bot Starter

Architecture recommandée:

- **Discord Interactions HTTP** pour éviter un bot Gateway 24/7
- **Cloudflare Workers** pour héberger gratuitement le point d entrée public
- **GitHub Actions** pour lancer le scraping toutes les 72 h environ
- **GitHub Pages** pour publier les fichiers JSON consommés par le bot

## Structure

- `src/index.ts` - bot Discord sur Cloudflare Workers
- `scripts/register-commands.mjs` - enregistre les slash commands
- `scripts/build_bot_data.py` - convertit les JSONL canoniques en JSON simples pour le bot
- `scripts/should_run.py` - garde-fou pour respecter 72 h
- `.github/workflows/update-data.yml` - refresh automatique
- `scraper/` - scraper V2 inclus
- `docs/data/` - données publiées sur GitHub Pages
- `SETUP_FR.md` - guide pas à pas en français
