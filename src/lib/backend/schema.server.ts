/**
 * Single source of truth for the self-hosted (SQLite) schema.
 * Mirrors the Cloud Postgres schema column-for-column, including defaults,
 * so application code sees identical records in both variants.
 */

export type ColKind = "uuid" | "text" | "int" | "bool" | "ts" | "textArray";

export type ColumnMeta = {
  name: string;
  kind: ColKind;
  nullable?: boolean;
  /** Literal default, or the sentinels "uuid" / "now". */
  def?: string | number | boolean | "uuid" | "now" | null;
  primaryKey?: boolean;
  unique?: boolean;
  /** `table.column` reference; deletes cascade like in Cloud. */
  references?: string;
};

export type TableMeta = { name: string; columns: ColumnMeta[] };

const ts = (name: string, def?: "now" | null, nullable = false): ColumnMeta => ({
  name,
  kind: "ts",
  ...(def !== undefined ? { def } : {}),
  nullable,
});

export const TABLES: TableMeta[] = [
  {
    name: "tenants",
    columns: [
      { name: "id", kind: "uuid", def: "uuid", primaryKey: true },
      { name: "key", kind: "text", unique: true },
      { name: "name", kind: "text", def: "My organization" },
      { name: "past_grace_minutes", kind: "int", def: 15 },
      ts("created_at", "now"),
      { name: "template", kind: "text", def: "zeitplan" },
      { name: "logo_url", kind: "text", nullable: true },
      { name: "logo_height", kind: "int", def: 78 },
      { name: "accent_color", kind: "text", def: "#C0322B" },
      { name: "ad_seconds", kind: "int", def: 10 },
      { name: "pin_hash", kind: "text", nullable: true },
      { name: "focus_mode", kind: "text", def: "count" },
      { name: "focus_count", kind: "int", def: 3 },
      { name: "focus_minutes", kind: "int", def: 30 },
      { name: "focus_dim_opacity", kind: "int", def: 35 },
      { name: "practice_minutes", kind: "int", def: 10 },
      { name: "practice_room_scope", kind: "text", def: "all" },
      { name: "team_edit_locked", kind: "bool", def: false },
    ],
  },
  {
    name: "color_schemes",
    columns: [
      { name: "id", kind: "uuid", def: "uuid", primaryKey: true },
      { name: "tenant_id", kind: "uuid", references: "tenants.id" },
      { name: "name", kind: "text" },
      { name: "color", kind: "text", def: "#C0322B" },
      ts("created_at", "now"),
      { name: "ref_id", kind: "text", nullable: true },
    ],
  },
  {
    name: "rooms",
    columns: [
      { name: "id", kind: "uuid", def: "uuid", primaryKey: true },
      { name: "tenant_id", kind: "uuid", references: "tenants.id" },
      { name: "name", kind: "text" },
      ts("created_at", "now"),
      { name: "color_scheme_id", kind: "uuid", nullable: true },
      { name: "template", kind: "text", nullable: true },
      { name: "ref_id", kind: "text", nullable: true },
    ],
  },
  {
    name: "entries",
    columns: [
      { name: "id", kind: "uuid", def: "uuid", primaryKey: true },
      { name: "tenant_id", kind: "uuid", references: "tenants.id" },
      ts("time"),
      { name: "description", kind: "text" },
      { name: "tags", kind: "textArray", def: null },
      ts("created_at", "now"),
      ts("updated_at", "now"),
      { name: "title", kind: "text", def: "" },
      { name: "color_scheme_id", kind: "uuid", nullable: true },
      { name: "notify", kind: "bool", def: true },
      ts("notified_at", null, true),
      ts("end_time", null, true),
      { name: "background_path", kind: "text", nullable: true },
      { name: "background_content_type", kind: "text", nullable: true },
      { name: "background_align", kind: "text", def: "right-top" },
      { name: "background_height", kind: "int", def: 80 },
      { name: "background_opacity", kind: "int", def: 100 },
      { name: "background_margin", kind: "int", def: 0 },
      { name: "background_tint", kind: "text", nullable: true },
      { name: "kind", kind: "text", def: "entry" },
      { name: "notified_teams", kind: "textArray", def: null },
      { name: "register_token", kind: "text", nullable: true },
    ],
  },
  {
    name: "teams",
    columns: [
      { name: "id", kind: "uuid", def: "uuid", primaryKey: true },
      { name: "tenant_id", kind: "uuid", references: "tenants.id" },
      { name: "ref_id", kind: "text", nullable: true },
      { name: "name", kind: "text" },
      { name: "members", kind: "text", def: "" },
      { name: "project", kind: "text", def: "" },
      { name: "room_id", kind: "uuid", nullable: true },
      { name: "sort_order", kind: "int", def: 0 },
      ts("created_at", "now"),
      ts("updated_at", "now"),
      { name: "edit_code", kind: "text", nullable: true },
      { name: "self_registered", kind: "bool", def: false },
    ],
  },
  {
    name: "ad_sets",
    columns: [
      { name: "id", kind: "uuid", def: "uuid", primaryKey: true },
      { name: "tenant_id", kind: "uuid", references: "tenants.id" },
      { name: "ref_id", kind: "text", nullable: true },
      { name: "name", kind: "text", def: "Ads" },
      { name: "ad_seconds", kind: "int", def: 10 },
      { name: "sort_order", kind: "int", def: 0 },
      ts("created_at", "now"),
      ts("updated_at", "now"),
    ],
  },
  {
    name: "ads",
    columns: [
      { name: "id", kind: "uuid", def: "uuid", primaryKey: true },
      { name: "tenant_id", kind: "uuid", references: "tenants.id" },
      { name: "name", kind: "text", def: "" },
      { name: "path", kind: "text" },
      { name: "content_type", kind: "text", def: "image/png" },
      { name: "sort_order", kind: "int", def: 0 },
      ts("created_at", "now"),
      ts("updated_at", "now"),
      { name: "ad_set_id", kind: "uuid" },
    ],
  },
  {
    name: "webhooks",
    columns: [
      { name: "id", kind: "uuid", def: "uuid", primaryKey: true },
      { name: "tenant_id", kind: "uuid", references: "tenants.id" },
      { name: "ref_id", kind: "text", nullable: true },
      { name: "name", kind: "text" },
      { name: "type", kind: "text", def: "discord" },
      { name: "url", kind: "text" },
      { name: "enabled", kind: "bool", def: true },
      ts("created_at", "now"),
      ts("updated_at", "now"),
    ],
  },
];

export const TABLE_BY_NAME = new Map(TABLES.map((t) => [t.name, t]));

export function columnMeta(table: string, column: string): ColumnMeta | undefined {
  return TABLE_BY_NAME.get(table)?.columns.find((c) => c.name === column);
}

function sqlType(kind: ColKind): string {
  switch (kind) {
    case "int":
      return "integer";
    case "bool":
      return "integer";
    default:
      return "text";
  }
}

function literal(value: string | number | boolean): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${value.replace(/'/g, "''")}'`;
}

/** Idempotent DDL applied on every start of the self-hosted container. */
export function schemaSql(): string {
  const out: string[] = ["pragma foreign_keys = on;"];
  for (const table of TABLES) {
    const cols = table.columns.map((c) => {
      const parts = [`"${c.name}"`, sqlType(c.kind)];
      if (c.primaryKey) parts.push("primary key");
      if (!c.nullable) parts.push("not null");
      if (c.unique) parts.push("unique");
      if (c.def === "uuid" || c.def === "now") {
        // Filled in by the adapter on insert (SQLite has no gen_random_uuid()).
      } else if (c.def === null) {
        parts.push("default '[]'");
      } else if (c.def !== undefined) {
        parts.push(`default ${literal(c.def)}`);
      }
      if (c.references) {
        const [refTable, refCol] = c.references.split(".");
        parts.push(`references "${refTable}"("${refCol}") on delete cascade`);
      }
      return `  ${parts.join(" ")}`;
    });
    out.push(`create table if not exists "${table.name}" (\n${cols.join(",\n")}\n);`);
    for (const c of table.columns) {
      if (c.name === "tenant_id") out.push(`create index if not exists "${table.name}_tenant_idx" on "${table.name}"("tenant_id");`);
    }
  }
  return out.join("\n");
}
