import nacl from 'tweetnacl';

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_TOKEN: string;
  DATA_BASE_URL: string;
  BOT_BRAND: string;
  MAP_URL: string;
}

type JsonRecord = Record<string, any>;

const cacheStore = new Map<string, { expiresAt: number; data: any }>();
const TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 5;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function verifyDiscordRequest(publicKey: string, signature: string, timestamp: string, body: string): boolean {
  const message = new TextEncoder().encode(timestamp + body);
  return nacl.sign.detached.verify(message, hexToBytes(signature), hexToBytes(publicKey));
}

async function fetchJson(env: Env, fileName: string): Promise<any[]> {
  const cached = cacheStore.get(fileName);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const base = env.DATA_BASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/${fileName}`);
  if (!response.ok) {
    throw new Error(`Impossible de charger ${fileName}: ${response.status}`);
  }
  const data = await response.json() as any[];
  cacheStore.set(fileName, { expiresAt: now + TTL_MS, data });
  return data;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' }
  });
}

function normalize(input: string | undefined | null): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function text(value: unknown): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ') || 'N/A';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function truncate(value: string, max = 1024): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function pickByName<T extends JsonRecord>(items: T[], query?: string, keys: string[] = ['name']): T[] {
  if (!query) return items;
  const q = normalize(query);
  return items.filter((item) => keys.some((key) => normalize(item[key]).includes(q)));
}

function optionValue(interaction: JsonRecord, optionName: string): string | undefined {
  const options = interaction.data?.options ?? [];
  const found = options.find((opt: JsonRecord) => opt.name === optionName);
  return found?.value;
}

function buildButtons(kind: string, page: number, total: number) {
  const components: JsonRecord[] = [];
  const row: JsonRecord = {
    type: 1,
    components: [] as JsonRecord[]
  };
  row.components.push({
    type: 2,
    style: 2,
    custom_id: `page:${kind}:${Math.max(page - 1, 0)}`,
    label: 'Précédent',
    disabled: page <= 0
  });
  row.components.push({
    type: 2,
    style: 2,
    custom_id: `page:${kind}:${Math.min(page + 1, total - 1)}`,
    label: 'Suivant',
    disabled: page >= total - 1
  });
  components.push(row);
  return components;
}

function embedResponse(embed: JsonRecord, components: JsonRecord[] = [], ephemeral = false): JsonRecord {
  return {
    type: 4,
    data: {
      flags: ephemeral ? 64 : 0,
      embeds: [embed],
      components
    }
  };
}

function listEmbed(title: string, items: JsonRecord[], page: number, formatter: (item: JsonRecord) => JsonRecord): JsonRecord {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const sliced = items.slice(start, start + PAGE_SIZE);
  return {
    title,
    description: items.length ? `Page ${page + 1}/${totalPages} - ${items.length} résultat(s)` : 'Aucun résultat.',
    fields: sliced.map(formatter).slice(0, 25)
  };
}

function flattenSkills(profiles: any[]): string {
  const lines: string[] = [];
  for (const profile of profiles || []) {
    const weaponType = profile.weapon_type || profile.weaponType || 'Arme inconnue';
    const skills = profile.skills || [];
    if (!skills.length) continue;
    lines.push(`**${weaponType}**`);
    for (const skill of skills.slice(0, 6)) {
      lines.push(`- ${skill.name || 'Compétence'} (${skill.skill_type || skill.kind || 'type inconnu'})`);
    }
  }
  return lines.join('\n') || 'Aucune compétence disponible.';
}

function flattenPotentials(profiles: any[]): string {
  const lines: string[] = [];
  for (const profile of profiles || []) {
    const weaponType = profile.weapon_type || profile.weaponType || 'Arme inconnue';
    const potentials = profile.potentials || [];
    if (!potentials.length) continue;
    const compact = potentials.slice(0, 5).map((p: JsonRecord) => `${p.tier || '?'}:${p.effect || p.description || '...'}`).join(' | ');
    lines.push(`**${weaponType}** ${compact}`);
  }
  return lines.join('\n') || 'Aucun potentiel disponible.';
}

async function autocomplete(env: Env, interaction: JsonRecord): Promise<Response> {
  const command = interaction.data?.name;
  const focused = (interaction.data?.options || []).find((opt: JsonRecord) => opt.focused === true);
  const query = focused?.value || '';
  let choices: { name: string; value: string }[] = [];

  if (command === 'perso') {
    const items = await fetchJson(env, 'characters.json');
    choices = pickByName(items, query, ['name', 'id']).slice(0, 25).map((item) => ({ name: item.name, value: item.name }));
  } else if (command === 'armes') {
    const items = await fetchJson(env, 'weapons.json');
    choices = pickByName(items, query, ['name', 'type']).slice(0, 25).map((item) => ({ name: item.name, value: item.name }));
  } else if (command === 'boss') {
    const items = await fetchJson(env, 'bosses.json');
    choices = pickByName(items, query, ['name']).slice(0, 25).map((item) => ({ name: item.name, value: item.name }));
  } else if (command === 'guides') {
    const items = await fetchJson(env, 'guides.json');
    const categories = Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort();
    choices = categories.filter((cat) => normalize(cat).includes(normalize(query))).slice(0, 25).map((cat) => ({ name: cat, value: cat }));
  }

  return json({ type: 8, data: { choices } });
}

async function handlePerso(env: Env, interaction: JsonRecord): Promise<Response> {
  const items = await fetchJson(env, 'characters.json');
  const query = optionValue(interaction, 'nom');
  const match = pickByName(items, query, ['name', 'aliases']).at(0);
  if (!match) {
    return json(embedResponse({ title: 'Personnage introuvable', description: 'Aucun personnage ne correspond à cette recherche.' }, [], true));
  }

  return json(embedResponse({
    title: match.name,
    description: truncate(match.description || 'Aucune description.'),
    thumbnail: match.image ? { url: match.image } : undefined,
    fields: [
      { name: 'Élément', value: text(match.element), inline: true },
      { name: 'Types d armes', value: truncate(text(match.weapon_types)), inline: true },
      { name: 'Stats de base', value: truncate(text(match.base_stats), 1024), inline: false },
      { name: 'Compétences', value: truncate(flattenSkills(match.weapon_profiles), 1024), inline: false },
      { name: 'Potentiels', value: truncate(flattenPotentials(match.weapon_profiles), 1024), inline: false }
    ].filter(Boolean)
  }));
}

async function handlePagedList(env: Env, fileName: string, title: string, formatter: (item: JsonRecord) => JsonRecord, page = 0, filter?: string): Promise<Response> {
  const items = await fetchJson(env, fileName);
  const filtered = filter ? pickByName(items, filter, ['name', 'type', 'category']) : items;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const embed = listEmbed(title, filtered, safePage, formatter);
  const kind = fileName.replace('.json', '');
  return json(embedResponse(embed, buildButtons(kind, safePage, totalPages)));
}

async function handleGuides(env: Env, interaction: JsonRecord): Promise<Response> {
  const items = await fetchJson(env, 'guides.json');
  const category = optionValue(interaction, 'categorie');
  const filtered = category ? items.filter((item) => normalize(item.category) === normalize(category)) : items;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const embed = listEmbed('Guides', filtered, 0, (item) => ({
    name: item.name || 'Guide',
    value: truncate(`${item.category || 'Sans catégorie'}\n${item.description || item.summary || 'Sans résumé.'}`)
  }));
  return json(embedResponse(embed, buildButtons('guides', 0, totalPages)));
}

async function handleMap(env: Env): Promise<Response> {
  return json({
    type: 4,
    data: {
      embeds: [{
        title: 'Carte interactive',
        description: 'Discord ne peut pas afficher la carte interactive telle quelle dans un message de bot. J envoie donc un lien direct vers la carte.'
      }],
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: 'Ouvrir la carte',
          url: env.MAP_URL
        }]
      }]
    }
  });
}

async function handleComponent(env: Env, interaction: JsonRecord): Promise<Response> {
  const customId = interaction.data?.custom_id || '';
  const [, kind, pageStr] = customId.split(':');
  const page = Number(pageStr || '0');

  const mapping: Record<string, { fileName: string; title: string; formatter: (item: JsonRecord) => JsonRecord }> = {
    weapons: {
      fileName: 'weapons.json',
      title: 'Armes',
      formatter: (item) => ({ name: item.name || 'Arme', value: truncate(`Type: ${text(item.type)}\nRareté: ${text(item.rarity)}\nATK: ${text(item.attack)}\nStat secondaire: ${text(item.secondary_stat)}\n${item.image ? item.image : ''}`) })
    },
    banners: {
      fileName: 'banners.json',
      title: 'Bannières',
      formatter: (item) => ({ name: item.name || 'Bannière', value: truncate(`Statut: ${text(item.status)}\nDates: ${text(item.date_range || item.dates)}\n${text(item.description)}`) })
    },
    bosses: {
      fileName: 'bosses.json',
      title: 'Boss',
      formatter: (item) => ({ name: item.name || 'Boss', value: truncate(`${text(item.description)}\n${item.image ? item.image : ''}`) })
    },
    guides: {
      fileName: 'guides.json',
      title: 'Guides',
      formatter: (item) => ({ name: item.name || 'Guide', value: truncate(`${text(item.category)}\n${text(item.description || item.summary)}`) })
    },
    team_comps: {
      fileName: 'team_comps.json',
      title: 'Compositions d équipes',
      formatter: (item) => ({ name: item.name || 'Composition', value: truncate(`${text(item.description)}\nMembres: ${text(item.members)}`) })
    },
    familiers: {
      fileName: 'familiers.json',
      title: 'Familiers',
      formatter: (item) => ({ name: item.name || 'Familier', value: truncate(text(item.description)) })
    },
    peche: {
      fileName: 'peche.json',
      title: 'Pêche',
      formatter: (item) => ({ name: item.name || 'Pêche', value: truncate(text(item.description)) })
    },
    objets: {
      fileName: 'objets.json',
      title: 'Objets',
      formatter: (item) => ({ name: item.name || 'Objet', value: truncate(text(item.description)) })
    },
    nourriture: {
      fileName: 'nourriture.json',
      title: 'Nourriture',
      formatter: (item) => ({ name: item.name || 'Nourriture', value: truncate(text(item.description)) })
    }
  };

  const entry = mapping[kind];
  if (!entry) {
    return json({ type: 7, data: { content: 'Pagination inconnue.', flags: 64 } });
  }

  const items = await fetchJson(env, entry.fileName);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const embed = listEmbed(entry.title, items, safePage, entry.formatter);
  return json({ type: 7, data: { embeds: [embed], components: buildButtons(kind, safePage, totalPages) } });
}

async function handleCommand(env: Env, interaction: JsonRecord): Promise<Response> {
  const command = interaction.data?.name;

  if (command === 'perso') return handlePerso(env, interaction);
  if (command === 'armes') return handlePagedList(env, 'weapons.json', 'Armes', (item) => ({
    name: item.name || 'Arme',
    value: truncate(`Type: ${text(item.type)}\nRareté: ${text(item.rarity)}\nATK: ${text(item.attack)}\nStat secondaire: ${text(item.secondary_stat)}\n${item.image ? item.image : ''}`)
  }), 0, optionValue(interaction, 'nom'));
  if (command === 'banniere') return handlePagedList(env, 'banners.json', 'Bannières', (item) => ({
    name: item.name || 'Bannière',
    value: truncate(`Statut: ${text(item.status)}\nDates: ${text(item.date_range || item.dates)}\n${text(item.description)}`)
  }));
  if (command === 'boss') return handlePagedList(env, 'bosses.json', 'Boss', (item) => ({
    name: item.name || 'Boss',
    value: truncate(`${text(item.description)}\n${item.image ? item.image : ''}`)
  }), 0, optionValue(interaction, 'nom'));
  if (command === 'guides') return handleGuides(env, interaction);
  if (command === 'compos') return handlePagedList(env, 'team_comps.json', 'Compositions d équipes', (item) => ({
    name: item.name || 'Composition',
    value: truncate(`${text(item.description)}\nMembres: ${text(item.members)}`)
  }));
  if (command === 'familiers') return handlePagedList(env, 'familiers.json', 'Familiers', (item) => ({ name: item.name || 'Familier', value: truncate(text(item.description)) }));
  if (command === 'peche') return handlePagedList(env, 'peche.json', 'Pêche', (item) => ({ name: item.name || 'Pêche', value: truncate(text(item.description)) }));
  if (command === 'objet') return handlePagedList(env, 'objets.json', 'Objets', (item) => ({ name: item.name || 'Objet', value: truncate(text(item.description)) }));
  if (command === 'nourriture') return handlePagedList(env, 'nourriture.json', 'Nourriture', (item) => ({ name: item.name || 'Nourriture', value: truncate(text(item.description)) }));
  if (command === 'map') return handleMap(env);

  return json(embedResponse({ title: 'Commande inconnue', description: `Commande non gérée: ${command}` }, [], true));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('7DS Origin Discord Worker OK');
    }

    if (request.method !== 'POST' || url.pathname !== '/interactions') {
      return new Response('Not found', { status: 404 });
    }

    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    if (!signature || !timestamp) {
      return new Response('Bad request signature', { status: 401 });
    }

    const body = await request.text();
    const isValid = verifyDiscordRequest(env.DISCORD_PUBLIC_KEY, signature, timestamp, body);
    if (!isValid) {
      return new Response('Invalid request signature', { status: 401 });
    }

    const interaction = JSON.parse(body);

    if (interaction.type === 1) {
      return json({ type: 1 });
    }

    if (interaction.type === 4) {
      return autocomplete(env, interaction);
    }

    if (interaction.type === 3) {
      return handleComponent(env, interaction);
    }

    if (interaction.type === 2) {
      return handleCommand(env, interaction);
    }

    return json(embedResponse({ title: 'Type non géré', description: `Interaction type ${interaction.type}` }, [], true));
  }
};
