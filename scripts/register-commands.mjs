const APP_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_TOKEN;

if (!APP_ID || !TOKEN) {
  console.error('DISCORD_APPLICATION_ID et DISCORD_TOKEN sont requis.');
  process.exit(1);
}

const commands = [
  {
    name: 'perso',
    description: 'Affiche les données d un personnage',
    options: [
      {
        name: 'nom',
        description: 'Nom du personnage',
        type: 3,
        required: true,
        autocomplete: true
      }
    ]
  },
  {
    name: 'armes',
    description: 'Affiche les armes disponibles',
    options: [
      {
        name: 'nom',
        description: 'Filtrer par nom d arme',
        type: 3,
        required: false,
        autocomplete: true
      }
    ]
  },
  {
    name: 'banniere',
    description: 'Affiche les bannières'
  },
  {
    name: 'boss',
    description: 'Affiche les informations sur les boss',
    options: [
      {
        name: 'nom',
        description: 'Filtrer par nom de boss',
        type: 3,
        required: false,
        autocomplete: true
      }
    ]
  },
  {
    name: 'guides',
    description: 'Affiche les guides par catégorie',
    options: [
      {
        name: 'categorie',
        description: 'Catégorie du guide',
        type: 3,
        required: false,
        autocomplete: true
      }
    ]
  },
  {
    name: 'compos',
    description: 'Affiche les compositions d équipes'
  },
  {
    name: 'familiers',
    description: 'Affiche les données des familiers'
  },
  {
    name: 'peche',
    description: 'Affiche les données de la pêche'
  },
  {
    name: 'objet',
    description: 'Affiche les données des objets'
  },
  {
    name: 'nourriture',
    description: 'Affiche les données de la nourriture'
  },
  {
    name: 'map',
    description: 'Affiche le lien de la carte interactive'
  }
];

const response = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(commands)
});

const text = await response.text();
console.log(response.status, text);

if (!response.ok) {
  process.exit(1);
}
