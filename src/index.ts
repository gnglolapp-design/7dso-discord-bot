import nacl from "tweetnacl";

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

const SELECT_PAGE_SIZE = 25; // limite Discord
const LIST_PAGE_SIZE = 5;    // embed list page size

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function verifyDiscordRequest(publicKey: string, signature: string, timestamp: string, body: string): boolean {
  const message = new TextEncoder().encode(timestamp + body);
  return nacl.sign.detached.verify(message, hexToBytes(signature), hexToBytes(publicKey));
}

async function fetchJson(env: Env, fileName: string): Promise<any[]> {
  const cached = cacheStore.get(fileName);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  const base = (env.DATA_BASE_URL || "").replace(/\/$/, "");
  const res = await fetch(`${base}/${fileName}`, { cf: { cacheTtl: 60, cacheEverything: true } as any });
  if (!res.ok) throw new Error(`Impossible de charger ${fileName}: ${res.status}`);
  const data = (await res.json()) as any[];
  cacheStore.set(fileName, { expiresAt: now + TTL_MS, data });
  return data;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=UTF-8" } });
}

function normalize(input: unknown): string {
  if (input === null || input === undefined) return "";
  let value: string;
  if (typeof input === "string") value = input;
  else if (Array.isArray(input)) value = input.join(" ");
  else if (typeof input === "object") value = JSON.stringify(input);
  else value = String(input);

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "N/A";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(", ") || "N/A";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function truncate(v: string, max = 1024): string {
  return v.length <= max ? v : `${v.slice(0, max - 3)}...`;
}

function pickFirstByName<T extends JsonRecord>(items: T[], query?: string, keys: string[] = ["name"]): T | undefined {
  if (!query) return undefined;
  const q = normalize(query);
  return items.find((item) => keys.some((k) => normalize(item[k]).includes(q)));
}

function optionValue(interaction: JsonRecord, optionName: string): string | undefined {
  const options = interaction.data?.options ?? [];
  const found = options.find((opt: JsonRecord) => opt.name === optionName);
  return found?.value;
}

function actionRow(components: JsonRecord[]): JsonRecord {
  return { type: 1, components };
}

function button(custom_id: string, label: string, disabled = false, style: number = 2): JsonRecord {
  return { type: 2, style, custom_id, label, disabled };
}

function linkButton(url: string, label: string): JsonRecord {
  return { type: 2, style: 5, url, label };
}

function selectMenu(custom_id: string, placeholder: string, options: { label: string; value: string; description?: string }[]): JsonRecord {
  return {
    type: 3,
    custom_id,
    placeholder,
    min_values: 1,
    max_values: 1,
    options: options.slice(0, 25),
  };
}

function embedResponse(embed: JsonRecord, components: JsonRecord[] = [], ephemeral = false): JsonRecord {
  return {
    type: 4,
    data: {
      flags: ephemeral ? 64 : 0,
      embeds: [embed],
      components,
    },
  };
}

function updateMessage(embed: JsonRecord, components: JsonRecord[] = [], ephemeral = false): JsonRecord {
  return {
    type: 7,
    data: {
      flags: ephemeral ? 64 : 0,
      embeds: [embed],
      components,
    },
  };
}

function simpleMessage(content: string, ephemeral = false): JsonRecord {
  return { type: 4, data: { content, flags: ephemeral ? 64 : 0 } };
}

function updateSimple(content: string, ephemeral = false): JsonRecord {
  return { type: 7, data: { content, flags: ephemeral ? 64 : 0, embeds: [], components: [] } };
}

function listEmbed(title: string, items: JsonRecord[], page: number, formatter: (item: JsonRecord) => JsonRecord): JsonRecord {
  const totalPages = Math.max(1, Math.ceil(items.length / LIST_PAGE_SIZE));
  const start = page * LIST_PAGE_SIZE;
  const sliced = items.slice(start, start + LIST_PAGE_SIZE);
  return {
    title,
    description: items.length ? `Page ${page + 1}/${totalPages} - ${items.length} résultat(s)` : "Aucun résultat.",
    fields: sliced.map(formatter).slice(0, 25),
  };
}

function buildListPager(kind: string, page: number, totalPages: number): JsonRecord[] {
  return [
    actionRow([
      button(`page:${kind}:${Math.max(page - 1, 0)}`, "Précédent", page <= 0),
      button(`page:${kind}:${Math.min(page + 1, totalPages - 1)}`, "Suivant", page >= totalPages - 1),
    ]),
  ];
}

function chunkForSelect<T>(items: T[], page: number): { totalPages: number; slice: T[] } {
  const totalPages = Math.max(1, Math.ceil(items.length / SELECT_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * SELECT_PAGE_SIZE;
  return { totalPages, slice: items.slice(start, start + SELECT_PAGE_SIZE) };
}

/* -------------------- PERSO -------------------- */

function buildPersoTabs(charId: string, tab: string): JsonRecord[] {
  return [
    actionRow([
      button(`perso:tab:${charId}:home`, "Accueil", tab === "home", 2),
      button(`perso:tab:${charId}:stats`, "Stats", tab === "stats", 2),
      button(`perso:tab:${charId}:skills`, "Armes & Skills", tab === "skills", 2),
      button(`perso:tab:${charId}:pots`, "Potentiels", tab === "pots", 2),
      button(`perso:tab:${charId}:costumes`, "Costumes", tab === "costumes", 2),
    ]),
    actionRow([button(`perso:back`, "Retour au menu", false, 2)]),
  ];
}

function flattenSkills(profiles: any[]): string {
  const lines: string[] = [];
  for (const profile of profiles || []) {
    const weaponType = profile.weapon_type || profile.weaponType || "Arme inconnue";
    const skills = profile.skills || [];
    lines.push(`**${weaponType}**`);
    if (!skills.length) {
      lines.push("- (aucune compétence)");
      continue;
    }
    for (const s of skills.slice(0, 12)) {
      const kind = s.skill_type || s.kind || "type";
      lines.push(`- ${s.name || "Compétence"} (${kind})`);
    }
  }
  return lines.join("\n");
}

function flattenPotentials(profiles: any[]): string {
  const lines: string[] = [];
  for (const profile of profiles || []) {
    const weaponType = profile.weapon_type || profile.weaponType || "Arme inconnue";
    const pots = profile.potentials || [];
    lines.push(`**${weaponType}**`);
    if (!pots.length) {
      lines.push("- (aucun potentiel)");
      continue;
    }
    for (const p of pots.slice(0, 10)) {
      lines.push(`- T${p.tier ?? "?"}: ${p.effect || p.description || "..."}`);
    }
  }
  return lines.join("\n");
}

function buildPersoEmbed(match: JsonRecord, tab: string): JsonRecord {
  const base = {
    title: match.name || "Personnage",
    thumbnail: match.image ? { url: match.image } : undefined,
  } as JsonRecord;

  if (tab === "stats") {
    return {
      ...base,
      description: "Statistiques",
      fields: [
        { name: "Élément", value: text(match.element), inline: true },
        { name: "Types d'armes", value: truncate(text(match.weapon_types)), inline: true },
        { name: "Stats de base", value: truncate(text(match.base_stats), 1024), inline: false },
      ],
    };
  }

  if (tab === "skills") {
    const desc = flattenSkills(match.weapon_profiles || []);
    return {
      ...base,
      description: truncate(desc || "Aucune compétence disponible.", 4096),
    };
  }

  if (tab === "pots") {
    const desc = flattenPotentials(match.weapon_profiles || []);
    return {
      ...base,
      description: truncate(desc || "Aucun potentiel disponible.", 4096),
    };
  }

  if (tab === "costumes") {
    const costumes = match.costumes || match.skins || [];
    const lines = (costumes || []).slice(0, 30).map((c: any) => `- ${c.name || c.title || "Costume"}`);
    return {
      ...base,
      description: lines.length ? truncate(lines.join("\n"), 4096) : "Non disponible.",
    };
  }

  // home
  return {
    ...base,
    description: truncate(match.description || "Aucune description.", 4096),
    fields: [
      { name: "Élément", value: text(match.element), inline: true },
      { name: "Types d'armes", value: truncate(text(match.weapon_types)), inline: true },
    ],
  };
}

async function showPersoMenu(env: Env, page = 0): Promise<Response> {
  const chars = await fetchJson(env, "characters.json");
  const sorted = [...chars].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const { totalPages, slice } = chunkForSelect(sorted, page);

  const options = slice.map((c: any) => ({
    label: (c.name || "Perso").slice(0, 100),
    value: String(c.id || c.name),
    description: (c.element ? `Élément: ${c.element}` : undefined),
  }));

  const embed = {
    title: "Choisir un personnage",
    description: `Page ${page + 1}/${totalPages}`,
  };

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:perso:${page}`, "Sélectionner un personnage", options)]),
    actionRow([
      button(`selpage:perso:${Math.max(page - 1, 0)}`, "Précédent", page <= 0),
      button(`selpage:perso:${Math.min(page + 1, totalPages - 1)}`, "Suivant", page >= totalPages - 1),
    ]),
  ];

  return json(embedResponse(embed, components));
}

async function showPersoCard(env: Env, charIdOrName: string, tab: string): Promise<Response> {
  const chars = await fetchJson(env, "characters.json");
  const match =
    chars.find((c: any) => String(c.id) === charIdOrName) ||
    chars.find((c: any) => normalize(c.name) === normalize(charIdOrName)) ||
    pickFirstByName(chars, charIdOrName, ["name", "id", "aliases"]);

  if (!match) return json(simpleMessage("Personnage introuvable.", true));

  const charId = String(match.id || match.name);
  const embed = buildPersoEmbed(match, tab);
  const components = buildPersoTabs(charId, tab);

  return json(updateMessage(embed, components));
}

/* -------------------- ARMES -------------------- */

async function showWeaponTypes(env: Env): Promise<Response> {
  const weapons = await fetchJson(env, "weapons.json");
  const types = Array.from(new Set(weapons.map((w: any) => w.type).filter(Boolean))).sort((a, b) => normalize(a).localeCompare(normalize(b)));

  if (!types.length) return json(simpleMessage("Pas d'informations pour l'instant.", true));

  const options = types.slice(0, 25).map((t: any) => ({ label: String(t).slice(0, 100), value: String(t) }));
  const embed = { title: "Choisir un type d'arme", description: "Sélectionne une catégorie d'arme." };

  const components = [actionRow([selectMenu("sel:wtype", "Type d'arme", options)])];
  return json(embedResponse(embed, components));
}

async function showWeaponsOfType(env: Env, weaponType: string, page = 0): Promise<Response> {
  const weapons = await fetchJson(env, "weapons.json");
  const filtered = weapons.filter((w: any) => normalize(w.type) === normalize(weaponType));
  const sorted = [...filtered].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));

  if (!sorted.length) return json(updateSimple("Aucune arme pour ce type.", true));

  const { totalPages, slice } = chunkForSelect(sorted, page);
  const options = slice.map((w: any) => ({
    label: (w.name || "Arme").slice(0, 100),
    value: String(w.id || w.name),
    description: (w.rarity ? `Rareté: ${w.rarity}` : undefined),
  }));

  const embed = { title: `Armes - ${weaponType}`, description: `Page ${page + 1}/${totalPages}` };

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:weapon:${weaponType}:${page}`, "Choisir une arme", options)]),
    actionRow([
      button(`selpage:weapon:${weaponType}:${Math.max(page - 1, 0)}`, "Précédent", page <= 0),
      button(`selpage:weapon:${weaponType}:${Math.min(page + 1, totalPages - 1)}`, "Suivant", page >= totalPages - 1),
      button("weapons:backtypes", "Retour types", false, 2),
    ]),
  ];

  return json(updateMessage(embed, components));
}

async function showWeaponCard(env: Env, weaponIdOrName: string): Promise<Response> {
  const weapons = await fetchJson(env, "weapons.json");
  const match =
    weapons.find((w: any) => String(w.id) === weaponIdOrName) ||
    weapons.find((w: any) => normalize(w.name) === normalize(weaponIdOrName)) ||
    pickFirstByName(weapons, weaponIdOrName, ["name", "id", "type"]);

  if (!match) return json(updateSimple("Arme introuvable.", true));

  const embed: JsonRecord = {
    title: match.name || "Arme",
    thumbnail: match.image ? { url: match.image } : undefined,
    fields: [
      { name: "Type", value: text(match.type), inline: true },
      { name: "Rareté", value: text(match.rarity), inline: true },
      { name: "ATK", value: text(match.attack), inline: true },
      { name: "Stat secondaire", value: text(match.secondary_stat), inline: true },
      { name: "Effet", value: truncate(text(match.description || match.effect || "N/A"), 1024), inline: false },
    ],
  };

  const components: JsonRecord[] = [
    actionRow([button("weapons:backtypes", "Retour types", false, 2)]),
  ];

  return json(updateMessage(embed, components));
}

/* -------------------- BOSS -------------------- */

async function showBossMenu(env: Env, page = 0): Promise<Response> {
  const bosses = await fetchJson(env, "bosses.json");
  const sorted = [...bosses].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const { totalPages, slice } = chunkForSelect(sorted, page);

  if (!sorted.length) return json(simpleMessage("Pas d'informations pour l'instant.", true));

  const options = slice.map((b: any) => ({
    label: (b.name || "Boss").slice(0, 100),
    value: String(b.id || b.name),
  }));

  const embed = { title: "Choisir un boss", description: `Page ${page + 1}/${totalPages}` };

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:boss:${page}`, "Sélectionner un boss", options)]),
    actionRow([
      button(`selpage:boss:${Math.max(page - 1, 0)}`, "Précédent", page <= 0),
      button(`selpage:boss:${Math.min(page + 1, totalPages - 1)}`, "Suivant", page >= totalPages - 1),
    ]),
  ];

  return json(embedResponse(embed, components));
}

async function showBossCard(env: Env, bossIdOrName: string): Promise<Response> {
  const bosses = await fetchJson(env, "bosses.json");
  const match =
    bosses.find((b: any) => String(b.id) === bossIdOrName) ||
    bosses.find((b: any) => normalize(b.name) === normalize(bossIdOrName)) ||
    pickFirstByName(bosses, bossIdOrName, ["name", "id"]);

  if (!match) return json(updateSimple("Boss introuvable.", true));

  const stats = match.stats || match.base_stats || match.attributes || null;

  const embed: JsonRecord = {
    title: match.name || "Boss",
    thumbnail: match.image ? { url: match.image } : undefined,
    fields: [
      { name: "Description", value: truncate(text(match.description || "N/A"), 1024), inline: false },
      { name: "Stats", value: stats ? truncate(text(stats), 1024) : "Non disponible.", inline: false },
    ],
  };

  return json(updateMessage(embed, [actionRow([button("boss:back", "Retour", false, 2)])]));
}

/* -------------------- GUIDES -------------------- */

async function showGuideCategories(env: Env): Promise<Response> {
  const guides = await fetchJson(env, "guides.json");
  if (!guides.length) return json(simpleMessage("Pas d'informations pour l'instant.", true));

  const cats = Array.from(new Set(guides.map((g: any) => g.category).filter(Boolean)))
    .sort((a, b) => normalize(a).localeCompare(normalize(b)));

  const options = cats.slice(0, 25).map((c: any) => ({ label: String(c).slice(0, 100), value: String(c) }));
  const embed = { title: "Guides", description: "Choisir une catégorie" };

  return json(embedResponse(embed, [actionRow([selectMenu("sel:guidecat", "Catégorie", options)])]));
}

async function showGuidesInCategory(env: Env, category: string, page = 0): Promise<Response> {
  const guides = await fetchJson(env, "guides.json");
  const filtered = guides.filter((g: any) => normalize(g.category) === normalize(category));
  const sorted = [...filtered].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));

  if (!sorted.length) return json(updateSimple("Aucun guide dans cette catégorie.", true));

  const { totalPages, slice } = chunkForSelect(sorted, page);
  const options = slice.map((g: any) => ({
    label: (g.name || "Guide").slice(0, 100),
    value: String(g.id || g.name),
    description: g.summary ? String(g.summary).slice(0, 100) : undefined,
  }));

  const embed = { title: `Guides - ${category}`, description: `Page ${page + 1}/${totalPages}` };

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:guide:${category}:${page}`, "Choisir un guide", options)]),
    actionRow([
      button(`selpage:guide:${category}:${Math.max(page - 1, 0)}`, "Précédent", page <= 0),
      button(`selpage:guide:${category}:${Math.min(page + 1, totalPages - 1)}`, "Suivant", page >= totalPages - 1),
      button("guides:backcat", "Retour catégories", false, 2),
    ]),
  ];

  return json(updateMessage(embed, components));
}

async function showGuideCard(env: Env, guideIdOrName: string): Promise<Response> {
  const guides = await fetchJson(env, "guides.json");
  const match =
    guides.find((g: any) => String(g.id) === guideIdOrName) ||
    guides.find((g: any) => normalize(g.name) === normalize(guideIdOrName)) ||
    pickFirstByName(guides, guideIdOrName, ["name", "id"]);

  if (!match) return json(updateSimple("Guide introuvable.", true));

  const embed: JsonRecord = {
    title: match.name || "Guide",
    description: truncate(text(match.content || match.description || match.summary || "N/A"), 4096),
    fields: [{ name: "Catégorie", value: text(match.category || "N/A"), inline: true }],
  };

  return json(updateMessage(embed, [actionRow([button("guides:backcat", "Retour catégories", false, 2)])]));
}

/* -------------------- COMPOS -------------------- */

async function showComposList(env: Env, page = 0): Promise<Response> {
  const comps = await fetchJson(env, "team_comps.json");
  const sorted = [...comps].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));

  if (!sorted.length) return json(simpleMessage("Pas d'informations pour l'instant.", true));

  const { totalPages, slice } = chunkForSelect(sorted, page);
  const options = slice.map((c: any) => ({
    label: (c.name || "Composition").slice(0, 100),
    value: String(c.id || c.name),
  }));

  const embed = { title: "Compositions d'équipes", description: `Page ${page + 1}/${totalPages}` };

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:compo:${page}`, "Choisir une compo", options)]),
    actionRow([
      button(`selpage:compo:${Math.max(page - 1, 0)}`, "Précédent", page <= 0),
      button(`selpage:compo:${Math.min(page + 1, totalPages - 1)}`, "Suivant", page >= totalPages - 1),
    ]),
  ];

  return json(embedResponse(embed, components));
}

async function showCompoCard(env: Env, compIdOrName: string): Promise<Response> {
  const comps = await fetchJson(env, "team_comps.json");
  const chars = await fetchJson(env, "characters.json");

  const match =
    comps.find((c: any) => String(c.id) === compIdOrName) ||
    comps.find((c: any) => normalize(c.name) === normalize(compIdOrName)) ||
    pickFirstByName(comps, compIdOrName, ["name", "id"]);

  if (!match) return json(updateSimple("Composition introuvable.", true));

  // Enrich members
  const membersRaw = match.members || match.characters || [];
  const membersArr = Array.isArray(membersRaw) ? membersRaw : [membersRaw];
  const members = membersArr.map((m: any) => {
    const name = typeof m === "string" ? m : (m?.name || m?.id || String(m));
    const found = chars.find((c: any) => normalize(c.name) === normalize(name)) || pickFirstByName(chars, name, ["name", "aliases"]);
    if (!found) return `- ${name}`;
    return `- ${found.name}${found.element ? ` (${found.element})` : ""}`;
  });

  const embed: JsonRecord = {
    title: match.name || "Composition",
    description: truncate(text(match.description || "N/A"), 2048),
    fields: [
      { name: "Membres", value: members.length ? truncate(members.join("\n"), 1024) : "Non disponible.", inline: false },
    ],
  };

  return json(updateMessage(embed, [actionRow([button("compos:back", "Retour", false, 2)])]));
}

/* -------------------- RESOURCES (peche/familiers/objet/nourriture) -------------------- */

async function showResourceCategory(env: Env, categoryKey: string): Promise<Response> {
  const resources = await fetchJson(env, "resources.json");
  if (!resources || !resources.length) return json(simpleMessage("Pas d'informations pour l'instant.", true));

  // resources.json peut être structuré différemment; on supporte 2 formes:
  // A) [{ category:"peche", items:[...]}]
  // B) [{ type:"peche", name:"...", ...}]
  let items: any[] = [];

  const byContainer = resources.find((r: any) => normalize(r.category) === normalize(categoryKey) || normalize(r.type) === normalize(categoryKey));
  if (byContainer && Array.isArray(byContainer.items)) items = byContainer.items;
  else items = resources.filter((r: any) => normalize(r.category) === normalize(categoryKey) || normalize(r.type) === normalize(categoryKey));

  if (!items.length) return json(simpleMessage("Pas d'informations pour l'instant.", true));

  const sorted = [...items].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const { totalPages, slice } = chunkForSelect(sorted, 0);

  const options = slice.map((it: any) => ({
    label: (it.name || "Entrée").slice(0, 100),
    value: String(it.id || it.name),
  }));

  const embed = { title: `Liste - ${categoryKey}`, description: totalPages > 1 ? "Liste paginée (v1)" : "Sélectionne un élément." };

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:res:${categoryKey}:0`, "Choisir", options)]),
  ];

  return json(embedResponse(embed, components));
}

async function showResourceCard(env: Env, categoryKey: string, idOrName: string): Promise<Response> {
  const resources = await fetchJson(env, "resources.json");

  let items: any[] = [];
  const byContainer = resources.find((r: any) => normalize(r.category) === normalize(categoryKey) || normalize(r.type) === normalize(categoryKey));
  if (byContainer && Array.isArray(byContainer.items)) items = byContainer.items;
  else items = resources.filter((r: any) => normalize(r.category) === normalize(categoryKey) || normalize(r.type) === normalize(categoryKey));

  const match =
    items.find((x: any) => String(x.id) === idOrName) ||
    items.find((x: any) => normalize(x.name) === normalize(idOrName)) ||
    pickFirstByName(items, idOrName, ["name", "id"]);

  if (!match) return json(updateSimple("Entrée introuvable.", true));

  const embed: JsonRecord = {
    title: match.name || categoryKey,
    description: truncate(text(match.description || match.content || "N/A"), 4096),
    thumbnail: match.image ? { url: match.image } : undefined,
  };

  return json(updateMessage(embed, [actionRow([button(`res:back:${categoryKey}`, "Retour", false, 2)])]));
}

/* -------------------- BANNIERES -------------------- */

async function showBanners(env: Env, page = 0): Promise<Response> {
  const banners = await fetchJson(env, "banners.json");
  const totalPages = Math.max(1, Math.ceil(banners.length / LIST_PAGE_SIZE));
  const safe = Math.max(0, Math.min(page, totalPages - 1));

  const embed = listEmbed("Bannières", banners, safe, (b) => ({
    name: b.name || "Bannière",
    value: truncate(`Statut: ${text(b.status)}\nDates: ${text(b.date_range || b.dates)}\n${text(b.description || "")}`),
  }));

  return json(embedResponse(embed, buildListPager("banners", safe, totalPages)));
}

/* -------------------- MAP -------------------- */

async function handleMap(env: Env): Promise<Response> {
  return json({
    type: 4,
    data: {
      embeds: [
        {
          title: "Carte interactive",
          description: "Discord ne peut pas afficher la carte web interactive telle quelle dans un message de bot. Lien direct ci-dessous.",
        },
      ],
      components: [actionRow([linkButton(env.MAP_URL, "Ouvrir la carte")])],
    },
  });
}

/* -------------------- COMPONENT ROUTER -------------------- */

async function handleComponent(env: Env, interaction: JsonRecord): Promise<Response> {
  const cid = String(interaction.data?.custom_id || "");
  const values: string[] = interaction.data?.values || [];
  const selected = values[0];

  // Pagination for select menus
  if (cid.startsWith("selpage:")) {
    const parts = cid.split(":"); // selpage:<kind>:...
    const kind = parts[1];

    if (kind === "perso") {
      const page = Number(parts[2] || "0");
      return showPersoMenu(env, page);
    }
    if (kind === "boss") {
      const page = Number(parts[2] || "0");
      return showBossMenu(env, page);
    }
    if (kind === "compo") {
      const page = Number(parts[2] || "0");
      return showComposList(env, page);
    }
    if (kind === "weapon") {
      const weaponType = parts[2];
      const page = Number(parts[3] || "0");
      return showWeaponsOfType(env, weaponType, page);
    }
    if (kind === "guide") {
      const category = parts[2];
      const page = Number(parts[3] || "0");
      return showGuidesInCategory(env, category, page);
    }

    return json(updateSimple("Pagination inconnue.", true));
  }

  // Select menus
  if (cid.startsWith("sel:")) {
    const parts = cid.split(":"); // sel:<kind>:...
    const kind = parts[1];

    if (kind === "perso") {
      return showPersoCard(env, selected, "home");
    }
    if (kind === "wtype") {
      return showWeaponsOfType(env, selected, 0);
    }
    if (kind === "weapon") {
      // sel:weapon:<weaponType>:<page>
      return showWeaponCard(env, selected);
    }
    if (kind === "boss") {
      return showBossCard(env, selected);
    }
    if (kind === "guidecat") {
      return showGuidesInCategory(env, selected, 0);
    }
    if (kind === "guide") {
      return showGuideCard(env, selected);
    }
    if (kind === "compo") {
      return showCompoCard(env, selected);
    }
    if (kind === "res") {
      const categoryKey = parts[2];
      return showResourceCard(env, categoryKey, selected);
    }

    return json(updateSimple("Sélection inconnue.", true));
  }

  // Tabs perso
  if (cid.startsWith("perso:tab:")) {
    const [, , charId, tab] = cid.split(":");
    return showPersoCard(env, charId, tab || "home");
  }
  if (cid === "perso:back") {
    return showPersoMenu(env, 0);
  }

  // Weapons back
  if (cid === "weapons:backtypes") {
    return showWeaponTypes(env);
  }

  // Boss back
  if (cid === "boss:back") {
    return showBossMenu(env, 0);
  }

  // Guides back
  if (cid === "guides:backcat") {
    return showGuideCategories(env);
  }

  // Compos back
  if (cid === "compos:back") {
    return showComposList(env, 0);
  }

  // Resources back
  if (cid.startsWith("res:back:")) {
    const categoryKey = cid.split(":")[2];
    return showResourceCategory(env, categoryKey);
  }

  // List pager (banners)
  if (cid.startsWith("page:")) {
    const [, kind, pageStr] = cid.split(":");
    const page = Number(pageStr || "0");

    if (kind === "banners") return showBanners(env, page);

    return json(updateSimple("Pagination inconnue.", true));
  }

  return json(updateSimple("Action non gérée.", true));
}

/* -------------------- COMMAND ROUTER -------------------- */

async function handleCommand(env: Env, interaction: JsonRecord): Promise<Response> {
  const cmd = interaction.data?.name;

  if (cmd === "perso") return showPersoMenu(env, 0);
  if (cmd === "armes") return showWeaponTypes(env);
  if (cmd === "boss") return showBossMenu(env, 0);
  if (cmd === "banniere") return showBanners(env, 0);
  if (cmd === "guides") return showGuideCategories(env);
  if (cmd === "compos") return showComposList(env, 0);

  if (cmd === "familiers") return showResourceCategory(env, "familiers");
  if (cmd === "peche") return showResourceCategory(env, "peche");
  if (cmd === "objet") return showResourceCategory(env, "objets");
  if (cmd === "nourriture") return showResourceCategory(env, "nourriture");

  if (cmd === "map") return handleMap(env);

  return json(simpleMessage(`Commande non gérée: ${cmd}`, true));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("7DS Origin Discord Worker OK");
    }

    if (request.method !== "POST" || url.pathname !== "/interactions") {
      return new Response("Not found", { status: 404 });
    }

    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    if (!signature || !timestamp) return new Response("Bad request signature", { status: 401 });

    const body = await request.text();
    const ok = verifyDiscordRequest(env.DISCORD_PUBLIC_KEY, signature, timestamp, body);
    if (!ok) return new Response("Invalid request signature", { status: 401 });

    const interaction = JSON.parse(body);

    // PING
    if (interaction.type === 1) return json({ type: 1 });

    // Autocomplete (non utilisé ici)
    if (interaction.type === 4) return json({ type: 8, data: { choices: [] } });

    // Component
    if (interaction.type === 3) return handleComponent(env, interaction);

    // Command
    if (interaction.type === 2) return handleCommand(env, interaction);

    return json(simpleMessage(`Interaction type non géré: ${interaction.type}`, true));
  },
};
