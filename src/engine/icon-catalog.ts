/**
 * icon-catalog.ts — THE single source of truth for built-in node icons.
 *
 * Every consumer derives from here, so there is no second list to keep in sync:
 *   - schema.ts        → BUILTIN_ICONS (the canonical name set)
 *   - diagram-icons.ts → paintIcon() draws each canonical name
 *   - diagram-draw.ts  → normalizeIconName() at the gate (accepts aliases)
 *   - schema-diagnostics.ts → warns on an unknown icon value
 *   - llm-prompts.ts   → iconCatalogPromptList() teaches the upstream AI
 *
 * Pure DATA — zero imports — so it can be a dependency of schema.ts without any
 * import cycle. Pure logic (R2): no DOM / Tauri.
 */

export interface IconInfo {
  /** Short human/AI-facing description of what the icon depicts. */
  desc: string;
  /** Lenient synonyms (lowercase, underscored) that normalize to this name. */
  aliases: string[];
}

/** name → metadata. The KEYS are the canonical icon names; paintIcon draws each. */
export const ICON_CATALOG: Record<string, IconInfo> = {
  router: { desc: "ルーター（経路制御）", aliases: ["gateway", "gw", "rtr"] },
  switch: { desc: "L2/L3 スイッチ", aliases: ["sw", "l2", "l3", "l2switch"] },
  server: { desc: "サーバ（Web/App/汎用ホスト）", aliases: ["host", "vm", "app", "appserver", "webserver", "web", "backend", "api"] },
  database: { desc: "データベース", aliases: ["db", "rds", "sql", "datastore"] },
  cloud: { desc: "クラウド / CDN", aliases: ["cdn", "saas", "internet_cloud"] },
  firewall: { desc: "ファイアウォール / UTM", aliases: ["fw", "utm", "waf"] },
  client: { desc: "クライアント / ブラウザ", aliases: ["browser", "user", "pc", "endpoint"] },
  internet: { desc: "インターネット（地球）", aliases: ["www", "globe", "web_globe", "net"] },
  load_balancer: { desc: "ロードバランサ", aliases: ["lb", "loadbalancer", "alb", "elb", "nlb", "balancer"] },
  wireless_ap: { desc: "無線アクセスポイント", aliases: ["ap", "wifi", "wlan", "accesspoint", "wireless"] },
  storage: { desc: "ストレージ（ディスク/オブジェクト）", aliases: ["disk", "s3", "blob", "nas", "object_storage", "bucket"] },
  printer: { desc: "プリンタ", aliases: ["print"] },
  phone: { desc: "電話 / スマートフォン", aliases: ["mobile", "smartphone", "ip_phone", "voip", "cellphone"] },
  vpn: { desc: "VPN / 暗号化（鍵）", aliases: ["lock", "tunnel", "secure", "encryption"] },
  monitor: { desc: "モニタ / ワークステーション", aliases: ["display", "screen", "workstation"] },
};

/** The canonical icon names (= ICON_CATALOG keys). */
export const ICON_NAMES: string[] = Object.keys(ICON_CATALOG);

// alias (and canonical name) → canonical name
const ALIAS_TO_NAME = new Map<string, string>();
for (const [name, info] of Object.entries(ICON_CATALOG)) {
  ALIAS_TO_NAME.set(name, name);
  for (const a of info.aliases) ALIAS_TO_NAME.set(a, name);
}

/** Lowercase/trim/underscore a raw key for forgiving lookup ("Load Balancer" → "load_balancer"). */
function canonicalKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Resolve a (possibly aliased / loosely-cased) icon string to its canonical
 * built-in name, or `undefined` if it matches nothing. This is the harness being
 * forgiving of upstream output — `db`, `DB`, `Load Balancer` all resolve.
 */
export function normalizeIconName(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  return ALIAS_TO_NAME.get(canonicalKey(raw));
}

/** A bullet list of available icons (name — description) to embed in an LLM prompt. */
export function iconCatalogPromptList(): string {
  return ICON_NAMES.map((n) => `- ${n} — ${ICON_CATALOG[n].desc}`).join("\n");
}
