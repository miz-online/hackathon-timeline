import { publishChange } from "./events.server";
import { TABLE_BY_NAME } from "./schema.server";
import { applyInsertDefaults, fromDbRow, getDb, toDbValue } from "./sqlite-db.server";
import { localStorageApi } from "./local-storage.server";

type Result<T> = { data: T; error: { message: string } | null };
type Filter = { sql: string; args: unknown[] };

function quoteCols(table: string, cols: string | undefined): string {
  if (!cols || cols.trim() === "*") return "*";
  const names = cols
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const known = new Set(TABLE_BY_NAME.get(table)?.columns.map((c) => c.name) ?? []);
  for (const n of names) {
    if (!known.has(n)) {
      const err = new Error(`column "${n}" does not exist`) as Error & { code?: string };
      err.code = "42703";
      throw err;
    }
  }
  return names.map((n) => `"${n}"`).join(", ");
}

class SqliteQuery<T> implements PromiseLike<Result<T>> {
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private cols: string | undefined;
  private returning = false;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private limitN: number | undefined;
  private rows: Record<string, unknown>[] = [];
  private values: Record<string, unknown> = {};
  private row: "many" | "single" | "maybe" = "many";

  constructor(private table: string) {}

  select(cols?: string) {
    if (this.mode === "select") this.cols = cols;
    else {
      this.returning = true;
      this.cols = cols;
    }
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
    this.mode = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(values: Record<string, unknown>) {
    this.mode = "update";
    this.values = values;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  private push(column: string, op: string, value: unknown) {
    this.filters.push({ sql: `"${column}" ${op} ?`, args: [toDbValue(this.table, column, value)] });
    return this;
  }

  eq(column: string, value: unknown) {
    return this.push(column, "=", value);
  }
  neq(column: string, value: unknown) {
    return this.push(column, "<>", value);
  }
  gt(column: string, value: unknown) {
    return this.push(column, ">", value);
  }
  gte(column: string, value: unknown) {
    return this.push(column, ">=", value);
  }
  lt(column: string, value: unknown) {
    return this.push(column, "<", value);
  }
  lte(column: string, value: unknown) {
    return this.push(column, "<=", value);
  }
  like(column: string, pattern: string) {
    return this.push(column, "like", pattern);
  }
  ilike(column: string, pattern: string) {
    this.filters.push({ sql: `"${column}" like ? collate nocase`, args: [pattern] });
    return this;
  }
  is(column: string, value: null | boolean) {
    if (value === null) this.filters.push({ sql: `"${column}" is null`, args: [] });
    else this.filters.push({ sql: `"${column}" = ?`, args: [value ? 1 : 0] });
    return this;
  }
  in(column: string, values: unknown[]) {
    if (values.length === 0) {
      this.filters.push({ sql: "0 = 1", args: [] });
      return this;
    }
    this.filters.push({
      sql: `"${column}" in (${values.map(() => "?").join(", ")})`,
      args: values.map((v) => toDbValue(this.table, column, v)),
    });
    return this;
  }
  not(column: string, op: string, value: unknown) {
    if (op === "is" && value === null) this.filters.push({ sql: `"${column}" is not null`, args: [] });
    else this.filters.push({ sql: `not ("${column}" = ?)`, args: [toDbValue(this.table, column, value)] });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const dir = opts?.ascending === false ? "desc" : "asc";
    this.orders.push(`"${column}" ${dir}`);
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  single() {
    this.row = "single";
    return this;
  }

  maybeSingle() {
    this.row = "maybe";
    return this;
  }

  private where(): { sql: string; args: unknown[] } {
    if (this.filters.length === 0) return { sql: "", args: [] };
    return {
      sql: ` where ${this.filters.map((f) => f.sql).join(" and ")}`,
      args: this.filters.flatMap((f) => f.args),
    };
  }

  private tenantIdOf(rows: Record<string, unknown>[]): string | null {
    for (const r of rows) {
      const id = r["tenant_id"];
      if (typeof id === "string") return id;
    }
    return null;
  }

  private async run(): Promise<Result<unknown>> {
    const db = await getDb();
    const table = this.table;
    const shape = (rows: Record<string, unknown>[]) => rows.map((r) => fromDbRow(table, r));

    if (this.mode === "select") {
      const cols = quoteCols(table, this.cols);
      const where = this.where();
      const order = this.orders.length ? ` order by ${this.orders.join(", ")}` : "";
      const limit = this.limitN !== undefined ? ` limit ${this.limitN}` : "";
      const out = shape(
        db.prepare(`select ${cols} from "${table}"${where.sql}${order}${limit}`).all(...where.args) as Record<
          string,
          unknown
        >[],
      );
      return { data: out, error: null };
    }

    if (this.mode === "insert") {
      const inserted: Record<string, unknown>[] = [];
      for (const raw of this.rows) {
        const row = applyInsertDefaults(table, raw);
        const keys = Object.keys(row).filter((k) => TABLE_BY_NAME.get(table)?.columns.some((c) => c.name === k));
        const sql = `insert into "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) values (${keys
          .map(() => "?")
          .join(", ")}) returning *`;
        const res = db.prepare(sql).all(...keys.map((k) => toDbValue(table, k, row[k]))) as Record<string, unknown>[];
        inserted.push(...res);
      }
      publishChange({ table, tenantId: this.tenantIdOf(inserted) });
      return { data: shape(inserted), error: null };
    }

    if (this.mode === "update") {
      const values: Record<string, unknown> = { ...this.values };
      const meta = TABLE_BY_NAME.get(table);
      if (meta?.columns.some((c) => c.name === "updated_at") && values["updated_at"] === undefined) {
        values["updated_at"] = new Date().toISOString();
      }
      // Cloud resets the notification state when an entry's time moves.
      if (table === "entries" && values["time"] !== undefined && values["notified_at"] === undefined) {
        values["notified_at"] = null;
        values["notified_teams"] = [];
      }
      const keys = Object.keys(values).filter((k) => meta?.columns.some((c) => c.name === k));
      const where = this.where();
      const sql = `update "${table}" set ${keys.map((k) => `"${k}" = ?`).join(", ")}${where.sql} returning *`;
      const updated = db
        .prepare(sql)
        .all(...keys.map((k) => toDbValue(table, k, values[k])), ...where.args) as Record<string, unknown>[];
      publishChange({ table, tenantId: this.tenantIdOf(updated) });
      return { data: shape(updated), error: null };
    }

    const where = this.where();
    const deleted = db.prepare(`delete from "${table}"${where.sql} returning *`).all(...where.args) as Record<
      string,
      unknown
    >[];
    publishChange({ table, tenantId: this.tenantIdOf(deleted) });
    return { data: shape(deleted), error: null };
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const exec = async (): Promise<Result<T>> => {
      try {
        const res = await this.run();
        const rows = res.data as Record<string, unknown>[];
        if (this.row === "many") {
          if (this.mode !== "select" && !this.returning) return { data: null as T, error: null };
          return { data: rows as T, error: null };
        }
        if (rows.length === 0) {
          if (this.row === "single") return { data: null as T, error: { message: "No rows found" } };
          return { data: null as T, error: null };
        }
        return { data: rows[0] as T, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as { code?: string }).code;
        return { data: null as T, error: code ? ({ message, code } as never) : { message } };
      }
    };
    return exec().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  catch<R>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null) {
    return Promise.resolve(this.then()).catch(onrejected ?? undefined);
  }
}

type ChannelCallback = () => void;

class LocalChannel {
  private handlers: { table: string; cb: ChannelCallback }[] = [];
  private unsubscribe: (() => void) | undefined;

  on(_type: string, filter: { table?: string }, cb: ChannelCallback) {
    if (filter?.table) this.handlers.push({ table: filter.table, cb });
    return this;
  }

  subscribe() {
    void import("./events.server").then(({ subscribeChanges }) => {
      this.unsubscribe = subscribeChanges((event) => {
        for (const h of this.handlers) if (h.table === event.table) h.cb();
      });
    });
    return this;
  }

  close() {
    this.unsubscribe?.();
  }
}

/** Supabase-compatible surface backed by SQLite + the local filesystem. */
export function createLocalClient() {
  return {
    from(table: string) {
      return new SqliteQuery<unknown>(table);
    },
    storage: localStorageApi(),
    async rpc(name: string) {
      const { runLocalRpc } = await import("./local-scheduler.server");
      return runLocalRpc(name);
    },
    channel(_name: string) {
      return new LocalChannel();
    },
    removeChannel(channel: { close: () => void }) {
      channel.close();
    },
  };
}
