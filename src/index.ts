import nacl from "tweetnacl";

type Json = Record<string, any>;
type Env = {
  DISCORD_PUBLIC_KEY: string;
  DATA_BASE_URL?: string;
  BOT_BRAND?: string;
  MAP_URL?: string;
};

type Embed = Record<string, any>;
type Component = Record<string, any>;

type ViewResult = {
  embeds: Embed[];
  components: Component[];
  content?: string;
  flags?: number;
};

const COLORS = {
  brand: 0xf59e0b,
  info: 0x60a5fa,
  ok: 0x34d399,
  danger: 0xef4444,
  neutral: 0x94a3b8,
};

const PAGE_SIZE = 25;
const MAX_FIELD = 1024;

const dataCache = new Map<string, Promise<any[]>>();

function asRecord(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}

function asArray<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) {
    const s = asString(v);
    if (s) return s;
  }
  return "";
}

function slugify(v: unknown): string {
  return asString(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function humanizeKey(v: string): string {
  return v
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function uniqStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const s = asString(value);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function truncate(s: string, n = 350): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function splitForFields(lines: string[]): [string, string] {
  const mid = Math.ceil(lines.length / 2);
  const left = lines.slice(0, mid).join("\n").slice(0, MAX_FIELD);
  const right = lines.slice(mid).join("\n").slice(0, MAX_FIELD);
  return [left || "—", right || "—"];
}

function parseMaybeJsonObject(v: unknown): Json {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Json;
  if (typeof v !== "string") return {};
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

function cid(...parts: Array<string | number | undefined>): string {
  return parts
    .filter((x) => x !== undefined && x !== "")
    .map((x) => String(x).replace(/~/g, "-"))
    .join("~")
    .slice(0, 100);
}

function button(label: string, custom_id: string, style = 2, disabled = false, emoji?: string): Component {
  const btn: Component = { type: 2, style, label, custom_id, disabled };
  if (emoji) btn.emoji = { name: emoji };
  return btn;
}

function linkButton(label: string, url: string): Component {
  return { type: 2, style: 5, label, url };
}

function actionRow(...components: Component[]): Component {
  return { type: 1, components };
}

function selectMenu(custom_id: string, placeholder: string, options: any[]): Component {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id,
        placeholder,
        options: options.slice(0, 25),
      },
    ],
  };
}

function message(view: ViewResult, update = false): Response {
  return Response.json({
    type: update ? 7 : 4,
    data: {
      content: view.content ?? "",
      embeds: view.embeds,
      components: view.components,
      flags: view.flags,
    },
  });
}

function errorView(text: string): ViewResult {
  return {
    embeds: [{ title: "Erreur", description: text, color: COLORS.danger }],
    components: [],
    flags: 64,
  };
}

function baseDataUrl(env: Env, file: string): string {
  const raw = (env.DATA_BASE_URL || "").replace(/\/$/, "");
  if (!raw) throw new Error("DATA_BASE_URL manquant");
  return `${raw}/${file}.json`;
}

async function loadData(env: Env, file: string): Promise<any[]> {
  const key = baseDataUrl(env, file);
  if (!dataCache.has(key)) {
    dataCache.set(
      key,
      fetch(key)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} sur ${file}.json`);
          return r.json();
        })
        .then((data) => (Array.isArray(data) ? data : [])),
    );
  }
  return dataCache.get(key)!;
}

function hexToUint8Array(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g) || [];
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

async function verifyDiscordRequest(req: Request, env: Env): Promise<boolean> {
  const sig = req.headers.get("x-signature-ed25519") || "";
  const ts = req.headers.get("x-signature-timestamp") || "";
  if (!sig || !ts || !env.DISCORD_PUBLIC_KEY) return false;
  const body = await req.clone().text();
  const msg = new TextEncoder().encode(ts + body);
  return nacl.sign.detached.verify(msg, hexToUint8Array(sig), hexToUint8Array(env.DISCORD_PUBLIC_KEY));
}

const elementEmoji: Record<string, string> = {
  fire: "🔥",
  wind: "🍃",
  earth: "🪨",
  cold: "❄️",
  ice: "❄️",
  lightning: "⚡",
  dark: "🌑",
  darkness: "🌑",
  holy: "✨",
  physical: "⚔️",
};

const weaponEmoji: Record<string, string> = {
  longsword: "🗡️",
  greatsword: "⚔️",
  sword: "🗡️",
  dualswords: "⚔️",
  "dual swords": "⚔️",
  rapier: "🗡️",
  lance: "🪄",
  shield: "🛡️",
  cudgel: "🔨",
  axe: "🪓",
  gauntlets: "🥊",
  bow: "🏹",
  staff: "🪄",
};

const statEmoji: Record<string, string> = {
  attack: "⚔️",
  defense: "🛡️",
  "max hp": "❤️",
  maxhp: "❤️",
  accuracy: "🎯",
  block: "🧱",
  "crit rate": "💥",
  critrate: "💥",
  "crit damage": "☄️",
  critdamage: "☄️",
  "crit res": "🌀",
  critres: "🌀",
  "crit dmg res": "🧊",
  critdmgres: "🧊",
  "block dmg res": "🧱",
  blockdmgres: "🧱",
  "move speed": "💨",
  movespeed: "💨",
  "pvp dmg inc": "📈",
  pvpdmginc: "📈",
  "pvp dmg dec": "📉",
  pvpdmgdec: "📉",
};

function emojiForElement(v: unknown): string {
  return elementEmoji[slugify(v)] || "✨";
}

function emojiForWeapon(v: unknown): string {
  return weaponEmoji[slugify(v)] || "⚔️";
}

function emojiForStat(v: unknown): string {
  const s = slugify(v).replace(/-/g, " ");
  return statEmoji[s] || "•";
}

function pickImage(...values: unknown[]): string | undefined {
  for (const value of values) {
    const s = asString(value);
    if (/^https?:\/\//i.test(s)) return s;
  }
  return undefined;
}

function characterImageOf(c: Json | undefined): string | undefined {
  const obj = asRecord(c);
  const images = asRecord(obj.images);
  return pickImage(
    obj.character_image,
    obj.characterImage,
    obj.image,
    obj.portrait,
    obj.thumbnail,
    images.character,
    images.portrait,
    images.full,
    images.card,
    images.icon,
    images.thumbnail,
  );
}

function elementIconOf(c: Json | undefined): string | undefined {
  const obj = asRecord(c);
  const images = asRecord(obj.images);
  return pickImage(obj.element_icon, obj.elementIcon, images.element_icon, images.elementIcon);
}

function normalizeWeaponType(v: unknown): string {
  const s = asString(v);
  const compact = s.replace(/\s+/g, "");
  if (/^dual\s*swords?$/i.test(s) || /^dualswords?$/i.test(compact)) return "Dual Swords";
  if (/^great\s*sword$/i.test(s) || /^greatsword$/i.test(compact)) return "Greatsword";
  if (/^long\s*sword$/i.test(s) || /^longsword$/i.test(compact)) return "Longsword";
  return s || "Type";
}

function characterWeaponProfiles(c: Json): Json[] {
  return asArray<Json>(c.weapon_profiles)
    .map(asRecord)
    .filter((x) => Object.keys(x).length > 0);
}

function characterWeaponTypes(c: Json): string[] {
  const explicit = asArray(c.weapon_types).map(normalizeWeaponType).filter(Boolean);
  const fromProfiles = characterWeaponProfiles(c)
    .map((p) => normalizeWeaponType(p.weapon_type || p.type || p.name))
    .filter(Boolean);
  return uniqStrings([...explicit, ...fromProfiles]);
}

function findWeaponProfile(c: Json, weaponType?: string): Json | undefined {
  const profiles = characterWeaponProfiles(c);
  if (!profiles.length) return undefined;
  if (!weaponType) return profiles[0];
  const target = slugify(weaponType);
  return profiles.find((p) => slugify(normalizeWeaponType(p.weapon_type || p.type || p.name)) === target) || profiles[0];
}

function skillTypeLabel(item: Json): string {
  return firstString(item.kind, item.type, item.section, item.subtitle, item.tag, item.category);
}

function normalizeSkills(profile: Json): Json[] {
  const raw = asArray<Json>(profile.skills);
  if (raw.length) return raw.map(asRecord);
  const skills = asRecord(profile.skill_set);
  const out: Json[] = [];
  for (const [key, value] of Object.entries(skills)) {
    if (Array.isArray(value)) {
      for (const item of value) out.push({ ...asRecord(item), type: humanizeKey(key) });
    } else if (value && typeof value === "object") {
      out.push({ ...asRecord(value), type: humanizeKey(key) });
    }
  }
  return out;
}

function normalizePotentials(profile: Json): Json[] {
  const raw = asArray<Json>(profile.potentials);
  if (raw.length) return raw.map(asRecord);
  const obj = asRecord(profile.potentials_map || profile.potential_map);
  const out: Json[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) out.push({ ...asRecord(item), tier: key });
    } else if (value && typeof value === "object") {
      out.push({ ...asRecord(value), tier: key });
    }
  }
  return out;
}

function normalizeCostumes(c: Json): Json[] {
  return asArray<Json>(c.costumes).map(asRecord).filter((x) => Object.keys(x).length > 0);
}

function normalizeSections(source: Json): Json[] {
  const out: Json[] = [];
  for (const item of asArray(source.sections)) {
    if (typeof item === "string") {
      const title = asString(item);
      if (title) out.push({ title, content: "" });
      continue;
    }
    const obj = asRecord(item);
    const title = firstString(obj.title, obj.heading, obj.name, obj.label);
    const content = firstString(obj.content, obj.body, obj.description, obj.summary, obj.text);
    const bullets = asArray(obj.bullets || obj.items || obj.points).map(asString).filter(Boolean);
    out.push({ title, content, bullets, image: pickImage(obj.image, obj.icon) });
  }
  return out.filter((x) => x.title || x.content || (Array.isArray(x.bullets) && x.bullets.length));
}

function formatSkill(item: Json): { name: string; value: string; inline?: boolean; thumb?: string } {
  const name = firstString(item.heading, item.title, item.name, item.label, "Compétence");
  const tag = skillTypeLabel(item);
  const desc = firstString(item.description, item.content, item.body, item.summary, item.effect, item.text, "Non disponible.");
  const lines = [tag && `**${tag}**`, desc].filter(Boolean).join("\n");
  return {
    name: truncate(name, 256),
    value: truncate(lines, MAX_FIELD),
    thumb: pickImage(item.image, item.icon, item.thumbnail),
  };
}

function formatPotential(item: Json): { name: string; value: string } {
  const name = firstString(item.heading, item.title, item.name, item.tier, "Palier");
  const desc = firstString(item.description, item.content, item.body, item.summary, item.text, "Non disponible.");
  return { name: truncate(name, 256), value: truncate(desc, MAX_FIELD) };
}

function formatCostume(item: Json): { title: string; description: string; image?: string } {
  const title = firstString(item.title, item.name, item.heading, "Costume");
  const subtitle = firstString(item.subtitle, item.tag, item.effect_name);
  const description = [subtitle && `**${subtitle}**`, firstString(item.description, item.content, item.body, item.summary)].filter(Boolean).join("\n\n") || "Non disponible.";
  return { title, description, image: pickImage(item.image, item.icon, item.thumbnail) };
}

function renderPagedMenu(title: string, fileLabel: string, page: number, items: Json[], menuPrefix: string, pickPrefix: string): ViewResult {
  const safePage = Math.max(0, Math.min(page, Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1)));
  const slice = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  return {
    embeds: [{
      title,
      description: items.length ? `Page ${safePage + 1}/${Math.max(1, Math.ceil(items.length / PAGE_SIZE))}` : "Aucune donnée.",
      color: COLORS.brand,
      footer: { text: `${items.length} ${fileLabel}` },
    }],
    components: items.length
      ? [
          selectMenu(
            cid(pickPrefix, safePage),
            `Choisir ${fileLabel === 'personnages' ? 'un personnage' : fileLabel === 'armes' ? 'une arme' : fileLabel === 'boss' ? 'un boss' : 'un guide'}`,
            slice.map((item) => ({
              label: truncate(asString(item.name), 100),
              description: truncate(firstString(item.description, item.summary, item.category), 100),
              value: asString(item.id),
            })),
          ),
          actionRow(
            button("Précédent", cid(menuPrefix, safePage - 1), 2, safePage <= 0),
            button("Suivant", cid(menuPrefix, safePage + 1), 2, safePage >= Math.ceil(items.length / PAGE_SIZE) - 1),
          ),
        ]
      : [],
  };
}

function renderCharacterMenu(chars: Json[], page = 0): ViewResult {
  return renderPagedMenu("Choisir un personnage", "personnages", page, chars, "perso", "perso-pick");
}

function renderWeaponsTypeMenu(weapons: Json[]): ViewResult {
  const types = uniqStrings(weapons.map((w) => normalizeWeaponType(w.weapon_type || w.type))).sort((a, b) => a.localeCompare(b));
  return {
    embeds: [{ title: "Types d'armes", description: "Choisir un type d'arme.", color: COLORS.brand }],
    components: chunk(types, 5).slice(0, 5).map((group) =>
      actionRow(...group.map((type) => button(type, cid("arme-type", slugify(type)), 1, false, emojiForWeapon(type)))),
    ),
  };
}

function renderWeaponsMenu(weapons: Json[], weaponType: string, page = 0): ViewResult {
  const filtered = weapons.filter((w) => slugify(normalizeWeaponType(w.weapon_type || w.type)) === slugify(weaponType));
  const safePage = Math.max(0, Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1)));
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  return {
    embeds: [{ title: normalizeWeaponType(weaponType), description: `Choisir une arme. Page ${safePage + 1}/${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}`, color: COLORS.brand }],
    components: [
      selectMenu(
        cid("arme-pick", slugify(weaponType), safePage),
        "Choisir une arme",
        slice.map((w) => ({
          label: truncate(asString(w.name), 100),
          description: truncate(firstString(w.description, w.rarity && `Rareté ${w.rarity}`), 100),
          value: asString(w.id),
        })),
      ),
      actionRow(
        button("Précédent", cid("arme-list", slugify(weaponType), safePage - 1), 2, safePage <= 0),
        button("Suivant", cid("arme-list", slugify(weaponType), safePage + 1), 2, safePage >= Math.ceil(filtered.length / PAGE_SIZE) - 1),
        button("Retour types", cid("arme-menu"), 2),
      ),
    ],
  };
}

function renderWeaponDetail(w: Json): ViewResult {
  const fields = [
    { name: "Type", value: normalizeWeaponType(w.weapon_type || w.type) || "—", inline: true },
    { name: "Rareté", value: asString(w.rarity) || "—", inline: true },
    { name: "Stat principale", value: asString(w.attack) ? `ATQ: ${w.attack}` : "—", inline: true },
    {
      name: "Stat secondaire",
      value: [asString(w.secondary_stat_name), asString(w.secondary_stat_value)].filter(Boolean).join(" • ") || "—",
      inline: true,
    },
  ];
  return {
    embeds: [{
      title: asString(w.name),
      description: firstString(w.description, "Non disponible."),
      color: COLORS.info,
      thumbnail: pickImage(w.image) ? { url: pickImage(w.image) } : undefined,
      url: asString(w.url) || undefined,
      fields,
    }],
    components: [actionRow(button("Retour types", cid("arme-menu"), 2))],
  };
}

function renderCharacterHome(c: Json): ViewResult {
  const weapons = characterWeaponTypes(c).map((t) => `${emojiForWeapon(t)} ${t}`).join(", ") || "—";
  const fields = [
    { name: `${emojiForElement(c.element)} Élément`, value: asString(c.element) || "—", inline: true },
    { name: "⚔️ Types d'armes", value: weapons, inline: true },
  ];
  const embed: Embed = {
    title: asString(c.name),
    description: firstString(c.description, "Non disponible."),
    color: COLORS.brand,
    fields,
    url: asString(c.url) || undefined,
  };
  const image = characterImageOf(c);
  if (image) embed.thumbnail = { url: image };
  const icon = elementIconOf(c);
  if (icon) embed.author = { name: envBrandPlaceholder, icon_url: icon };
  return { embeds: [embed], components: characterNav(c, "home") };
}

const envBrandPlaceholder = "Escanor";

function renderCharacterStats(c: Json): ViewResult {
  const stats = parseMaybeJsonObject(c.base_stats);
  const entries = Object.entries(stats);
  const statLines = entries.length
    ? entries.map(([k, v]) => `${emojiForStat(k)} **${humanizeKey(k)}**: ${asString(v)}`)
    : ["Aucune statistique disponible."];
  const [left, right] = splitForFields(statLines);
  const embed: Embed = {
    title: asString(c.name),
    description: "Statistiques",
    color: COLORS.info,
    fields: [
      { name: "Base stats", value: left, inline: true },
      { name: "\u200b", value: right, inline: true },
    ],
  };
  const image = characterImageOf(c);
  if (image) embed.thumbnail = { url: image };
  return { embeds: [embed], components: characterNav(c, "stats") };
}

function characterNav(c: Json, active: string, extraRows: Component[] = []): Component[] {
  const rows: Component[] = [
    actionRow(
      button("Accueil", cid("perso-tab", c.id, "home"), active === "home" ? 1 : 2),
      button("Stats", cid("perso-tab", c.id, "stats"), active === "stats" ? 1 : 2),
      button("Armes & Skills", cid("perso-skills", c.id, slugify(characterWeaponTypes(c)[0] || "")), active === "skills" ? 1 : 2, "⚔️"),
      button("Potentiels", cid("perso-pots", c.id, slugify(characterWeaponTypes(c)[0] || ""), 0), active === "potentials" ? 1 : 2, "✨"),
      button("Costumes", cid("perso-cost", c.id, 0), active === "costumes" ? 1 : 2, "👗"),
    ),
    ...extraRows,
    actionRow(button("Retour au menu", cid("perso", 0), 2)),
  ];
  return rows;
}

function characterWeaponTypeButtons(c: Json, prefix: string, activeWeapon: string, page = 0): Component[] {
  const types = characterWeaponTypes(c);
  if (!types.length) return [];
  return [
    actionRow(
      ...types.slice(0, 5).map((type) => {
        const active = slugify(type) === slugify(activeWeapon);
        if (prefix === "skills") return button(type, cid("perso-skills", c.id, slugify(type)), active ? 3 : 2, false, emojiForWeapon(type));
        return button(type, cid("perso-pots", c.id, slugify(type), page), active ? 3 : 2, false, emojiForWeapon(type));
      }),
    ),
  ];
}

function renderCharacterSkills(c: Json, weaponType?: string): ViewResult {
  const profile = findWeaponProfile(c, weaponType);
  const selected = normalizeWeaponType(profile?.weapon_type || weaponType || characterWeaponTypes(c)[0]);
  const skills = normalizeSkills(asRecord(profile));
  const header: Embed = {
    title: `${asString(c.name)} — ${selected}`,
    description: `Armes & Skills${selected ? ` • ${selected}` : ""}`,
    color: COLORS.ok,
  };
  const image = characterImageOf(c);
  if (image) header.thumbnail = { url: image };
  const embeds: Embed[] = [header];
  if (!profile) {
    embeds.push({ title: asString(c.name), description: "Aucun profil d'arme disponible.", color: COLORS.neutral });
  } else if (!skills.length) {
    embeds.push({ title: asString(c.name), description: "Aucune compétence disponible.", color: COLORS.neutral });
  } else {
    for (const skill of skills.slice(0, 9)) {
      const field = formatSkill(skill);
      const embed: Embed = { title: field.name, description: field.value, color: COLORS.info };
      if (field.thumb) embed.thumbnail = { url: field.thumb };
      embeds.push(embed);
    }
  }
  return { embeds, components: characterNav(c, "skills", characterWeaponTypeButtons(c, "skills", selected)) };
}

function renderCharacterPotentials(c: Json, weaponType?: string, page = 0): ViewResult {
  const profile = findWeaponProfile(c, weaponType);
  const selected = normalizeWeaponType(profile?.weapon_type || weaponType || characterWeaponTypes(c)[0]);
  const items = normalizePotentials(asRecord(profile));
  const safePage = Math.max(0, Math.min(Number(page) || 0, Math.max(0, Math.ceil(items.length / 10) - 1)));
  const slice = items.slice(safePage * 10, safePage * 10 + 10);
  const fields = slice.length ? slice.map(formatPotential) : [{ name: "Potentiels", value: "Non disponible." }];
  const embed: Embed = {
    title: `${asString(c.name)} — Potentiels`,
    description: `${selected}${items.length ? ` • Page ${safePage + 1}/${Math.max(1, Math.ceil(items.length / 10))}` : ""}`,
    color: COLORS.ok,
    fields,
  };
  const image = characterImageOf(c);
  if (image) embed.thumbnail = { url: image };
  const extra = [...characterWeaponTypeButtons(c, "potentials", selected, safePage)];
  if (items.length > 10) {
    extra.push(
      actionRow(
        button("Précédent", cid("perso-pots", c.id, slugify(selected), safePage - 1), 2, safePage <= 0),
        button("Suivant", cid("perso-pots", c.id, slugify(selected), safePage + 1), 2, safePage >= Math.ceil(items.length / 10) - 1),
      ),
    );
  }
  return { embeds: [embed], components: characterNav(c, "potentials", extra) };
}

function renderCharacterCostumes(c: Json, page = 0): ViewResult {
  const items = normalizeCostumes(c);
  const safePage = Math.max(0, Math.min(Number(page) || 0, Math.max(0, items.length - 1)));
  const costume = items[safePage];
  const embed: Embed = costume
    ? {
        title: `${asString(c.name)} — ${formatCostume(costume).title}`,
        description: formatCostume(costume).description,
        color: COLORS.brand,
      }
    : {
        title: `${asString(c.name)} — Costumes`,
        description: "Non disponible.",
        color: COLORS.neutral,
      };
  const image = costume ? formatCostume(costume).image || characterImageOf(c) : characterImageOf(c);
  if (image) embed.thumbnail = { url: image };
  const extra: Component[] = [];
  if (items.length > 1) {
    extra.push(
      actionRow(
        button("Précédent", cid("perso-cost", c.id, safePage - 1), 2, safePage <= 0),
        button("Suivant", cid("perso-cost", c.id, safePage + 1), 2, safePage >= items.length - 1),
      ),
    );
  }
  return { embeds: [embed], components: characterNav(c, "costumes", extra) };
}

function renderEntitySections(entity: Json, title: string, mode: "boss" | "guide", page = 0): ViewResult {
  const sections = normalizeSections(entity);
  const safePage = Math.max(0, Math.min(Number(page) || 0, Math.max(0, sections.length - 1)));
  const section = sections[safePage];
  const image = pickImage(entity.image, ...(asArray(entity.images) as string[]));
  const overview: Embed = {
    title,
    description: firstString(entity.summary, entity.description, entity.page_summary, "Non disponible."),
    color: mode === "boss" ? COLORS.danger : COLORS.info,
    url: asString(entity.url || entity.source_url) || undefined,
  };
  if (image) overview.thumbnail = { url: image };
  const embeds: Embed[] = [overview];
  if (section) {
    embeds.push({
      title: section.title || `Section ${safePage + 1}`,
      description: [section.content, ...asArray(section.bullets).map((x) => `• ${x}`)].filter(Boolean).join("\n") || "—",
      color: mode === "boss" ? COLORS.danger : COLORS.ok,
      thumbnail: section.image ? { url: section.image } : undefined,
    });
  } else if (asString(entity.page_text)) {
    embeds.push({ title: "Contenu", description: truncate(asString(entity.page_text), 3500), color: COLORS.neutral });
  }
  const rows: Component[] = [
    actionRow(
      button("Aperçu", cid(mode, "view", entity.id, "overview", 0), 1),
      button("Sections", cid(mode, "view", entity.id, "sections", safePage), 2, sections.length === 0),
      button("Précédent", cid(mode, "view", entity.id, "sections", safePage - 1), 2, safePage <= 0 || sections.length === 0),
      button("Suivant", cid(mode, "view", entity.id, "sections", safePage + 1), 2, safePage >= sections.length - 1 || sections.length === 0),
      button("Retour", cid(mode, 0), 2),
    ),
  ];
  const link = asString(entity.url || entity.source_url);
  if (link) rows.push(actionRow(linkButton("Source", link)));
  return { embeds, components: rows };
}

function renderBossMenu(items: Json[], page = 0): ViewResult {
  return renderPagedMenu("Boss", "boss", page, items, "boss", "boss-pick");
}

function renderGuideMenu(items: Json[], page = 0): ViewResult {
  return renderPagedMenu("Guides", "guides", page, items, "guide", "guide-pick");
}

async function handlePersoCommand(env: Env): Promise<ViewResult> {
  const chars = await loadData(env, "characters");
  return renderCharacterMenu(chars, 0);
}

async function handleArmesCommand(env: Env): Promise<ViewResult> {
  const weapons = await loadData(env, "weapons");
  return renderWeaponsTypeMenu(weapons);
}

async function handleBossCommand(env: Env): Promise<ViewResult> {
  const items = await loadData(env, "bosses");
  return renderBossMenu(items, 0);
}

async function handleGuidesCommand(env: Env): Promise<ViewResult> {
  const items = await loadData(env, "guides");
  return renderGuideMenu(items, 0);
}

function findById(items: Json[], id: string): Json | undefined {
  return items.find((x) => asString(x.id) === id);
}

async function handleComponent(env: Env, data: Json): Promise<ViewResult> {
  const id = asString(data.custom_id);
  const parts = id.split("~");

  if (parts[0] === "perso") {
    const chars = await loadData(env, "characters");
    return renderCharacterMenu(chars, Number(parts[1] || 0));
  }
  if (parts[0] === "perso-pick") {
    const chars = await loadData(env, "characters");
    const picked = findById(chars, asString(asArray(data.values)[0]));
    return picked ? renderCharacterHome(picked) : errorView("Personnage introuvable.");
  }
  if (parts[0] === "perso-tab") {
    const chars = await loadData(env, "characters");
    const picked = findById(chars, parts[1]);
    if (!picked) return errorView("Personnage introuvable.");
    if (parts[2] === "home") return renderCharacterHome(picked);
    if (parts[2] === "stats") return renderCharacterStats(picked);
  }
  if (parts[0] === "perso-skills") {
    const chars = await loadData(env, "characters");
    const picked = findById(chars, parts[1]);
    return picked ? renderCharacterSkills(picked, parts[2]) : errorView("Personnage introuvable.");
  }
  if (parts[0] === "perso-pots") {
    const chars = await loadData(env, "characters");
    const picked = findById(chars, parts[1]);
    return picked ? renderCharacterPotentials(picked, parts[2], Number(parts[3] || 0)) : errorView("Personnage introuvable.");
  }
  if (parts[0] === "perso-cost") {
    const chars = await loadData(env, "characters");
    const picked = findById(chars, parts[1]);
    return picked ? renderCharacterCostumes(picked, Number(parts[2] || 0)) : errorView("Personnage introuvable.");
  }

  if (parts[0] === "arme-menu") {
    const weapons = await loadData(env, "weapons");
    return renderWeaponsTypeMenu(weapons);
  }
  if (parts[0] === "arme-type") {
    const weapons = await loadData(env, "weapons");
    return renderWeaponsMenu(weapons, parts[1], 0);
  }
  if (parts[0] === "arme-list") {
    const weapons = await loadData(env, "weapons");
    return renderWeaponsMenu(weapons, parts[1], Number(parts[2] || 0));
  }
  if (parts[0] === "arme-pick") {
    const weapons = await loadData(env, "weapons");
    const picked = findById(weapons, asString(asArray(data.values)[0]));
    return picked ? renderWeaponDetail(picked) : errorView("Arme introuvable.");
  }

  if (parts[0] === "boss") {
    const items = await loadData(env, "bosses");
    if (parts.length === 2 && /^\d+$/.test(parts[1])) return renderBossMenu(items, Number(parts[1] || 0));
    if (parts[1] === "view") {
      const picked = findById(items, parts[2]);
      return picked ? renderEntitySections(picked, asString(picked.name), "boss", Number(parts[4] || 0)) : errorView("Boss introuvable.");
    }
  }
  if (parts[0] === "boss-pick") {
    const items = await loadData(env, "bosses");
    const picked = findById(items, asString(asArray(data.values)[0]));
    return picked ? renderEntitySections(picked, asString(picked.name), "boss", 0) : errorView("Boss introuvable.");
  }

  if (parts[0] === "guide") {
    const items = await loadData(env, "guides");
    if (parts.length === 2 && /^\d+$/.test(parts[1])) return renderGuideMenu(items, Number(parts[1] || 0));
    if (parts[1] === "view") {
      const picked = findById(items, parts[2]);
      return picked ? renderEntitySections(picked, asString(picked.name), "guide", Number(parts[4] || 0)) : errorView("Guide introuvable.");
    }
  }
  if (parts[0] === "guide-pick") {
    const items = await loadData(env, "guides");
    const picked = findById(items, asString(asArray(data.values)[0]));
    return picked ? renderEntitySections(picked, asString(picked.name), "guide", 0) : errorView("Guide introuvable.");
  }

  return errorView("Interaction inconnue.");
}

async function handleInteraction(req: Request, env: Env): Promise<Response> {
  if (!(await verifyDiscordRequest(req, env))) {
    return new Response("Bad request signature.", { status: 401 });
  }

  const interaction = (await req.json()) as Json;
  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  try {
    if (interaction.type === 2) {
      const name = asString(interaction.data?.name).toLowerCase();
      if (name === "perso") return message(await handlePersoCommand(env));
      if (name === "armes") return message(await handleArmesCommand(env));
      if (name === "boss") return message(await handleBossCommand(env));
      if (name === "guides") return message(await handleGuidesCommand(env));
      return message(errorView(`Commande inconnue: ${name}`));
    }
    if (interaction.type === 3) {
      return message(await handleComponent(env, asRecord(interaction.data)), true);
    }
    return message(errorView("Type d'interaction non supporté."));
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return message(errorView(text), interaction.type === 3);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/interactions" && req.method === "POST") {
      return handleInteraction(req, env);
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, brand: env.BOT_BRAND || "Escanor" });
    }
    return new Response("Not found", { status: 404 });
  },
};
