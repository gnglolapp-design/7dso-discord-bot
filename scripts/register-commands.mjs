import "dotenv/config";

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_TOKEN;

if (!APP_ID || !TOKEN) {
  console.error("Missing DISCORD_APPLICATION_ID or DISCORD_TOKEN env vars");
  process.exit(1);
}

const commands = [
  { name: "perso", description: "Choisir un personnage et afficher ses infos" },
  { name: "armes", description: "Choisir un type d'arme puis une arme" },
  { name: "banniere", description: "Afficher les bannières" },
  { name: "boss", description: "Choisir un boss et afficher ses infos" },
  { name: "guides", description: "Choisir un guide (Hideout)" },
  { name: "compos", description: "Afficher les compositions d'équipes" },
  { name: "familiers", description: "Afficher les familiers (si disponibles)" },
  { name: "peche", description: "Afficher la pêche (si disponible)" },
  { name: "objet", description: "Afficher les objets (si disponibles)" },
  { name: "nourriture", description: "Afficher la nourriture (si disponible)" },
  { name: "map", description: "Lien vers la carte interactive" },
];

async function upsertGlobalCommands() {
  const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bot ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("Failed:", res.status, text);
    process.exit(1);
  }
  console.log("OK:", text);
}

upsertGlobalCommands();
