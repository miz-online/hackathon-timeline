import { columnMeta, schemaSql, TABLE_BY_NAME, type ColKind } from "./schema.server";

type Stmt = { all: (...args: unknown[]) => unknown[]; run: (...args: unknown[]) => unknown };
type Db = { exec: (sql: string) => void; prepare: (sql: string) => Stmt };

let db: Db | undefined;

export function dataDir(): string {
  return process.env["DATA_DIR"] || "/data";
}

async function openDb(): Promise<Db> {
  // Dynamic, bundler-ignored import: only the self-hosted Node runtime loads it.
  const spec = "node:sqlite";
  const { DatabaseSync } = (await import(/* @vite-ignore */ spec)) as {
    DatabaseSync: new (path: string) => Db;
  };
  const fs = await import(/* @vite-ignore */ "node:fs");
  const path = await import(/* @vite-ignore */ "node:path");
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const instance = new DatabaseSync(path.join(dir, "app.db"));
  instance.exec("pragma journal_mode = wal;");
  instance.exec("pragma busy_timeout = 5000;");
  migrateSchema(instance);
  instance.exec(schemaSql());
  applyMissingColumns(instance);
  return instance;
}

function tableExists(instance: Db, name: string): boolean {
  const rows = instance
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .all(name) as { name: string }[];
  return rows.length > 0;
}

function columnExists(instance: Db, table: string, column: string): boolean {
  const rows = instance.prepare(`pragma table_info("${table}")`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

/** One-time migration from the old "ad_sets"/"ads" names to "slide_sets"/"slides". */
function migrateSchema(instance: Db): void {
  // Rename tables
  if (tableExists(instance, "ad_sets") && !tableExists(instance, "slide_sets")) {
    instance.exec('alter table "ad_sets" rename to "slide_sets"');
  }
  if (tableExists(instance, "ads") && !tableExists(instance, "slides")) {
    instance.exec('alter table "ads" rename to "slides"');
  }

  // Rename columns
  if (columnExists(instance, "slide_sets", "ad_seconds")) {
    instance.exec('alter table "slide_sets" rename column "ad_seconds" to "slide_seconds"');
  }
  if (columnExists(instance, "slides", "ad_set_id")) {
    instance.exec('alter table "slides" rename column "ad_set_id" to "slide_set_id"');
  }
  if (columnExists(instance, "tenants", "ad_seconds")) {
    instance.exec('alter table "tenants" rename column "ad_seconds" to "slide_seconds"');
  }

  // Migrate template values
  instance.exec("update tenants set template = 'slides' where template = 'ads'");
  instance.exec("update tenants set template = 'slides:' || substr(template, 5) where template like 'ads:%'");
  instance.exec("update rooms set template = 'slides' where template = 'ads'");
  instance.exec("update rooms set template = 'slides:' || substr(template, 5) where template like 'ads:%'");
}

/** Adds columns introduced after a volume was first created. */
function applyMissingColumns(instance: Db): void {
  for (const [table, meta] of TABLE_BY_NAME) {
    const existing = new Set(
      (instance.prepare(`pragma table_info("${table}")`).all() as { name: string }[]).map((r) => r.name),
    );
    for (const col of meta.columns) {
      if (existing.has(col.name)) continue;
      const type = col.kind === "int" || col.kind === "bool" ? "integer" : "text";
      instance.exec(`alter table "${table}" add column "${col.name}" ${type}`);
    }
  }
}

let opening: Promise<Db> | undefined;

export async function getDb(): Promise<Db> {
  if (db) return db;
  opening ??= openDb().then((d) => (db = d));
  return opening;
}

export function toDbValue(table: string, column: string, value: unknown): unknown {
  const kind: ColKind | undefined = columnMeta(table, column)?.kind;
  if (value === undefined) return null;
  if (kind === "bool") return value === null ? null : value ? 1 : 0;
  if (kind === "textArray") return JSON.stringify(Array.isArray(value) ? value : (value ?? []));
  if (kind === "ts") {
    if (value === null) return null;
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
  }
  if (kind === "int") return value === null ? null : Number(value);
  if (value === null) return null;
  return typeof value === "object" ? JSON.stringify(value) : value;
}

export function fromDbRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const kind = columnMeta(table, key)?.kind;
    if (kind === "bool") out[key] = value === null ? null : Boolean(value);
    else if (kind === "textArray") {
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          out[key] = Array.isArray(parsed) ? parsed : [];
        } catch {
          out[key] = [];
        }
      } else out[key] = [];
    } else out[key] = value ?? null;
  }
  return out;
}

export function applyInsertDefaults(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const meta = TABLE_BY_NAME.get(table);
  if (!meta) return row;
  const out: Record<string, unknown> = { ...row };
  const now = new Date().toISOString();
  for (const col of meta.columns) {
    if (out[col.name] !== undefined && out[col.name] !== null) continue;
    if (out[col.name] === null && col.nullable) continue;
    if (col.def === "uuid") out[col.name] ??= crypto.randomUUID();
    else if (col.def === "now") out[col.name] = now;
    else if (col.def === null && col.kind === "textArray") out[col.name] ??= [];
    else if (col.def !== undefined && out[col.name] === undefined) out[col.name] = col.def;
  }
  return out;
}
