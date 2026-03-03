import nacl from "tweetnacl";

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_TOKEN?: string;
  DATA_BASE_URL: string;
  BOT_BRAND: string;
  MAP_URL: string;
}

type JsonRecord = Record<string, any>;

const cacheStore = new Map<string, { expiresAt: number; data: any }>();
const TTL_MS = 10 * 60 * 1000;

const SELECT_PAGE_SIZE = 25; // Discord limit
const LIST_PAGE_SIZE = 5;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function verifyDiscordRequest(publicKey: string, signature: string, timestamp: string, body: string): boolean {
  const message = new TextEncoder().encode(timestamp + body);
  return nacl.sign.detached.verify(message, hexToBytes(signature), hexToBytes(publicKey));
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

async function fetchJson(env: Env, fileName: string): Promise<any> {
  const cached = cacheStore.get(fileName);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  const base = (env.DATA_BASE_URL || "").replace(/\/$/, "");
  const url = `${base}/${fileName}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const res = await fetch(url, { signal: controller.signal, cf: { cacheTtl: 300, cacheEverything: true } as any }).finally(() =>
    clearTimeout(timeout)
  );

  if (!res.ok) throw new Error(`Impossible de charger ${fileName}: ${res.status}`);
  const data = await res.json();
  cacheStore.set(fileName, { expiresAt: now + TTL_MS, data });
  return data;
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

function embed(title: string, description?: string): JsonRecord {
  return { title, description: description ?? "" };
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

function chunkForSelect<T>(items: T[], page: number): { totalPages: number; page: number; slice: T[] } {
  const totalPages = Math.max(1, Math.ceil(items.length / SELECT_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * SELECT_PAGE_SIZE;
  return { totalPages, page: safePage, slice: items.slice(start, start + SELECT_PAGE_SIZE) };
}

async function editOriginal(env: Env, interaction: JsonRecord, data: JsonRecord): Promise<void> {
  const appId = env.DISCORD_APPLICATION_ID || interaction.application_id || interaction?.application?.id;
  if (!appId) {
    console.log("editOriginal: missing application id");
    return;
  }

  const url = `https://discord.com/api/v10/webhooks/${appId}/${interaction.token}/messages/@original`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.log("editOriginal failed", res.status, t);
  }
}

function deferredAckCommand(ephemeral = false): JsonRecord {
  // 5 = DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  return { type: 5, data: { flags: ephemeral ? 64 : 0 } };
}

function deferredAckComponent(): JsonRecord {
  // 6 = DEFERRED_UPDATE_MESSAGE
  return { type: 6 };
}

function msgPayload(embedObj?: JsonRecord, components: JsonRecord[] = [], content?: string, ephemeral = false): JsonRecord {
  return {
    content: content ?? undefined,
    embeds: embedObj ? [embedObj] : [],
    components,
    flags: ephemeral ? 64 : 0,
  };
}

function parseCustomId(customId: string): string[] {
  // Backward/typo compatibility: "selpage.weaponflat:1" => "selpage:weaponflat:1"
  let cid = customId;
  if (cid.startsWith("selpage.")) cid = cid.replace("selpage.", "selpage:");
  return cid.split(":");
}

/* -------------------- Personnages -------------------- */

function buildPersoTabs(charId: string, tab: string): JsonRecord[] {
  return [
    actionRow([
      button(`perso:tab:${charId}:home`, "Accueil", tab === "home"),
      button(`perso:tab:${charId}:stats`, "Stats", tab === "stats"),
      button(`perso:tab:${charId}:skills`, "Armes/Compétences", tab === "skills"),
      button(`perso:tab:${charId}:pots`, "Potentiels", tab === "pots"),
      button(`perso:tab:${charId}:costumes`, "Costumes", tab === "costumes"),
    ]),
    actionRow([button("perso:back", "Retour", false)]),
  ];
}

function flattenSkills(profiles: any[]): string {
  const lines: string[] = [];
  for (const profile of profiles || []) {
    const weaponType = profile.weapon_type || profile.weaponType || profile.type || "Arme";
    lines.push(`**${weaponType}**`);
    const skills = profile.skills || [];
    if (!skills.length) {
      lines.push("- Non disponible.");
      continue;
    }
    for (const s of skills.slice(0, 12)) {
      const kind = s.skill_type || s.kind || "";
      lines.push(`- ${s.name || "Compétence"}${kind ? ` (${kind})` : ""}`);
    }
  }
  return lines.join("\n");
}

function flattenPotentials(profiles: any[]): string {
  const lines: string[] = [];
  for (const profile of profiles || []) {
    const weaponType = profile.weapon_type || profile.weaponType || profile.type || "Arme";
    lines.push(`**${weaponType}**`);
    const pots = profile.potentials || [];
    if (!pots.length) {
      lines.push("- Non disponible.");
      continue;
    }
    for (const p of pots.slice(0, 10)) {
      lines.push(`- T${p.tier ?? "?"}: ${p.effect || p.description || "..."}`);
    }
  }
  return lines.join("\n");
}

function buildCostumesEmbed(char: any): JsonRecord {
  const costumes: any[] = char.costumes || char.skins || [];
  if (!costumes.length) return embed(char.name || "Costumes", "Non disponible.");

  const first = costumes.find((c) => c?.image) || costumes[0];
  const lines = costumes
    .slice(0, 20)
    .map((c) => `- ${c.name || c.title || "Costume"}`)
    .join("\n");

  const emb: JsonRecord = {
    title: `${char.name || "Personnage"} — Costumes`,
    description: truncate(lines, 4096),
  };

  if (first?.image) emb.image = { url: first.image };
  return emb;
}

async function getCharacterIndex(env: Env): Promise<any[]> {
  // new small file generated by build_bot_data.py
  try {
    const idx = await fetchJson(env, "characters/index.json");
    if (Array.isArray(idx)) return idx;
  } catch {}
  // fallback
  const all = await fetchJson(env, "characters.json");
  return Array.isArray(all) ? all : [];
}

async function getCharacterDetail(env: Env, id: string): Promise<any | null> {
  try {
    return await fetchJson(env, `characters/by-id/${id}.json`);
  } catch {
    const all = await fetchJson(env, "characters.json");
    const arr = Array.isArray(all) ? all : [];
    return (
      arr.find((c: any) => String(c.id) === id) ||
      arr.find((c: any) => normalize(c.name) === normalize(id)) ||
      null
    );
  }
}

async function payloadPersoMenu(env: Env, page = 0): Promise<JsonRecord> {
  const chars = await getCharacterIndex(env);
  if (!chars.length) return msgPayload(embed("Personnages", "Pas d'informations pour l'instant."), [], undefined, true);

  const sorted = [...chars].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const { totalPages, page: safePage, slice } = chunkForSelect(sorted, page);

  const options = slice.map((c: any) => ({
    label: (c.name || "Perso").slice(0, 100),
    value: String(c.id || c.name),
    description: c.element ? `Élément: ${c.element}` : undefined,
  }));

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:perso:${safePage}`, "Sélectionner un personnage", options)]),
    actionRow([
      button(`selpage:perso:${Math.max(safePage - 1, 0)}`, "Précédent", safePage <= 0),
      button(`selpage:perso:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
    ]),
  ];

  return msgPayload(embed("Personnages", `Page ${safePage + 1}/${totalPages}`), components);
}

async function payloadPersoTab(env: Env, charId: string, tab: string): Promise<JsonRecord> {
  const char = await getCharacterDetail(env, charId);
  if (!char) return msgPayload(embed("Personnage introuvable", "Aucun personnage ne correspond."), [], undefined, true);

  const base: JsonRecord = {
    title: char.name || "Personnage",
    thumbnail: char.image ? { url: char.image } : undefined,
  };

  let emb: JsonRecord;

  if (tab === "stats") {
    emb = {
      ...base,
      description: "Statistiques",
      fields: [
        { name: "Élément", value: text(char.element), inline: true },
        { name: "Types d'armes", value: truncate(text(char.weapon_types), 1024), inline: true },
        { name: "Stats de base", value: truncate(text(char.base_stats), 1024), inline: false },
      ],
    };
  } else if (tab === "skills") {
    emb = { ...base, description: truncate(flattenSkills(char.weapon_profiles || []), 4096) || "Non disponible." };
  } else if (tab === "pots") {
    emb = { ...base, description: truncate(flattenPotentials(char.weapon_profiles || []), 4096) || "Non disponible." };
  } else if (tab === "costumes") {
    emb = buildCostumesEmbed(char);
    emb.thumbnail = base.thumbnail;
  } else {
    emb = {
      ...base,
      description: truncate(char.description || "Aucune description.", 4096),
      fields: [
        { name: "Élément", value: text(char.element), inline: true },
        { name: "Types d'armes", value: truncate(text(char.weapon_types), 1024), inline: true },
      ],
    };
  }

  return msgPayload(emb, buildPersoTabs(String(char.id || charId), tab));
}

/* -------------------- Armes -------------------- */

async function getWeaponIndex(env: Env): Promise<any[]> {
  try {
    const idx = await fetchJson(env, "weapons/index.json");
    if (Array.isArray(idx)) return idx;
  } catch {}
  const all = await fetchJson(env, "weapons.json");
  return Array.isArray(all) ? all : [];
}

async function getWeaponDetail(env: Env, id: string): Promise<any | null> {
  try {
    return await fetchJson(env, `weapons/by-id/${id}.json`);
  } catch {
    const all = await fetchJson(env, "weapons.json");
    const arr = Array.isArray(all) ? all : [];
    return arr.find((w: any) => String(w.id) === id) || null;
  }
}

function weaponTypesFromIndex(items: any[]): string[] {
  const set = new Set<string>();
  for (const w of items) {
    const t = w.type || w.weapon_type || w.weaponType;
    if (t) set.add(String(t));
  }
  return Array.from(set).sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

async function payloadWeaponTypeMenu(env: Env, page = 0): Promise<JsonRecord> {
  const weaponsIdx = await getWeaponIndex(env);
  if (!weaponsIdx.length) return msgPayload(embed("Armes", "Pas d'informations pour l'instant."), [], undefined, true);

  const types = weaponTypesFromIndex(weaponsIdx);
  if (!types.length) {
    // Data not ready yet: still show weapon list, but no links.
    return payloadWeaponList(env, "__all__", 0);
  }

  const { totalPages, page: safePage, slice } = chunkForSelect(types, page);
  const options = slice.map((t) => ({ label: String(t).slice(0, 100), value: String(t) }));

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:weapontype:${safePage}`, "Choisir un type d'arme", options)]),
    actionRow([
      button(`selpage:weapontype:${Math.max(safePage - 1, 0)}`, "Précédent", safePage <= 0),
      button(`selpage:weapontype:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
    ]),
  ];

  return msgPayload(embed("Armes", `Types — Page ${safePage + 1}/${totalPages}`), components);
}

async function payloadWeaponList(env: Env, weaponType: string, page = 0): Promise<JsonRecord> {
  const idx = await getWeaponIndex(env);
  if (!idx.length) return msgPayload(embed("Armes", "Pas d'informations pour l'instant."), [], undefined, true);

  const filtered =
    weaponType === "__all__"
      ? idx
      : idx.filter((w: any) => normalize(w.type || w.weapon_type || w.weaponType) === normalize(weaponType));

  if (!filtered.length) return msgPayload(embed("Armes", "Pas d'informations pour l'instant."), [], undefined, true);

  const sorted = [...filtered].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const { totalPages, page: safePage, slice } = chunkForSelect(sorted, page);

  const options = slice.map((w: any) => ({
    label: (w.name || "Arme").slice(0, 100),
    value: String(w.id || w.name),
    description: w.rarity ? `Rareté: ${w.rarity}` : undefined,
  }));

  const title = weaponType === "__all__" ? "Armes" : `Armes — ${weaponType}`;

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:weapon:${weaponType}:${safePage}`, "Choisir une arme", options)]),
    actionRow([
      button(`selpage:weapon:${weaponType}:${Math.max(safePage - 1, 0)}`, "Précédent", safePage <= 0),
      button(`selpage:weapon:${weaponType}:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
      button("armes:backtype", "Retour types", false),
    ]),
  ];

  return msgPayload(embed(title, `Page ${safePage + 1}/${totalPages}`), components);
}

async function payloadWeaponCard(env: Env, weaponId: string): Promise<JsonRecord> {
  const w = await getWeaponDetail(env, weaponId);
  if (!w) return msgPayload(embed("Arme introuvable", "Aucune arme ne correspond."), [], undefined, true);

  const emb: JsonRecord = {
    title: w.name || "Arme",
    description: truncate(w.description || "Non disponible.", 4096),
    thumbnail: w.image ? { url: w.image } : undefined,
    fields: [
      { name: "Type", value: text(w.type || w.weapon_type || w.weaponType || "Non disponible"), inline: true },
      { name: "Rareté", value: text(w.rarity || "Non disponible"), inline: true },
      { name: "Stats", value: truncate(text(w.stats || w.base_stats || w.attributes || "Non disponible"), 1024), inline: false },
      { name: "Effets", value: truncate(text(w.effects || w.passive || w.effect || "Non disponible"), 1024), inline: false },
    ],
  };

  return msgPayload(emb, [actionRow([button("armes:back", "Retour", false)])]);
}

/* -------------------- Boss -------------------- */

async function payloadBossMenu(env: Env, page = 0): Promise<JsonRecord> {
  const bosses = await fetchJson(env, "bosses.json");
  const arr = Array.isArray(bosses) ? bosses : [];
  if (!arr.length) return msgPayload(embed("Boss", "Pas d'informations pour l'instant."), [], undefined, true);

  const sorted = [...arr].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const { totalPages, page: safePage, slice } = chunkForSelect(sorted, page);

  const options = slice.map((b: any) => ({ label: (b.name || "Boss").slice(0, 100), value: String(b.id || b.name) }));

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:boss:${safePage}`, "Sélectionner un boss", options)]),
    actionRow([
      button(`selpage:boss:${Math.max(safePage - 1, 0)}`, "Précédent", safePage <= 0),
      button(`selpage:boss:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
    ]),
  ];

  return msgPayload(embed("Boss", `Page ${safePage + 1}/${totalPages}`), components);
}

async function payloadBossCard(env: Env, bossId: string): Promise<JsonRecord> {
  const bosses = await fetchJson(env, "bosses.json");
  const arr = Array.isArray(bosses) ? bosses : [];
  const match =
    arr.find((b: any) => String(b.id) === bossId) ||
    arr.find((b: any) => normalize(b.name) === normalize(bossId)) ||
    arr.find((b: any) => normalize(b.name).includes(normalize(bossId)));

  if (!match) return msgPayload(embed("Boss introuvable", "Aucun boss ne correspond."), [], undefined, true);

  const stats = match.stats || match.base_stats || match.attributes || null;
  const emb: JsonRecord = {
    title: match.name || "Boss",
    description: truncate(match.description || "", 4096),
    thumbnail: match.image ? { url: match.image } : undefined,
    fields: [{ name: "Stats", value: stats ? truncate(text(stats), 1024) : "Non disponible.", inline: false }],
  };

  return msgPayload(emb, [actionRow([button("boss:back", "Retour", false)])]);
}

/* -------------------- Guides (affichage du contenu) -------------------- */

async function payloadGuideCategories(env: Env): Promise<JsonRecord> {
  const guides = await fetchJson(env, "guides.json");
  const arr = Array.isArray(guides) ? guides : [];
  if (!arr.length) return msgPayload(embed("Guides", "Pas d'informations pour l'instant."), [], undefined, true);

  const cats = Array.from(new Set(arr.map((g: any) => g.category).filter(Boolean))).sort((a, b) => normalize(a).localeCompare(normalize(b)));
  if (!cats.length) return msgPayload(embed("Guides", "Pas de catégories."), [], undefined, true);

  const options = cats.slice(0, 25).map((c: any) => ({ label: String(c).slice(0, 100), value: String(c) }));
  return msgPayload(embed("Guides", "Choisir une catégorie"), [actionRow([selectMenu("sel:guidecat", "Catégorie", options)])]);
}

async function payloadGuidesInCategory(env: Env, category: string, page = 0): Promise<JsonRecord> {
  const guides = await fetchJson(env, "guides.json");
  const arr = Array.isArray(guides) ? guides : [];
  const filtered = arr.filter((g: any) => normalize(g.category) === normalize(category));
  const sorted = [...filtered].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  if (!sorted.length) return msgPayload(embed("Guides", "Aucun guide dans cette catégorie."), [], undefined, true);

  const { totalPages, page: safePage, slice } = chunkForSelect(sorted, page);
  const options = slice.map((g: any) => ({
    label: (g.name || "Guide").slice(0, 100),
    value: String(g.id || g.name),
    description: g.summary ? String(g.summary).slice(0, 100) : undefined,
  }));

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:guide:${category}:${safePage}`, "Choisir un guide", options)]),
    actionRow([
      button(`selpage:guide:${category}:${Math.max(safePage - 1, 0)}`, "Précédent", safePage <= 0),
      button(`selpage:guide:${category}:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
      button("guides:backcat", "Retour catégories", false),
    ]),
  ];

  return msgPayload(embed(`Guides — ${category}`, `Page ${safePage + 1}/${totalPages}`), components);
}

async function payloadGuideCard(env: Env, guideId: string): Promise<JsonRecord> {
  const guides = await fetchJson(env, "guides.json");
  const arr = Array.isArray(guides) ? guides : [];
  const match =
    arr.find((g: any) => String(g.id) === guideId) ||
    arr.find((g: any) => normalize(g.name) === normalize(guideId)) ||
    arr.find((g: any) => normalize(g.name).includes(normalize(guideId)));

  if (!match) return msgPayload(embed("Guide introuvable", "Aucun guide ne correspond."), [], undefined, true);

  const content = match.content || match.description || match.summary || "Non disponible.";
  const emb: JsonRecord = {
    title: match.name || "Guide",
    description: truncate(String(content), 4096),
    fields: [{ name: "Catégorie", value: text(match.category || "N/A"), inline: true }],
  };

  return msgPayload(emb, [actionRow([button("guides:backcat", "Retour catégories", false)])]);
}

/* -------------------- Ressources placeholders -------------------- */

async function payloadResourceCategory(env: Env, categoryKey: string): Promise<JsonRecord> {
  const resources = await fetchJson(env, `${categoryKey}.json`);
  const arr = Array.isArray(resources) ? resources : [];
  if (!arr.length) return msgPayload(embed(categoryKey, "Pas d'informations pour l'instant."), [], undefined, true);

  const sorted = [...arr].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const { totalPages, page: safePage, slice } = chunkForSelect(sorted, 0);
  const options = slice.map((it: any) => ({ label: (it.name || "Entrée").slice(0, 100), value: String(it.id || it.name) }));

  return msgPayload(embed(`Liste — ${categoryKey}`, `Page ${safePage + 1}/${totalPages}`), [actionRow([selectMenu(`sel:res:${categoryKey}`, "Choisir", options)])]);
}

async function payloadResourceCard(env: Env, categoryKey: string, idOrName: string): Promise<JsonRecord> {
  const resources = await fetchJson(env, `${categoryKey}.json`);
  const arr = Array.isArray(resources) ? resources : [];
  const match =
    arr.find((x: any) => String(x.id) === idOrName) ||
    arr.find((x: any) => normalize(x.name) === normalize(idOrName)) ||
    arr.find((x: any) => normalize(x.name).includes(normalize(idOrName)));

  if (!match) return msgPayload(embed("Introuvable", "Aucune entrée ne correspond."), [], undefined, true);

  const emb: JsonRecord = {
    title: match.name || categoryKey,
    description: truncate(String(match.description || match.content || "Non disponible."), 4096),
    thumbnail: match.image ? { url: match.image } : undefined,
  };

  return msgPayload(emb, [actionRow([button(`res:back:${categoryKey}`, "Retour", false)])]);
}

function payloadMap(env: Env): JsonRecord {
  return msgPayload(
    embed("Carte interactive", "Discord ne peut pas afficher la carte web interactive dans un embed."),
    [actionRow([linkButton(env.MAP_URL, "Ouvrir la carte")])]
  );
}

/* -------------------- Async handlers -------------------- */

async function processCommand(env: Env, interaction: JsonRecord): Promise<void> {
  const cmd = interaction.data?.name;

  try {
    let payload: JsonRecord;

    if (cmd === "perso") payload = await payloadPersoMenu(env, 0);
    else if (cmd === "armes") payload = await payloadWeaponTypeMenu(env, 0);
    else if (cmd === "boss") payload = await payloadBossMenu(env, 0);
    else if (cmd === "banniere") {
      const banners = await fetchJson(env, "banners.json");
      const arr = Array.isArray(banners) ? banners : [];
      if (!arr.length) payload = msgPayload(embed("Bannières", "Pas d'informations pour l'instant."), [], undefined, true);
      else payload = msgPayload(listEmbed("Bannières", arr, 0, (b) => ({ name: b.name || "Bannière", value: truncate(String(b.description || "Non disponible."), 1024) })), [
        actionRow([
          button("page:banners:0", "Rafraîchir", false),
        ]),
      ]);
    }
    else if (cmd === "guides") payload = await payloadGuideCategories(env);
    else if (cmd === "familiers") payload = await payloadResourceCategory(env, "familiers");
    else if (cmd === "peche") payload = await payloadResourceCategory(env, "peche");
    else if (cmd === "objet") payload = await payloadResourceCategory(env, "objets");
    else if (cmd === "nourriture") payload = await payloadResourceCategory(env, "nourriture");
    else if (cmd === "map") payload = payloadMap(env);
    else payload = msgPayload(embed("Commande inconnue", `Non gérée: ${cmd}`), [], undefined, true);

    await editOriginal(env, interaction, payload);
  } catch (e: any) {
    await editOriginal(env, interaction, msgPayload(embed("Erreur", truncate(String(e?.message || e), 1024)), [], undefined, true));
  }
}

async function processComponent(env: Env, interaction: JsonRecord): Promise<void> {
  const cidRaw = String(interaction.data?.custom_id || "");
  const values: string[] = interaction.data?.values || [];
  const selected = values[0];

  try {
    let payload: JsonRecord | null = null;

    // pagination
    if (cidRaw.startsWith("selpage") || cidRaw.startsWith("page:")) {
      const parts = parseCustomId(cidRaw);

      if (parts[0] === "selpage") {
        const kind = parts[1];

        if (kind === "perso") payload = await payloadPersoMenu(env, Number(parts[2] || "0"));
        else if (kind === "boss") payload = await payloadBossMenu(env, Number(parts[2] || "0"));
        else if (kind === "weapontype") payload = await payloadWeaponTypeMenu(env, Number(parts[2] || "0"));
        else if (kind === "weapon") payload = await payloadWeaponList(env, parts[2], Number(parts[3] || "0"));
        else if (kind === "guide") payload = await payloadGuidesInCategory(env, parts[2], Number(parts[3] || "0"));
      }

      if (!payload && parts[0] === "page") {
        const kind = parts[1];
        if (kind === "banners") {
          const banners = await fetchJson(env, "banners.json");
          const arr = Array.isArray(banners) ? banners : [];
          payload = msgPayload(listEmbed("Bannières", arr, Number(parts[2] || "0"), (b) => ({ name: b.name || "Bannière", value: truncate(String(b.description || "Non disponible."), 1024) })));
        }
      }
    }

    // select menus
    if (!payload && cidRaw.startsWith("sel:")) {
      const parts = parseCustomId(cidRaw);
      const kind = parts[1];

      if (kind === "perso") payload = await payloadPersoTab(env, selected, "home");
      else if (kind === "boss") payload = await payloadBossCard(env, selected);
      else if (kind === "weapontype") payload = await payloadWeaponList(env, selected, 0);
      else if (kind === "weapon") payload = await payloadWeaponCard(env, selected);
      else if (kind === "guidecat") payload = await payloadGuidesInCategory(env, selected, 0);
      else if (kind === "guide") payload = await payloadGuideCard(env, selected);
      else if (kind === "res") payload = await payloadResourceCard(env, parts[2], selected);
    }

    // perso tabs
    if (!payload && cidRaw.startsWith("perso:tab:")) {
      const [, , charId, tab] = parseCustomId(cidRaw);
      payload = await payloadPersoTab(env, charId, tab || "home");
    }
    if (!payload && cidRaw === "perso:back") payload = await payloadPersoMenu(env, 0);

    // armes back
    if (!payload && cidRaw === "armes:backtype") payload = await payloadWeaponTypeMenu(env, 0);
    if (!payload && cidRaw === "armes:back") payload = await payloadWeaponTypeMenu(env, 0);

    // boss back
    if (!payload && cidRaw === "boss:back") payload = await payloadBossMenu(env, 0);

    // guides back
    if (!payload && cidRaw === "guides:backcat") payload = await payloadGuideCategories(env);

    // resources back
    if (!payload && cidRaw.startsWith("res:back:")) payload = await payloadResourceCategory(env, cidRaw.split(":")[2]);

    if (!payload) payload = msgPayload(embed("Action non gérée", cidRaw), [], undefined, true);

    await editOriginal(env, interaction, payload);
  } catch (e: any) {
    await editOriginal(env, interaction, msgPayload(embed("Erreur", truncate(String(e?.message || e), 1024)), [], undefined, true));
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") return new Response("7DS Origin Discord Worker OK");

    if (request.method !== "POST" || url.pathname !== "/interactions") return new Response("Not found", { status: 404 });

    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    if (!signature || !timestamp) return new Response("Bad request signature", { status: 401 });

    const body = await request.text();
    const ok = verifyDiscordRequest(env.DISCORD_PUBLIC_KEY, signature, timestamp, body);
    if (!ok) return new Response("Invalid request signature", { status: 401 });

    const interaction = JSON.parse(body);

    if (interaction.type === 1) return json({ type: 1 });

    if (interaction.type === 2) {
      ctx.waitUntil(processCommand(env, interaction));
      return json(deferredAckCommand(false));
    }

    if (interaction.type === 3) {
      ctx.waitUntil(processComponent(env, interaction));
      return json(deferredAckComponent());
    }

    if (interaction.type === 4) return json({ type: 8, data: { choices: [] } });

    return json({ type: 4, data: { content: "Type interaction non géré.", flags: 64 } });
  },
};
