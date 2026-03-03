# Guide complet - 7DS Origin Bot Discord gratuit

## Ce que fait cette base

- crée un bot Discord sans machine allumée chez toi
- ne demande pas d hébergement payant
- met à jour les données via GitHub Actions
- sert les commandes via Cloudflare Workers
- publie les fichiers JSON via GitHub Pages

## Commandes prévues

- `/perso nom:<nom>`
- `/armes [nom]`
- `/banniere`
- `/boss [nom]`
- `/guides [categorie]`
- `/compos`
- `/familiers`
- `/peche`
- `/objet`
- `/nourriture`
- `/map`

## 1. Prérequis à créer

### Comptes

Crée ces comptes si tu ne les as pas:

- GitHub
- Cloudflare
- Discord Developer Portal

## 2. Créer le dépôt GitHub

1. Va sur GitHub.
2. Crée un **repository public**.
3. Nom recommandé: `7dso-discord-bot`.

### Pourquoi public

Le workflow de scraping sera plus simple et le plan gratuit GitHub Actions pour dépôt public est le plus confortable.

## 3. Mettre les fichiers dans le dépôt

### Option simple

Dézippe cette archive puis copie tout dans ton dépôt Git local.

### PowerShell

```powershell
cd C:\Users\TON_NOM\Desktop
Expand-Archive .\7dso_discord_bot_starter.zip .\7dso_discord_bot_starter
cd .\7dso_discord_bot_starter
```

Initialise Git si besoin:

```powershell
git init
git branch -M main
git remote add origin https://github.com<TON_USER>/7dso-discord-bot.git
```

Premier push:

```powershell
git add .
git commit -m "Initial bot starter"
git push -u origin main
```

## 4. Activer GitHub Pages

Dans le repo GitHub:

1. `Settings`
2. `Pages`
3. `Build and deployment`
4. Source: `Deploy from a branch`
5. Branch: `main`
6. Folder: `/docs`
7. Save

Tu auras ensuite une URL du type:

`https://TON_USER.github.io/7dso-discord-bot/`

## 5. Créer le bot dans Discord

1. Va sur le portail développeur Discord.
2. Crée une application.
3. Va dans l onglet `Bot`.
4. Clique sur `Reset Token` ou `Copy Token`.
5. Garde le token de côté.
6. Sur `General Information`, récupère:
   - `Application ID`
   - `Public Key`

## 6. Installer le bot sur ton serveur

Dans Discord Developer Portal:

1. Onglet `Installation`
2. Garde le lien d installation fourni par Discord ou configure le lien par défaut
3. Installe l application sur ton serveur de test

## 7. Déployer le Worker Cloudflare

### Installer Node.js

Télécharge Node.js LTS:

- https://nodejs.org/

### Installer les dépendances

```powershell
cd C:\Users\TON_NOM\Desktop\7dso_discord_bot_starter
npm install
```

### Se connecter à Cloudflare

```powershell
npx wrangler login
```

### Modifier `wrangler.jsonc`

Remplace dans `wrangler.jsonc`:

- `YOUR_GITHUB_USERNAME`
- `YOUR_REPO_NAME`

Exemple:

```json
"DATA_BASE_URL": "https://monuser.github.io/7dso-discord-bot/data"
```

### Déployer

```powershell
npx wrangler deploy
```

À la fin, tu auras une URL du type:

`https://7dso-discord-bot.<ton-subdomain>.workers.dev`

## 8. Ajouter les secrets Cloudflare du bot

Dans ton dossier projet:

```powershell
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_TOKEN
```

Wrangler te demandera chaque valeur.

## 9. Configurer l URL d interactions Discord

Dans Discord Developer Portal:

1. `General Information`
2. `Interaction Endpoint URL`
3. colle:

```text
https://7dso-discord-bot.<ton-subdomain>.workers.dev/interactions
```

4. Sauvegarde

Si tout est correct, Discord validera automatiquement l endpoint.

## 10. Enregistrer les slash commands

Dans PowerShell:

```powershell
$env:DISCORD_APPLICATION_ID="TON_APP_ID"
$env:DISCORD_TOKEN="TON_BOT_TOKEN"
npm run register
```

## 11. Activer GitHub Actions

Dans ton repo GitHub:

1. Ouvre l onglet `Actions`
2. Active les workflows si GitHub te le demande
3. Lance manuellement `update-7dso-data` une première fois

## 12. Ce que fait le workflow

Le workflow:

1. vérifie si 72 h sont passées
2. lance le scraper si oui
3. reconstruit les JSON simplifiés pour le bot
4. commit les nouvelles données dans le dépôt
5. GitHub Pages republie automatiquement les JSON

## 13. Fichiers que tu modifies le plus souvent

### `wrangler.jsonc`

- URL de base des données
- nom du worker
- URL de la map

### `src/index.ts`

- rendu des embeds
- pagination
- logique de recherche
- texte des réponses

### `scripts/register-commands.mjs`

- noms des commandes
- options de commande
- descriptions

### `.github/workflows/update-data.yml`

- fréquence du déclenchement planifié
- nombre max de pages crawlées

## 14. Modifications courantes avec PowerShell

### Ouvrir le projet dans VS Code

```powershell
code C:\Users\TON_NOM\Desktop\7dso_discord_bot_starter
```

### Commit et push après modification

```powershell
cd C:\Users\TON_NOM\Desktop\7dso_discord_bot_starter
git add .
git commit -m "Update bot"
git push
```

### Redéployer le Worker après changement du code bot

```powershell
cd C:\Users\TON_NOM\Desktop\7dso_discord_bot_starter
npx wrangler deploy
```

### Réenregistrer les commandes après changement dans `register-commands.mjs`

```powershell
cd C:\Users\TON_NOM\Desktop\7dso_discord_bot_starter
$env:DISCORD_APPLICATION_ID="TON_APP_ID"
$env:DISCORD_TOKEN="TON_BOT_TOKEN"
npm run register
```

## 15. Limite importante sur `/map`

Le bot envoie un **lien** vers la map. Il ne peut pas afficher la carte interactive complète directement dans un message Discord normal.

## 16. Conseils immédiats

- teste d abord le bot sur un serveur privé
- lance une première mise à jour GitHub Actions manuellement
- vérifie ensuite `docs/data/characters.json`
- teste `/perso` puis `/armes`

## 17. Ordre exact conseillé

1. push le dépôt
2. active GitHub Pages
3. déploie le Worker Cloudflare
4. ajoute les secrets Cloudflare
5. configure l endpoint Discord
6. enregistre les commandes
7. lance le workflow GitHub manuellement
8. teste dans Discord
