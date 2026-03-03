function uniqueOptions<T extends { value: string }>(options: T[]): T[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    if (!o.value) return false;
    if (seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  });
}
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

const SELECT_PAGE_SIZE = 25;
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

async function fetchJson(env: Env, fileName: string): Promise<any[]> {
  const cached = cacheStore.get(fileName);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  const base = (env.DATA_BASE_URL || "").replace(/\/$/, "");
  const res = await fetch(`${base}/${fileName}`, { cf: { cacheTtl: 300, cacheEverything: true } as any });
  if (!res.ok) throw new Error(`Impossible de charger ${fileName}: ${res.status}`);
  const data = (await res.json()) as any[];
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
    description: items.length ? `Page ${page + 1}/${totalPages} - ${items.length} rÃ©sultat(s)` : "Aucun rÃ©sultat.",
    fields: sliced.map(formatter).slice(0, 25),
  };
}

function chunkForSelect<T>(items: T[], page: number): { totalPages: number; page: number; start: number; slice: T[] } {
  const totalPages = Math.max(1, Math.ceil(items.length / SELECT_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * SELECT_PAGE_SIZE;
  return { totalPages, page: safePage, start, slice: items.slice(start, start + SELECT_PAGE_SIZE) };
}

function makeIdxValue(prefix: string, idx: number): string {
  // must be unique per menu; keep short
  return `${prefix}:${idx}`;
}

function parseIdxValue(value: string): { prefix: string; idx: number } | null {
  const m = /^([a-z]+):(\d+)$/.exec(value);
  if (!m) return null;
  return { prefix: m[1], idx: Number(m[2]) };
}

/** Edit original deferred response */
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
  return { type: 5, data: { flags: ephemeral ? 64 : 0 } };
}

function deferredAckComponent(): JsonRecord {
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

/* -------------------- PERSO -------------------- */

function buildPersoTabs(charIdx: number, tab: string): JsonRecord[] {
  return [
    actionRow([
      button(`perso:tab:${charIdx}:home`, "Accueil", tab === "home", 2),
      button(`perso:tab:${charIdx}:stats`, "Stats", tab === "stats", 2),
      button(`perso:tab:${charIdx}:skills`, "Armes & Skills", tab === "skills", 2),
      button(`perso:tab:${charIdx}:pots`, "Potentiels", tab === "pots", 2),
      button(`perso:tab:${charIdx}:costumes`, "Costumes", tab === "costumes", 2),
    ]),
    actionRow([button(`perso:back`, "Retour au menu", false, 2)]),
  ];
}

function flattenSkills(profiles: any[]): string {
  const lines: string[] = [];
  for (const profile of profiles || []) {
    const weaponType = profile.weapon_type || profile.weaponType || profile.type || "Arme inconnue";
    const skills = profile.skills || [];
    lines.push(`**${weaponType}**`);
    if (!skills.length) {
      lines.push("- (aucune compÃ©tence)");
      continue;
    }
    for (const s of skills.slice(0, 12)) {
      const kind = s.skill_type || s.kind || "type";
      lines.push(`- ${s.name || "CompÃ©tence"} (${kind})`);
    }
  }
  return lines.join("\n");
}

function flattenPotentials(profiles: any[]): string {
  const lines: string[] = [];
  for (const profile of profiles || []) {
    const weaponType = profile.weapon_type || profile.weaponType || profile.type || "Arme inconnue";
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
  const base: JsonRecord = {
    title: match.name || "Personnage",
    thumbnail: match.image ? { url: match.image } : undefined,
  };

  if (tab === "stats") {
    return {
      ...base,
      description: "Statistiques",
      fields: [
        { name: "Ã‰lÃ©ment", value: text(match.element), inline: true },
        { name: "Types d'armes", value: truncate(text(match.weapon_types)), inline: true },
        { name: "Stats de base", value: truncate(text(match.base_stats), 1024), inline: false },
      ],
    };
  }

  if (tab === "skills") {
    return { ...base, description: truncate(flattenSkills(match.weapon_profiles || []) || "Non disponible.", 4096) };
  }

  if (tab === "pots") {
    return { ...base, description: truncate(flattenPotentials(match.weapon_profiles || []) || "Non disponible.", 4096) };
  }

  if (tab === "costumes") {
    const costumes = match.costumes || match.skins || [];
    const lines = (costumes || []).slice(0, 30).map((c: any) => `- ${c.name || c.title || "Costume"}`);
    return { ...base, description: lines.length ? truncate(lines.join("\n"), 4096) : "Non disponible." };
  }

  return {
    ...base,
    description: truncate(match.description || "Aucune description.", 4096),
    fields: [
      { name: "Ã‰lÃ©ment", value: text(match.element), inline: true },
      { name: "Types d'armes", value: truncate(text(match.weapon_types)), inline: true },
    ],
  };
}

async function getSortedCharacters(env: Env): Promise<any[]> {
  const chars = await fetchJson(env, "characters.json");
  return [...chars].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
}

async function payloadPersoMenu(env: Env, page = 0): Promise<JsonRecord> {
  const sorted = await getSortedCharacters(env);
  const { totalPages, page: safePage, start, slice } = chunkForSelect(sorted, page);

  const options = slice.map((c: any, i: number) => {
    const idx = start + i;
    return {
      label: (c.name || "Perso").slice(0, 100),
      value: makeIdxValue("p", idx),
      description: c.element ? `Ã‰lÃ©ment: ${c.element}` : undefined,
    };
  });

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:perso:${safePage}`, "SÃ©lectionner un personnage", options)]),
    actionRow([
      button(`selpage:perso:${Math.max(safePage - 1, 0)}`, "PrÃ©cÃ©dent", safePage <= 0),
      button(`selpage:perso:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
    ]),
  ];

  return msgPayload(embed("Choisir un personnage", `Page ${safePage + 1}/${totalPages}`), components);
}

async function payloadPersoCardByIdx(env: Env, idx: number, tab: string): Promise<JsonRecord> {
  const sorted = await getSortedCharacters(env);
  const match = sorted[idx];
  if (!match) return msgPayload(embed("Personnage introuvable", "Index invalide."), [], undefined, true);
  return msgPayload(buildPersoEmbed(match, tab), buildPersoTabs(idx, tab));
}

/* -------------------- ARMES -------------------- */

async function getSortedWeapons(env: Env): Promise<any[]> {
  const weapons = await fetchJson(env, "weapons.json");
  function weaponDisplayName(w: any): string {
    if (w?.name) return String(w.name);
    const s = Array.isArray(w?.sources) ? w.sources[0] : null;
    if (s?.name) return String(s.name);
    if (s?.source_url) return String(s.source_url).split("/").pop() || "Arme";
    return "Arme";
  }
  return [...weapons].sort((a, b) => normalize(weaponDisplayName(a)).localeCompare(normalize(weaponDisplayName(b))));
}

function weaponDisplayName(w: any): string {
  if (w?.name) return String(w.name);
  const s = Array.isArray(w?.sources) ? w.sources[0] : null;
  if (s?.name) return String(s.name);
  if (s?.source_url) return String(s.source_url).split("/").pop() || "Arme";
  return "Arme";
}

function weaponTypeOf(w: any): string {
  return (
    w?.type ??
    w?.weapon_type ??
    w?.weaponType ??
    w?.weapon_class ??
    w?.weaponClass ??
    w?.weapon_category ??
    w?.weaponCategory ??
    w?.category ??
    ""
  );
}

async function payloadWeaponsTypeMenu(env: Env): Promise<JsonRecord> {
  const weapons = await fetchJson(env, "weapons.json");
  const types = Array.from(
    new Set(
      weapons
        .map((w: any) => weaponTypeOf(w))
        .filter((x: any) => typeof x === "string" && x.trim().length)
        .map((x: string) => x.trim())
    )
  ).sort((a, b) => normalize(a).localeCompare(normalize(b)));

  if (!types.length) {
    // fallback list (data incomplete)
    return payloadWeaponsFlatMenu(env, 0);
  }

  const options = types.slice(0, 25).map((t) => ({ label: t.slice(0, 100), value: t }));
  return msgPayload(embed("Types d'armes", "Choisir un type"), [actionRow([selectMenu("sel:weapontype", "Type d'arme", options)])]);
}

async function payloadWeaponsFlatMenu(env: Env, page = 0): Promise<JsonRecord> {
  const sorted = await getSortedWeapons(env);
  if (!sorted.length) return msgPayload(embed("Armes", "Pas d'informations pour l'instant."), [], undefined, true);

  const { totalPages, page: safePage, start, slice } = chunkForSelect(sorted, page);

  const options = slice.map((w: any, i: number) => {
    const idx = start + i;
    return {
      label: weaponDisplayName(w).slice(0, 100),
      value: makeIdxValue("w", idx),
      description: w?.sources?.[0]?.site ? `Source: ${w.sources[0].site}` : undefined,
    };
  });

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:weaponflat:${safePage}`, "Choisir une arme", options)]),
    actionRow([
      button(`selpage:weaponflat:${Math.max(safePage - 1, 0)}`, "PrÃ©cÃ©dent", safePage <= 0),
      button(`selpage:weaponflat:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
    ]),
  ];

  return msgPayload(embed("Armes", `Page ${safePage + 1}/${totalPages}`), components);
}

async function payloadWeaponsOfType(env: Env, type: string, page = 0): Promise<JsonRecord> {
  const weapons = await fetchJson(env, "weapons.json");
  const filtered = weapons.filter((w: any) => normalize(weaponTypeOf(w)) === normalize(type));
  const sorted = [...filtered].sort((a, b) => normalize(weaponDisplayName(a)).localeCompare(normalize(weaponDisplayName(b))));
  if (!sorted.length) return msgPayload(embed("Armes", "Pas d'informations pour l'instant."), [], undefined, true);

  const { totalPages, page: safePage, start, slice } = chunkForSelect(sorted, page);

  const options = slice.map((w: any, i: number) => {
    const idx = start + i;
    return { label: weaponDisplayName(w).slice(0, 100), value: makeIdxValue("wt", idx) };
  });

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:weapon:${type}:${safePage}`, "Choisir une arme", options)]),
    actionRow([
      button(`selpage:weapon:${type}:${Math.max(safePage - 1, 0)}`, "PrÃ©cÃ©dent", safePage <= 0),
      button(`selpage:weapon:${type}:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
      button("armes:backtypes", "Retour types", false, 2),
    ]),
  ];

  return msgPayload(embed(`Armes - ${type}`, `Page ${safePage + 1}/${totalPages}`), components);
}

function weaponStatsBlock(w: any): string {
  const stats = w?.stats || w?.base_stats || w?.attributes || null;
  if (!stats) return "Non disponible.";
  return truncate(text(stats), 1024);
}

function weaponEffectsBlock(w: any): string {
  const eff = w?.effects || w?.passives || w?.passive || w?.effect || null;
  if (!eff) return "Non disponible.";
  return truncate(text(eff), 1024);
}

async function payloadWeaponCardFromSorted(env: Env, sorted: any[], idx: number): Promise<JsonRecord> {
  const w = sorted[idx];
  if (!w) return msgPayload(embed("Arme introuvable", "Index invalide."), [], undefined, true);

  const emb: JsonRecord = {
    title: weaponDisplayName(w),
    thumbnail: w.image ? { url: w.image } : undefined,
    fields: [
      { name: "Type", value: weaponTypeOf(w) || "Non disponible.", inline: true },
      { name: "RaretÃ©", value: text(w.rarity || w.star || w.rank || "Non disponible."), inline: true },
      { name: "Stats", value: weaponStatsBlock(w), inline: false },
      { name: "Effets", value: weaponEffectsBlock(w), inline: false },
    ],
    description: w.description ? truncate(String(w.description), 4096) : undefined,
  };

  return msgPayload(emb);
}

/* -------------------- BANNIERES -------------------- */

async function payloadBanners(env: Env, page = 0): Promise<JsonRecord> {
  const banners = await fetchJson(env, "banners.json");
  if (!banners.length) return msgPayload(embed("BanniÃ¨res", "Pas d'informations pour l'instant."), [], undefined, true);

  const totalPages = Math.max(1, Math.ceil(banners.length / LIST_PAGE_SIZE));
  const safe = Math.max(0, Math.min(page, totalPages - 1));

  const emb = listEmbed("BanniÃ¨res", banners, safe, (b) => ({
    name: b.name || "BanniÃ¨re",
    value: truncate(`Statut: ${text(b.status)}\nDates: ${text(b.date_range || b.dates)}\n${text(b.description || "")}`),
  }));

  const components: JsonRecord[] = [
    actionRow([
      button(`page:banners:${Math.max(safe - 1, 0)}`, "PrÃ©cÃ©dent", safe <= 0),
      button(`page:banners:${Math.min(safe + 1, totalPages - 1)}`, "Suivant", safe >= totalPages - 1),
    ]),
  ];

  return msgPayload(emb, components);
}

/* -------------------- BOSS -------------------- */

async function getSortedBosses(env: Env): Promise<any[]> {
  const bosses = await fetchJson(env, "bosses.json");
  return [...bosses].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
}

async function payloadBossMenu(env: Env, page = 0): Promise<JsonRecord> {
  const sorted = await getSortedBosses(env);
  if (!sorted.length) return msgPayload(embed("Boss", "Pas d'informations pour l'instant."), [], undefined, true);

  const { totalPages, page: safePage, start, slice } = chunkForSelect(sorted, page);
  const options = slice.map((b: any, i: number) => ({ label: (b.name || "Boss").slice(0, 100), value: makeIdxValue("b", start + i) }));

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:boss:${safePage}`, "SÃ©lectionner un boss", options)]),
    actionRow([
      button(`selpage:boss:${Math.max(safePage - 1, 0)}`, "PrÃ©cÃ©dent", safePage <= 0),
      button(`selpage:boss:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
    ]),
  ];

  return msgPayload(embed("Choisir un boss", `Page ${safePage + 1}/${totalPages}`), components);
}

async function payloadBossCardByIdx(env: Env, idx: number): Promise<JsonRecord> {
  const sorted = await getSortedBosses(env);
  const match = sorted[idx];
  if (!match) return msgPayload(embed("Boss introuvable", "Index invalide."), [], undefined, true);

  const stats = match.stats || match.base_stats || match.attributes || null;

  const emb: JsonRecord = {
    title: match.name || "Boss",
    thumbnail: match.image ? { url: match.image } : undefined,
    fields: [
      { name: "Description", value: truncate(text(match.description || "N/A"), 1024), inline: false },
      { name: "Stats", value: stats ? truncate(text(stats), 1024) : "Non disponible.", inline: false },
    ],
  };

  return msgPayload(emb, [actionRow([button("boss:back", "Retour", false, 2)])]);
}

/* -------------------- GUIDES -------------------- */

async function payloadGuideCategories(env: Env): Promise<JsonRecord> {
  const guides = await fetchJson(env, "guides.json");
  if (!guides.length) return msgPayload(embed("Guides", "Pas d'informations pour l'instant."), [], undefined, true);

  const cats = Array.from(new Set(guides.map((g: any) => g.category).filter(Boolean))).sort((a, b) => normalize(a).localeCompare(normalize(b)));
  if (!cats.length) return msgPayload(embed("Guides", "Pas de catÃ©gories."), [], undefined, true);

  const options = cats.slice(0, 25).map((c: any) => ({ label: String(c).slice(0, 100), value: String(c) }));
  return msgPayload(embed("Guides", "Choisir une catÃ©gorie"), [actionRow([selectMenu("sel:guidecat", "CatÃ©gorie", options)])]);
}

async function getGuidesInCategory(env: Env, category: string): Promise<any[]> {
  const guides = await fetchJson(env, "guides.json");
  const filtered = guides.filter((g: any) => normalize(g.category) === normalize(category));
  return [...filtered].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
}

async function payloadGuidesInCategory(env: Env, category: string, page = 0): Promise<JsonRecord> {
  const sorted = await getGuidesInCategory(env, category);
  if (!sorted.length) return msgPayload(embed("Guides", "Aucun guide dans cette catÃ©gorie."), [], undefined, true);

  const { totalPages, page: safePage, start, slice } = chunkForSelect(sorted, page);
  const options = slice.map((g: any, i: number) => ({
    label: (g.name || "Guide").slice(0, 100),
    value: makeIdxValue("g", start + i),
    description: g.summary ? String(g.summary).slice(0, 100) : undefined,
  }));

  const components: JsonRecord[] = [
    actionRow([selectMenu(`sel:guide:${category}:${safePage}`, "Choisir un guide", options)]),
    actionRow([
      button(`selpage:guide:${category}:${Math.max(safePage - 1, 0)}`, "PrÃ©cÃ©dent", safePage <= 0),
      button(`selpage:guide:${category}:${Math.min(safePage + 1, totalPages - 1)}`, "Suivant", safePage >= totalPages - 1),
      button("guides:backcat", "Retour catÃ©gories", false, 2),
    ]),
  ];

  return msgPayload(embed(`Guides - ${category}`, `Page ${safePage + 1}/${totalPages}`), components);
}

async function payloadGuideCardByIdx(env: Env, category: string, idx: number): Promise<JsonRecord> {
  const sorted = await getGuidesInCategory(env, category);
  const match = sorted[idx];
  if (!match) return msgPayload(embed("Guide introuvable", "Index invalide."), [], undefined, true);

  const emb: JsonRecord = {
    title: match.name || "Guide",
    description: truncate(text(match.content || match.description || match.summary || "N/A"), 4096),
    fields: [{ name: "CatÃ©gorie", value: text(match.category || "N/A"), inline: true }],
  };

  return msgPayload(emb, [actionRow([button("guides:backcat", "Retour catÃ©gories", false, 2)])]);
}

/* -------------------- RESOURCES -------------------- */

async function payloadResourceCategory(env: Env, categoryKey: string): Promise<JsonRecord> {
  const resources = await fetchJson(env, "resources.json");
  if (!resources || !resources.length) return msgPayload(embed(categoryKey, "Pas d'informations pour l'instant."), [], undefined, true);

  let items: any[] = [];
  const byContainer = resources.find((r: any) => normalize(r.category) === normalize(categoryKey) || normalize(r.type) === normalize(categoryKey));
  if (byContainer && Array.isArray(byContainer.items)) items = byContainer.items;
  else items = resources.filter((r: any) => normalize(r.category) === normalize(categoryKey) || normalize(r.type) === normalize(categoryKey));

  if (!items.length) return msgPayload(embed(categoryKey, "Pas d'informations pour l'instant."), [], undefined, true);

  const sorted = [...items].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const { start, slice } = chunkForSelect(sorted, 0);

  const options = slice.map((it: any, i: number) => ({ label: (it.name || "EntrÃ©e").slice(0, 100), value: makeIdxValue("r", start + i) }));
  const components = [actionRow([selectMenu(`sel:res:${categoryKey}:0`, "Choisir", options)])];

  return msgPayload(embed(`Liste - ${categoryKey}`, "SÃ©lectionne un Ã©lÃ©ment."), components);
}

async function payloadResourceCard(env: Env, categoryKey: string, idx: number): Promise<JsonRecord> {
  const resources = await fetchJson(env, "resources.json");
  let items: any[] = [];
  const byContainer = resources.find((r: any) => normalize(r.category) === normalize(categoryKey) || normalize(r.type) === normalize(categoryKey));
  if (byContainer && Array.isArray(byContainer.items)) items = byContainer.items;
  else items = resources.filter((r: any) => normalize(r.category) === normalize(categoryKey) || normalize(r.type) === normalize(categoryKey));

  const sorted = [...items].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const match = sorted[idx];
  if (!match) return msgPayload(embed("Introuvable", "Index invalide."), [], undefined, true);

  const emb: JsonRecord = {
    title: match.name || categoryKey,
    description: truncate(text(match.description || match.content || "N/A"), 4096),
    thumbnail: match.image ? { url: match.image } : undefined,
  };

  return msgPayload(emb, [actionRow([button(`res:back:${categoryKey}`, "Retour", false, 2)])]);
}

/* -------------------- MAP -------------------- */

function payloadMap(env: Env): JsonRecord {
  return msgPayload(
    { title: "Carte interactive", description: "Discord ne peut pas afficher la carte web interactive dans un embed. Lien direct ci-dessous." },
    [actionRow([linkButton(env.MAP_URL, "Ouvrir la carte")])]
  );
}

/* -------------------- Async processors -------------------- */

async function processCommand(env: Env, interaction: JsonRecord): Promise<void> {
  const cmd = interaction.data?.name;

  try {
    let payload: JsonRecord;

    if (cmd === "perso") payload = await payloadPersoMenu(env, 0);
    else if (cmd === "armes") payload = await payloadWeaponsTypeMenu(env);
    else if (cmd === "banniere") payload = await payloadBanners(env, 0);
    else if (cmd === "boss") payload = await payloadBossMenu(env, 0);
    else if (cmd === "guides") payload = await payloadGuideCategories(env);
    else if (cmd === "familiers") payload = await payloadResourceCategory(env, "familiers");
    else if (cmd === "peche") payload = await payloadResourceCategory(env, "peche");
    else if (cmd === "objet") payload = await payloadResourceCategory(env, "objets");
    else if (cmd === "nourriture") payload = await payloadResourceCategory(env, "nourriture");
    else if (cmd === "map") payload = payloadMap(env);
    else payload = msgPayload(embed("Commande inconnue", `Non gÃ©rÃ©e: ${cmd}`), [], undefined, true);

    await editOriginal(env, interaction, payload);
  } catch (e: any) {
    await editOriginal(env, interaction, msgPayload(embed("Erreur", truncate(String(e?.message || e), 1024)), [], undefined, true));
  }
}

async function processComponent(env: Env, interaction: JsonRecord): Promise<void> {
  const cid = String(interaction.data?.custom_id || "");
  const values: string[] = interaction.data?.values || [];
  const selected = values[0];

  try {
    let payload: JsonRecord | null = null;

    // pagination for select menus
    if (cid.startsWith("selpage:")) {
      const parts = cid.split(":");
      const kind = parts[1];

      if (kind === "perso") payload = await payloadPersoMenu(env, Number(parts[2] || "0"));
      else if (kind === "boss") payload = await payloadBossMenu(env, Number(parts[2] || "0"));
      else if (kind === "weaponflat") payload = await payloadWeaponsFlatMenu(env, Number(parts[2] || "0"));
      else if (kind === "weapon") payload = await payloadWeaponsOfType(env, parts[2], Number(parts[3] || "0"));
      else if (kind === "guide") payload = await payloadGuidesInCategory(env, parts[2], Number(parts[3] || "0"));
    }

    // select menus
    if (!payload && cid.startsWith("sel:")) {
      const parts = cid.split(":");
      const kind = parts[1];

      if (kind === "perso") {
        const p = parseIdxValue(selected);
        if (!p || p.prefix !== "p") payload = msgPayload(embed("Erreur", "SÃ©lection invalide."), [], undefined, true);
        else payload = await payloadPersoCardByIdx(env, p.idx, "home");
      } else if (kind === "weaponflat") {
        const p = parseIdxValue(selected);
        if (!p || p.prefix !== "w") payload = msgPayload(embed("Erreur", "SÃ©lection invalide."), [], undefined, true);
        else {
          const sorted = await getSortedWeapons(env);
          payload = await payloadWeaponCardFromSorted(env, sorted, p.idx);
        }
      } else if (kind === "weapontype") {
        payload = await payloadWeaponsOfType(env, selected, 0);
      } else if (kind === "weapon") {
        const p = parseIdxValue(selected);
        if (!p || p.prefix !== "wt") payload = msgPayload(embed("Erreur", "SÃ©lection invalide."), [], undefined, true);
        else {
          // We'll reconstruct sorted weapons of this type again
          const weapons = await fetchJson(env, "weapons.json");
          const type = parts[2];
          const filtered = weapons.filter((w: any) => normalize(weaponTypeOf(w)) === normalize(type));
          const s = [...filtered].sort((a, b) => normalize(weaponDisplayName(a)).localeCompare(normalize(weaponDisplayName(b))));
          payload = await payloadWeaponCardFromSorted(env, s, p.idx);
        }
      } else if (kind === "boss") {
        const p = parseIdxValue(selected);
        if (!p || p.prefix !== "b") payload = msgPayload(embed("Erreur", "SÃ©lection invalide."), [], undefined, true);
        else payload = await payloadBossCardByIdx(env, p.idx);
      } else if (kind === "guidecat") {
        payload = await payloadGuidesInCategory(env, selected, 0);
      } else if (kind === "guide") {
        const category = parts[2];
        const p = parseIdxValue(selected);
        if (!p || p.prefix !== "g") payload = msgPayload(embed("Erreur", "SÃ©lection invalide."), [], undefined, true);
        else payload = await payloadGuideCardByIdx(env, category, p.idx);
      } else if (kind === "res") {
        const category = parts[2];
        const p = parseIdxValue(selected);
        if (!p || p.prefix !== "r") payload = msgPayload(embed("Erreur", "SÃ©lection invalide."), [], undefined, true);
        else payload = await payloadResourceCard(env, category, p.idx);
      }
    }

    // tabs perso + back
    if (!payload && cid.startsWith("perso:tab:")) {
      const [, , idxStr, tab] = cid.split(":");
      payload = await payloadPersoCardByIdx(env, Number(idxStr), tab || "home");
    }
    if (!payload && cid === "perso:back") payload = await payloadPersoMenu(env, 0);

    // back buttons
    if (!payload && cid === "boss:back") payload = await payloadBossMenu(env, 0);
    if (!payload && cid === "guides:backcat") payload = await payloadGuideCategories(env);
    if (!payload && cid === "armes:backtypes") payload = await payloadWeaponsTypeMenu(env);
    if (!payload && cid.startsWith("res:back:")) payload = await payloadResourceCategory(env, cid.split(":")[2]);

    // banners pager
    if (!payload && cid.startsWith("page:")) {
      const [, kind, pageStr] = cid.split(":");
      if (kind === "banners") payload = await payloadBanners(env, Number(pageStr || "0"));
    }

    if (!payload) payload = msgPayload(embed("Action non gÃ©rÃ©e", cid), [], undefined, true);

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

    return json({ type: 4, data: { content: "Type interaction non gÃ©rÃ©.", flags: 64 } });
  },
};


