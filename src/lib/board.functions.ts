import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { effectiveRefId, refIdsFor, slugify, uniqueRefId } from "@/lib/ref-id";
import {
  IO_VERSION,
  SECTIONS,
  tenantDataSchema,
  type Section,
  type TenantData,
} from "@/lib/tenant-io";
import { sendWebhook, type WebhookType } from "@/lib/webhooks";
import { entriesJsonSchema, type EntryJsonItem } from "@/lib/entries-json";
import {
  ENTRY_KINDS,
  PRACTICE_SCOPES,
  expandPracticeEntries,
  type PracticeTeam,
} from "@/lib/practice";
import type { TablesUpdate } from "@/integrations/supabase/types";

// ---------- helpers ----------

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function generateKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

type TenantRow = {
  id: string;
  name: string;
  past_grace_minutes: number;
  template: string;
  logo_url: string | null;
  logo_height: number;
  accent_color: string;
  ad_seconds: number;
  focus_mode: string;
  focus_count: number;
  focus_minutes: number;
  focus_dim_opacity: number;
  practice_minutes: number;
  practice_room_scope: string;
};

const TENANT_COLS =
  "id, name, past_grace_minutes, template, logo_url, logo_height, accent_color, ad_seconds, focus_mode, focus_count, focus_minutes, focus_dim_opacity, practice_minutes, practice_room_scope";

async function resolveTenantRaw(key: string): Promise<TenantRow & { pin_hash: string | null }> {
  const supabase = await getAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .select(`${TENANT_COLS}, pin_hash`)
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unknown tenant key");
  return data;
}

/** Public read of tenant settings (no admin session required). */
async function resolveTenant(key: string): Promise<TenantRow> {
  const { pin_hash: _pin, ...rest } = await resolveTenantRaw(key);
  return rest;
}

/**
 * Admin-scoped tenant resolution: when the tenant has a PIN set, a valid
 * admin session cookie is required. Enforced server-side for every admin fn.
 */
async function requireTenantAdmin(key: string): Promise<TenantRow> {
  const { pin_hash, ...rest } = await resolveTenantRaw(key);
  if (pin_hash) {
    const { isTenantUnlocked } = await import("@/lib/tenant-auth.server");
    if (!(await isTenantUnlocked(rest.id))) throw new Error("TENANT_LOCKED");
  }
  return rest;
}

function filterVisible<T extends { time: string; tags: string[]; end_time?: string | null }>(
  entries: T[],
  roomName: string,
  graceMinutes: number,
): T[] {
  const now = Date.now();
  return entries
    .filter((e) => {
      // With an end time, the entry is visible until that end time.
      // Without one, it stays visible for the configured grace period after start.
      if (e.end_time) return new Date(e.end_time).getTime() >= now;
      const cutoff = now - graceMinutes * 60 * 1000;
      return new Date(e.time).getTime() >= cutoff;
    })
    .filter((e) => e.tags.length === 0 || e.tags.includes(roomName))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

// ---------- entry background images ----------

export const ENTRY_BG_BUCKET = "tenant-entry-backgrounds";

export const ENTRY_BG_ALIGNMENTS = [
  "right-top",
  "right-bottom",
  "right-stretch",
  "fill",
  "time",
] as const;
export type EntryBgAlign = (typeof ENTRY_BG_ALIGNMENTS)[number];

/** Palette roles a transparent image (PNG/SVG) can be recolored with. */
export const ENTRY_BG_TINTS = ["base", "deep", "peak", "highlight", "onBase"] as const;
export type EntryBgTint = (typeof ENTRY_BG_TINTS)[number];

/** Only images with an alpha channel can be tinted. */
export function supportsTint(contentType?: string | null): boolean {
  const c = (contentType ?? "").toLowerCase();
  return c.includes("png") || c.includes("svg") || c.includes("webp") || c.includes("gif");
}

/** Stable public URL for an entry background; changes whenever the file changes. */
function entryBgUrl(tenantKey: string, entryId: string, path: string | null): string | null {
  if (!path) return null;
  const v = path.split("/").pop() ?? "1";
  return `/api/public/entry-bg/${encodeURIComponent(tenantKey)}/${entryId}?v=${encodeURIComponent(v)}`;
}

// ---------- tenant ----------


export const createTenant = createServerFn({ method: "POST" })
  .inputValidator((d?: { pin?: string }) => z.object({ pin: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const pin = data.pin?.trim();
    const pin_hash = pin
      ? await (await import("@/lib/tenant-auth.server")).hashPin(pin)
      : null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = generateKey();
      const { data: row, error } = await supabase
        .from("tenants")
        .insert({ key, pin_hash })
        .select("id, key")
        .single();
      if (!error && row) {
        if (pin_hash) {
          const { markTenantUnlocked } = await import("@/lib/tenant-auth.server");
          await markTenantUnlocked(row.id);
        }
        return { key: row.key };
      }
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    }
    throw new Error("Could not generate unique tenant key");
  });


export const getTenant = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => resolveTenant(data.key));

export const updateTenantSettings = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      key: string;
      name: string;
      past_grace_minutes: number;
      template: string;
      logo_height: number;
      accent_color: string;
      ad_seconds: number;
      focus_mode: string;
      focus_count: number;
      focus_minutes: number;
      focus_dim_opacity: number;
      practice_minutes?: number;
      practice_room_scope?: string;
    }) =>
      z
        .object({
          key: z.string().min(1),
          name: z.string().min(1).max(120),
          past_grace_minutes: z
            .number()
            .int()
            .min(0)
            .max(24 * 60),
          template: z.string().min(1).max(40),
          logo_height: z.number().int().min(16).max(400),
          accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          ad_seconds: z.number().int().min(1).max(600).default(10),
          focus_mode: z.enum(["count", "minutes"]).default("count"),
          focus_count: z.number().int().min(0).max(50).default(3),
          focus_minutes: z.number().int().min(0).max(1440).default(30),
          focus_dim_opacity: z.number().int().min(0).max(100).default(35),
          practice_minutes: z.number().int().min(1).max(600).default(10),
          practice_room_scope: z.enum(PRACTICE_SCOPES).default("all"),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    const { error } = await supabase
      .from("tenants")
      .update({
        name: data.name,
        past_grace_minutes: data.past_grace_minutes,
        template: data.template,
        logo_height: data.logo_height,
        accent_color: data.accent_color.toUpperCase(),
        ad_seconds: data.ad_seconds,
        focus_mode: data.focus_mode,
        focus_count: data.focus_count,
        focus_minutes: data.focus_minutes,
        focus_dim_opacity: data.focus_dim_opacity,
        practice_minutes: data.practice_minutes,
        practice_room_scope: data.practice_room_scope,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateTenantTemplate = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; template: string }) =>
    z.object({ key: z.string().min(1), template: z.string().min(1).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    const { error } = await supabase
      .from("tenants")
      .update({ template: data.template })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const regenerateKey = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    for (let attempt = 0; attempt < 5; attempt++) {
      const newKey = generateKey();
      const { error } = await supabase.from("tenants").update({ key: newKey }).eq("id", id);
      if (!error) return { key: newKey };
      if (!error.message.includes("duplicate")) throw new Error(error.message);
    }
    throw new Error("Could not generate unique key");
  });

export const deleteTenant = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const { data: ads } = await supabase.from("ads").select("path").eq("tenant_id", tenant.id);
    if (ads?.length) await supabase.storage.from("tenant-ads").remove(ads.map((a) => a.path));
    const { data: bgs } = await supabase
      .from("entries")
      .select("background_path")
      .eq("tenant_id", tenant.id)
      .not("background_path", "is", null);
    const bgPaths = (bgs ?? []).map((e) => e.background_path).filter((p): p is string => !!p);
    if (bgPaths.length) await supabase.storage.from(ENTRY_BG_BUCKET).remove(bgPaths);
    if (tenant.logo_url) await supabase.storage.from("tenant-logos").remove([tenant.logo_url]);
    await supabase.from("entries").delete().eq("tenant_id", tenant.id);
    await supabase.from("webhooks").delete().eq("tenant_id", tenant.id);
    await supabase.from("ads").delete().eq("tenant_id", tenant.id);
    await supabase.from("rooms").delete().eq("tenant_id", tenant.id);
    await supabase.from("color_schemes").delete().eq("tenant_id", tenant.id);
    const { error } = await supabase.from("tenants").delete().eq("id", tenant.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// ---------- entries ----------

export const listEntries = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    const { data: rows, error } = await supabase
      .from("entries")
      .select(
        "id, kind, time, end_time, title, description, tags, color_scheme_id, notify, notified_at, background_path, background_content_type, background_align, background_height, background_opacity, background_margin, background_tint",
      )
      .eq("tenant_id", id)
      .order("time", { ascending: true });
    if (error) throw new Error(error.message);
    const entries = rows ?? [];

    return entries.map((e) => ({
      ...e,
      sent: !!e.notified_at,
      background_url: entryBgUrl(data.key, e.id, e.background_path),
      background_align: (e.background_align ?? "right-top") as EntryBgAlign,
      background_tint: (e.background_tint ?? null) as EntryBgTint | null,
    }));
  });

const entryInput = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(ENTRY_KINDS).default("entry"),
  time: z.string().min(1),
  end_time: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  tags: z.array(z.string().min(1).max(120)).max(50).default([]),
  color_scheme_id: z.string().uuid().nullable().default(null),
  notify: z.boolean().default(true),
  background_align: z.enum(ENTRY_BG_ALIGNMENTS).default("right-top"),
  background_height: z.number().int().min(8).max(2000).default(80),
  background_opacity: z.number().int().min(0).max(100).default(100),
  background_margin: z.number().int().min(0).max(500).default(0),
  background_tint: z.enum(ENTRY_BG_TINTS).nullable().default(null),
});

export const upsertEntry = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; entry: z.infer<typeof entryInput> }) =>
    z.object({ key: z.string().min(1), entry: entryInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const e = data.entry;
    const common = {
      kind: e.kind,
      time: e.time,
      end_time: e.end_time ?? null,
      title: e.title,
      description: e.description,
      tags: e.tags,
      color_scheme_id: e.color_scheme_id ?? null,
      notify: e.notify,
      background_align: e.background_align,
      background_height: e.background_height,
      background_opacity: e.background_opacity,
      background_margin: e.background_margin,
      background_tint: e.background_tint ?? null,
    };
    if (e.id) {
      const { error } = await supabase
        .from("entries")
        .update(common)
        .eq("id", e.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return { id: e.id };
    }
    const { data: row, error } = await supabase
      .from("entries")
      .insert({ tenant_id: tenantId, ...common })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });


export const uploadEntryBackground = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      key: string;
      id: string;
      filename: string;
      contentType: string;
      dataBase64: string;
    }) =>
      z
        .object({
          key: z.string().min(1),
          id: z.string().uuid(),
          filename: z.string().min(1).max(200),
          contentType: z.string().regex(/^image\//),
          dataBase64: z.string().min(1).max(14_000_000),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const { data: existing } = await supabase
      .from("entries")
      .select("background_path")
      .eq("id", data.id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!existing) throw new Error("Unknown entry");
    const binary = Uint8Array.from(atob(data.dataBase64), (c) => c.charCodeAt(0));
    const ext = (data.filename.split(".").pop() || "png").toLowerCase().slice(0, 5);
    const path = `${tenant.id}/entry-${data.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(ENTRY_BG_BUCKET)
      .upload(path, binary, { contentType: data.contentType, upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { error } = await supabase
      .from("entries")
      .update({ background_path: path, background_content_type: data.contentType })
      .eq("id", data.id)
      .eq("tenant_id", tenant.id);
    if (error) throw new Error(error.message);
    if (existing.background_path && existing.background_path !== path) {
      await supabase.storage.from(ENTRY_BG_BUCKET).remove([existing.background_path]);
    }
    return { url: entryBgUrl(data.key, data.id, path) };
  });

export const removeEntryBackground = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const { data: existing } = await supabase
      .from("entries")
      .select("background_path")
      .eq("id", data.id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (existing?.background_path) {
      await supabase.storage.from(ENTRY_BG_BUCKET).remove([existing.background_path]);
    }
    const { error } = await supabase
      .from("entries")
      .update({ background_path: null, background_content_type: null })
      .eq("id", data.id)
      .eq("tenant_id", tenant.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteEntry = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const { data: existing } = await supabase
      .from("entries")
      .select("background_path")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existing?.background_path) {
      await supabase.storage.from(ENTRY_BG_BUCKET).remove([existing.background_path]);
    }
    const { error } = await supabase
      .from("entries")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };

  });

// ---------- entries as JSON ----------

/** Rooms/color schemes with their reference ids, used by the JSON entries editor. */
async function entryRefMaps(tenantId: string) {
  const supabase = await getAdmin();
  const [rooms, schemes] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, ref_id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true }),
    supabase
      .from("color_schemes")
      .select("id, ref_id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true }),
  ]);
  const roomRows = rooms.data ?? [];
  const schemeRows = schemes.data ?? [];
  const roomIds = refIdsFor(roomRows);
  const schemeIds = refIdsFor(schemeRows);
  return {
    roomIds,
    schemeIds,
    roomRefByName: new Map(roomRows.map((r, i) => [r.name, roomIds[i]])),
    roomNameByRef: new Map(roomRows.map((r, i) => [roomIds[i], r.name])),
    schemeRefByUuid: new Map(schemeRows.map((s, i) => [s.id, schemeIds[i]])),
    schemeUuidByRef: new Map(schemeRows.map((s, i) => [schemeIds[i], s.id])),
  };
}

export const exportEntriesJson = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const maps = await entryRefMaps(tenant.id);
    const { data: rows, error } = await supabase
      .from("entries")
      .select("id, time, end_time, title, description, tags, color_scheme_id, notify")
      .eq("tenant_id", tenant.id)
      .order("time", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      roomIds: maps.roomIds,
      schemeIds: maps.schemeIds,
      entries: (rows ?? []).map((e) => ({
        id: e.id,
        time: e.time,
        end_time: e.end_time,
        title: e.title,
        description: e.description ?? "",
        rooms: (e.tags ?? []).map((n) => maps.roomRefByName.get(n) ?? slugify(n)).filter(Boolean),
        color_scheme: e.color_scheme_id ? (maps.schemeRefByUuid.get(e.color_scheme_id) ?? null) : null,
        notify: e.notify,
      })),
    };
  });

export const replaceEntriesJson = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; entries: EntryJsonItem[] }) =>
    z
      .object({ key: z.string().min(1), entries: entriesJsonSchema.shape.entries })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const maps = await entryRefMaps(tenant.id);

    const { data: existing, error: exErr } = await supabase
      .from("entries")
      .select("id, background_path")
      .eq("tenant_id", tenant.id);
    if (exErr) throw new Error(exErr.message);
    const existingIds = new Set((existing ?? []).map((e) => e.id));

    // validate references and time values up front, apply nothing on error
    const problems: string[] = [];
    const seen = new Set<string>();
    data.entries.forEach((e, i) => {
      const at = `entries[${i}]`;
      if (Number.isNaN(new Date(e.time).getTime())) problems.push(`${at}.time is not a valid date`);
      if (e.end_time && Number.isNaN(new Date(e.end_time).getTime()))
        problems.push(`${at}.end_time is not a valid date`);
      if (e.id) {
        if (!existingIds.has(e.id)) problems.push(`${at}.id "${e.id}" does not exist`);
        if (seen.has(e.id)) problems.push(`${at}.id "${e.id}" is used more than once`);
        seen.add(e.id);
      }
      for (const r of e.rooms ?? []) {
        if (!maps.roomNameByRef.has(r)) problems.push(`${at}: unknown room "${r}"`);
      }
      if (e.color_scheme && !maps.schemeUuidByRef.has(e.color_scheme))
        problems.push(`${at}: unknown color scheme "${e.color_scheme}"`);
    });
    if (problems.length) throw new Error(problems.slice(0, 20).join("\n"));

    const toRow = (e: (typeof data.entries)[number]) => ({
      tenant_id: tenant.id,
      time: new Date(e.time).toISOString(),
      end_time: e.end_time ? new Date(e.end_time).toISOString() : null,
      title: e.title,
      description: e.description ?? "",
      tags: (e.rooms ?? []).map((r) => maps.roomNameByRef.get(r)!).filter(Boolean),
      color_scheme_id: e.color_scheme ? (maps.schemeUuidByRef.get(e.color_scheme) ?? null) : null,
      notify: e.notify ?? true,
    });

    let updated = 0;
    let created = 0;
    for (const e of data.entries) {
      if (e.id) {
        const { error } = await supabase.from("entries").update(toRow(e)).eq("id", e.id).eq("tenant_id", tenant.id);
        if (error) throw new Error(error.message);
        updated++;
      } else {
        const { error } = await supabase.from("entries").insert(toRow(e));
        if (error) throw new Error(error.message);
        created++;
      }
    }

    const removed = (existing ?? []).filter((e) => !seen.has(e.id));
    if (removed.length) {
      const paths = removed.map((r) => r.background_path).filter(Boolean) as string[];
      if (paths.length) await supabase.storage.from(ENTRY_BG_BUCKET).remove(paths);
      const { error } = await supabase
        .from("entries")
        .delete()
        .in("id", removed.map((r) => r.id))
        .eq("tenant_id", tenant.id);
      if (error) throw new Error(error.message);
    }

    return { updated, created, deleted: removed.length };
  });

// ---------- rooms ----------

export const listRooms = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    const { data: rows, error } = await supabase
      .from("rooms")
      .select("id, ref_id, name, color_scheme_id, template")
      .eq("tenant_id", id)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const roomInput = z.object({
  id: z.string().uuid().optional(),
  ref_id: z.string().max(60).nullable().default(null),
  name: z.string().min(1).max(120),
  color_scheme_id: z.string().uuid().nullable().default(null),
  template: z.string().min(1).max(40).nullable().default(null),
});

export const upsertRoom = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; room: z.infer<typeof roomInput> }) =>
    z.object({ key: z.string().min(1), room: roomInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const r = data.room;
    const refId = r.ref_id?.trim() ? slugify(r.ref_id) : null;
    if (r.id) {
      const { error } = await supabase
        .from("rooms")
        .update({
          name: r.name,
          ref_id: refId,
          color_scheme_id: r.color_scheme_id ?? null,
          template: r.template ?? null,
        })
        .eq("id", r.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return { id: r.id };
    } else {
      const { data: row, error } = await supabase
        .from("rooms")
        .insert({
          tenant_id: tenantId,
          name: r.name,
          ref_id: refId,
          color_scheme_id: r.color_scheme_id ?? null,
          template: r.template ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: row.id };
    }
  });

export const deleteRoom = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const { error } = await supabase
      .from("rooms")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
});

// ---------- teams ----------

export const listTeams = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    const { data: rows, error } = await supabase
      .from("teams")
      .select("id, ref_id, name, members, project, room_id, sort_order")
      .eq("tenant_id", id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const teamInput = z.object({
  id: z.string().uuid().optional(),
  ref_id: z.string().max(60).nullable().default(null),
  name: z.string().min(1).max(120),
  members: z.string().max(2000).default(""),
  project: z.string().max(4000).default(""),
  room_id: z.string().uuid().nullable().default(null),
});

export const upsertTeam = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; team: z.infer<typeof teamInput> }) =>
    z.object({ key: z.string().min(1), team: teamInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const t = data.team;
    const common = {
      name: t.name,
      ref_id: t.ref_id?.trim() ? slugify(t.ref_id) : slugify(t.name),
      members: t.members,
      project: t.project,
      room_id: t.room_id ?? null,
    };
    if (t.id) {
      const { error } = await supabase
        .from("teams")
        .update(common)
        .eq("id", t.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return { id: t.id };
    }
    const { data: last } = await supabase
      .from("teams")
      .select("sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: row, error } = await supabase
      .from("teams")
      .insert({ tenant_id: tenantId, ...common, sort_order: (last?.sort_order ?? -1) + 1 })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteTeam = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const { error } = await supabase
      .from("teams")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderTeams = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; ids: string[] }) =>
    z.object({ key: z.string().min(1), ids: z.array(z.string().uuid()).max(500) }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    for (let i = 0; i < data.ids.length; i++) {
      const { error } = await supabase
        .from("teams")
        .update({ sort_order: i })
        .eq("id", data.ids[i])
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });



// ---------- webhooks ----------

export const listWebhooks = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    const { data: rows, error } = await supabase
      .from("webhooks")
      .select("id, ref_id, name, type, enabled, url")
      .eq("tenant_id", id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((w) => ({
      id: w.id,
      ref_id: w.ref_id,
      name: w.name,
      type: w.type,
      enabled: w.enabled,
      has_url: (w.url || "").trim().length > 0,
    }));
  });

const webhookInput = z.object({
  id: z.string().uuid().optional(),
  ref_id: z.string().max(60).nullable().default(null),
  name: z.string().min(1).max(120),
  type: z.enum(["discord"]),
  url: z.string().max(1000).optional(),
  enabled: z.boolean().default(true),
});

export const upsertWebhook = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; webhook: z.infer<typeof webhookInput> }) =>
    z.object({ key: z.string().min(1), webhook: webhookInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const w = data.webhook;
    const refId = w.ref_id?.trim() ? slugify(w.ref_id) : null;
    const url = (w.url ?? "").trim();
    if (w.id) {
      const update: TablesUpdate<"webhooks"> = {
        name: w.name,
        type: w.type,
        enabled: w.enabled,
        ref_id: refId,
      };
      if (w.url !== undefined) update.url = url;
      const { error } = await supabase
        .from("webhooks")
        .update(update)
        .eq("id", w.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return { id: w.id };
    }
    const { data: row, error } = await supabase
      .from("webhooks")
      .insert({
        tenant_id: tenantId,
        name: w.name,
        type: w.type,
        url,
        enabled: w.enabled,
        ref_id: refId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const { error } = await supabase
      .from("webhooks")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testWebhook = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const { data: row, error } = await supabase
      .from("webhooks")
      .select("url, type")
      .eq("id", data.id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Webhook not found");
    const result = await sendWebhook(row.url, row.type as WebhookType, {
      title: `Testnachricht von ${tenant.name}`,
      description: "This is a test message from the timeline app.",
      color: tenant.accent_color,
    });
    if (!result.ok) throw new Error(result.error);
    return { ok: true };
  });

export const sendWebhookMessage = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      key: string;
      message: {
        title: string;
        description: string;
        color?: string | null;
        image?: { filename: string; contentType: string; dataBase64: string } | null;
      };
    }) =>
      z
        .object({
          key: z.string().min(1),
          message: z.object({
            title: z.string().min(1).max(200),
            description: z.string().max(2000).default(""),
            color: z.string().max(7).nullable().default(null),
            image: z
              .object({
                filename: z.string().min(1).max(200),
                contentType: z.string().min(1).max(100),
                dataBase64: z.string().min(1),
              })
              .nullable()
              .default(null),
          }),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const { data: rows, error } = await supabase
      .from("webhooks")
      .select("id, name, url, type, enabled")
      .eq("tenant_id", tenantId)
      .eq("enabled", true);
    if (error) throw new Error(error.message);
    const webhooks = rows ?? [];
    if (webhooks.length === 0) throw new Error("No active webhooks configured");

    const { image, ...rest } = data.message;
    let attachment: { filename: string; contentType: string; bytes: Uint8Array } | null = null;
    if (image) {
      const bin = atob(image.dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      attachment = { filename: image.filename, contentType: image.contentType, bytes };
    }

    const results = await Promise.all(
      webhooks.map(async (w) => {
        const result = await sendWebhook(w.url, w.type as WebhookType, {
          ...rest,
          image: attachment,
        });
        return { id: w.id, name: w.name, ok: result.ok, error: result.ok ? undefined : result.error };
      }),
    );
    return { results };
  });


// ---------- snapshot for displays ----------

export type RoomSnapshot = {
  tenant: {
    name: string;
    past_grace_minutes: number;
    template: string;
    logo_url: string | null;
    logo_height: number;
    accent_color: string;
    ad_seconds: number;
    focus_mode: string;
    focus_count: number;
    focus_minutes: number;
    focus_dim_opacity: number;
    practice_minutes: number;
    practice_room_scope: string;
  };
  room: {
    id: string;
    name: string;
    color: string | null;
    template: string;
    is_overview?: boolean;
  };
  entries: {
    id: string;
    time: string;
    end_time: string | null;
    title: string;
    description: string;
    tags: string[];
    color: string | null;
    background_url: string | null;
    background_align: EntryBgAlign;
    background_height: number;
    background_opacity: number;
    background_margin: number;
    background_tint: EntryBgTint | null;
    team_id?: string | null;
  }[];

  ads: { id: string; name: string; url: string; content_type: string }[];
};

export const getRoomSnapshot = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string; roomId: string }) =>
    z.object({ key: z.string().min(1), roomId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }): Promise<RoomSnapshot> => {
    const supabase = await getAdmin();
    const tenant = await resolveTenant(data.key);
    const { data: room, error: roomErr } = await supabase
      .from("rooms")
      .select("id, name, color_scheme_id, template")
      .eq("id", data.roomId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (roomErr) throw new Error(roomErr.message);
    if (!room) throw new Error("Unknown room");
    const { data: entries, error: entriesErr } = await supabase
      .from("entries")
      .select(
        "id, kind, time, end_time, title, description, tags, color_scheme_id, background_path, background_align, background_height, background_opacity, background_margin, background_tint",
      )
      .eq("tenant_id", tenant.id);
    if (entriesErr) throw new Error(entriesErr.message);
    const { data: schemes } = await supabase
      .from("color_schemes")
      .select("id, color")
      .eq("tenant_id", tenant.id);
    const colorById = new Map((schemes ?? []).map((s) => [s.id, s.color]));
    const template = room.template || tenant.template;
    const { loadAdsForTemplate } = await import("@/lib/ads.server");
    const { ads, adSeconds } = await loadAdsForTemplate({
      tenantId: tenant.id,
      tenantKey: data.key,
      template,
      fallbackSeconds: tenant.ad_seconds,
    });
    const { data: teamRows } = await supabase
      .from("teams")
      .select("id, name, room_id, sort_order, created_at")
      .eq("tenant_id", tenant.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    const { data: roomRows } = await supabase
      .from("rooms")
      .select("id, color_scheme_id")
      .eq("tenant_id", tenant.id);
    const roomColorById = new Map(
      (roomRows ?? []).map((r) => [
        r.id,
        r.color_scheme_id ? (colorById.get(r.color_scheme_id) ?? null) : null,
      ]),
    );
    const teams: PracticeTeam[] = (teamRows ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      room_id: t.room_id,
      color: t.room_id ? (roomColorById.get(t.room_id) ?? null) : null,
    }));
    const withColor = (entries ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      time: e.time,
      end_time: e.end_time,
      title: e.title,
      description: e.description,
      tags: e.tags,
      color: e.color_scheme_id ? (colorById.get(e.color_scheme_id) ?? null) : null,
      background_url: entryBgUrl(data.key, e.id, e.background_path),
      background_align: (e.background_align ?? "right-top") as EntryBgAlign,
      background_height: e.background_height ?? 80,
      background_opacity: e.background_opacity ?? 100,
      background_margin: e.background_margin ?? 0,
      background_tint: (e.background_tint ?? null) as EntryBgTint | null,
    }));

    return {
      tenant: {
        name: tenant.name,
        past_grace_minutes: tenant.past_grace_minutes,
        template: tenant.template,
        logo_url: tenant.logo_url,
        logo_height: tenant.logo_height,
        accent_color: tenant.accent_color,
        ad_seconds: adSeconds,
        focus_mode: tenant.focus_mode ?? "count",
        focus_count: tenant.focus_count ?? 3,
        focus_minutes: tenant.focus_minutes ?? 30,
        focus_dim_opacity: tenant.focus_dim_opacity ?? 35,
        practice_minutes: tenant.practice_minutes ?? 10,
        practice_room_scope: tenant.practice_room_scope ?? "all",
      },
      room: {
        id: room.id,
        name: room.name,
        color: room.color_scheme_id ? (colorById.get(room.color_scheme_id) ?? null) : null,
        template,
      },
      entries: filterVisible(
        expandPracticeEntries(withColor, {
          teams,
          practiceMinutes: tenant.practice_minutes ?? 10,
          scope: tenant.practice_room_scope ?? "all",
          roomId: room.id,
          isOverview: false,
        }),
        room.name,
        tenant.past_grace_minutes,
      ),
      ads,
    };

  });

// ---------- color schemes ----------

export const listColorSchemes = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    const { data: rows, error } = await supabase
      .from("color_schemes")
      .select("id, ref_id, name, color")
      .eq("tenant_id", id)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const schemeInput = z.object({
  id: z.string().uuid().optional(),
  ref_id: z.string().max(60).nullable().default(null),
  name: z.string().min(1).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const upsertColorScheme = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; scheme: z.infer<typeof schemeInput> }) =>
    z.object({ key: z.string().min(1), scheme: schemeInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const s = { ...data.scheme, color: data.scheme.color.toUpperCase() };
    const refId = s.ref_id?.trim() ? slugify(s.ref_id) : null;
    if (s.id) {
      const { error } = await supabase
        .from("color_schemes")
        .update({ name: s.name, color: s.color, ref_id: refId })
        .eq("id", s.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return { id: s.id };
    }
    const { data: row, error } = await supabase
      .from("color_schemes")
      .insert({ tenant_id: tenantId, name: s.name, color: s.color, ref_id: refId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteColorScheme = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const { error } = await supabase
      .from("color_schemes")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- tenant logo ----------

export const uploadTenantLogo = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; filename: string; contentType: string; dataBase64: string }) =>
    z
      .object({
        key: z.string().min(1),
        filename: z.string().min(1).max(200),
        contentType: z.string().regex(/^image\//),
        dataBase64: z.string().min(1).max(4_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const binary = Uint8Array.from(atob(data.dataBase64), (c) => c.charCodeAt(0));
    const ext = (data.filename.split(".").pop() || "png").toLowerCase().slice(0, 5);
    const path = `${tenant.id}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("tenant-logos")
      .upload(path, binary, { contentType: data.contentType, upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { error } = await supabase.from("tenants").update({ logo_url: path }).eq("id", tenant.id);
    if (error) throw new Error(error.message);
    if (tenant.logo_url && tenant.logo_url !== path) {
      await supabase.storage.from("tenant-logos").remove([tenant.logo_url]);
    }
    return { ok: true };
  });

export const removeTenantLogo = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    if (tenant.logo_url) {
      await supabase.storage.from("tenant-logos").remove([tenant.logo_url]);
    }
    const { error } = await supabase.from("tenants").update({ logo_url: null }).eq("id", tenant.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- ad sets ----------

export const listAdSets = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    const { data: rows, error } = await supabase
      .from("ad_sets")
      .select("id, ref_id, name, ad_seconds, sort_order")
      .eq("tenant_id", id)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const adSetInput = z.object({
  id: z.string().uuid().optional(),
  ref_id: z.string().max(60).nullable().default(null),
  name: z.string().min(1).max(120),
  ad_seconds: z.number().int().min(1).max(600).default(10),
});

export const upsertAdSet = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; set: z.infer<typeof adSetInput> }) =>
    z.object({ key: z.string().min(1), set: adSetInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const s = data.set;
    const refId = s.ref_id?.trim() ? slugify(s.ref_id) : null;
    if (s.id) {
      const { error } = await supabase
        .from("ad_sets")
        .update({ name: s.name, ad_seconds: s.ad_seconds, ref_id: refId })
        .eq("id", s.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return { id: s.id };
    }
    const { data: last } = await supabase
      .from("ad_sets")
      .select("sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const { data: row, error } = await supabase
      .from("ad_sets")
      .insert({
        tenant_id: tenantId,
        name: s.name,
        ad_seconds: s.ad_seconds,
        ref_id: refId,
        sort_order: (last?.[0]?.sort_order ?? -1) + 1,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteAdSet = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const { data: ads } = await supabase
      .from("ads")
      .select("path")
      .eq("tenant_id", tenant.id)
      .eq("ad_set_id", data.id);
    if (ads?.length) await supabase.storage.from("tenant-ads").remove(ads.map((a) => a.path));
    const { error } = await supabase
      .from("ad_sets")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenant.id);
    if (error) throw new Error(error.message);
    // Displays pointing at the removed set fall back to the schedule template.
    if (tenant.template === `ads:${data.id}`) {
      await supabase.from("tenants").update({ template: "zeitplan" }).eq("id", tenant.id);
    }
    await supabase
      .from("rooms")
      .update({ template: null })
      .eq("tenant_id", tenant.id)
      .eq("template", `ads:${data.id}`);
    return { ok: true };
  });

// ---------- ads ----------

export const listAds = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string; setId: string }) =>
    z.object({ key: z.string().min(1), setId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await requireTenantAdmin(data.key);
    const { data: rows, error } = await supabase
      .from("ads")
      .select("id, name, content_type, sort_order, path")
      .eq("tenant_id", id)
      .eq("ad_set_id", data.setId)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    // Signed storage URLs so previews load directly from storage instead of
    // streaming megabytes back through this worker.
    const signed = new Map<string, string>();
    if (list.length) {
      const { data: urls } = await supabase.storage.from("tenant-ads").createSignedUrls(
        list.map((a) => a.path),
        60 * 60 * 12,
      );
      (urls ?? []).forEach((u, i) => {
        if (u.signedUrl && list[i]) signed.set(list[i].id, u.signedUrl);
      });
    }
    return list.map((a) => ({
      id: a.id,
      name: a.name,
      content_type: a.content_type,
      sort_order: a.sort_order,
      url: signed.get(a.id) ?? null,
    }));
  });

export const reorderAds = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; ids: string[] }) =>
    z.object({ key: z.string().min(1), ids: z.array(z.string().uuid()).min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    for (let i = 0; i < data.ids.length; i++) {
      await supabase
        .from("ads")
        .update({ sort_order: i })
        .eq("id", data.ids[i])
        .eq("tenant_id", tenantId);
    }
    return { ok: true };
  });

export const uploadAd = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      key: string;
      setId: string;
      filename: string;
      contentType: string;
      dataBase64: string;
    }) =>
      z
        .object({
          key: z.string().min(1),
          setId: z.string().uuid(),
          filename: z.string().min(1).max(200),
          contentType: z.string().regex(/^image\//),
          dataBase64: z.string().min(1).max(14_000_000),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const binary = Uint8Array.from(atob(data.dataBase64), (c) => c.charCodeAt(0));
    const ext = (data.filename.split(".").pop() || "png").toLowerCase().slice(0, 5);
    const path = `${tenant.id}/ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("tenant-ads")
      .upload(path, binary, { contentType: data.contentType, upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data: last } = await supabase
      .from("ads")
      .select("sort_order")
      .eq("tenant_id", tenant.id)
      .eq("ad_set_id", data.setId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextOrder = (last?.[0]?.sort_order ?? -1) + 1;
    const { data: row, error } = await supabase
      .from("ads")
      .insert({
        tenant_id: tenant.id,
        ad_set_id: data.setId,
        name: data.filename.slice(0, 120),
        path,
        content_type: data.contentType,
        sort_order: nextOrder,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });


export const renameAd = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string; name: string }) =>
    z
      .object({ key: z.string().min(1), id: z.string().uuid(), name: z.string().min(1).max(120) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const { error } = await supabase
      .from("ads")
      .update({ name: data.name })
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const moveAd = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string; direction: "up" | "down" }) =>
    z
      .object({
        key: z.string().min(1),
        id: z.string().uuid(),
        direction: z.enum(["up", "down"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const { data: rows } = await supabase
      .from("ads")
      .select("id, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true });
    const list = rows ?? [];
    const idx = list.findIndex((a) => a.id === data.id);
    const swapIdx = data.direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return { ok: true };
    await supabase.from("ads").update({ sort_order: swapIdx }).eq("id", list[idx].id);
    await supabase.from("ads").update({ sort_order: idx }).eq("id", list[swapIdx].id);
    return { ok: true };
  });

export const deleteAd = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await requireTenantAdmin(data.key);
    const { data: ad } = await supabase
      .from("ads")
      .select("path")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (ad?.path) await supabase.storage.from("tenant-ads").remove([ad.path]);
    const { error } = await supabase
      .from("ads")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- import / export ----------

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function extOf(name: string, fallback = "png"): string {
  const ext = (name.split(".").pop() || fallback).toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext.slice(0, 5) || fallback;
}

export type ExportedFile = { path: string; content_type: string; dataBase64: string };

export const exportTenantData = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }): Promise<{ data: TenantData; files: ExportedFile[] }> => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const [schemes, rooms, entries, adSets, ads, webhooks] = await Promise.all([
      supabase
        .from("color_schemes")
        .select("id, ref_id, name, color")
        .eq("tenant_id", tenant.id)
        .order("name", { ascending: true }),
      supabase
        .from("rooms")
        .select("id, ref_id, name, color_scheme_id, template")
        .eq("tenant_id", tenant.id)
        .order("name", { ascending: true }),
      supabase
        .from("entries")
        .select(
          "time, end_time, title, description, tags, color_scheme_id, notify, background_path, background_content_type, background_align, background_height, background_opacity, background_margin, background_tint",
        )
        .eq("tenant_id", tenant.id)
        .order("time", { ascending: true }),

      supabase
        .from("ad_sets")
        .select("id, ref_id, name, ad_seconds, sort_order")
        .eq("tenant_id", tenant.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("ads")
        .select("name, path, content_type, sort_order, ad_set_id")
        .eq("tenant_id", tenant.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("webhooks")
        .select("id, ref_id, name, type, enabled")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: true }),
    ]);

    const schemeRows = schemes.data ?? [];
    const roomRows = rooms.data ?? [];
    const schemeIds = refIdsFor(schemeRows);
    const roomIds = refIdsFor(roomRows);
    const schemeIdByUuid = new Map(schemeRows.map((s, i) => [s.id, schemeIds[i]]));
    const roomIdByName = new Map(roomRows.map((r, i) => [r.name, roomIds[i]]));
    const webhookRows = webhooks.data ?? [];
    const webhookIds = refIdsFor(webhookRows);
    const webhookIdByUuid = new Map(webhookRows.map((w, i) => [w.id, webhookIds[i]]));
    const setRows = adSets.data ?? [];
    const setIds = refIdsFor(setRows);
    const setIdByUuid = new Map(setRows.map((s, i) => [s.id, setIds[i]]));
    /** Turns "ads:<uuid>" into "ads:<ref id>" so exports stay portable. */
    const templateRefOf = (template: string | null): string | null => {
      if (!template) return null;
      if (!template.startsWith("ads:")) return template;
      const ref = setIdByUuid.get(template.slice(4));
      return ref ? `ads:${ref}` : "ads";
    };

    const files: ExportedFile[] = [];

    let logo: { file: string; content_type: string } | null = null;
    if (tenant.logo_url) {
      const { data: file } = await supabase.storage.from("tenant-logos").download(tenant.logo_url);
      if (file) {
        const path = `images/logo.${extOf(tenant.logo_url)}`;
        const content_type = file.type || "image/png";
        files.push({
          path,
          content_type,
          dataBase64: toBase64(new Uint8Array(await file.arrayBuffer())),
        });
        logo = { file: path, content_type };
      }
    }

    const adItems: { name: string; file: string; content_type: string; set: string | null }[] = [];
    let i = 0;
    for (const a of ads.data ?? []) {
      i++;
      const { data: file } = await supabase.storage.from("tenant-ads").download(a.path);
      if (!file) continue;
      const path = `images/ads/${String(i).padStart(2, "0")}-${slugify(a.name) || "ad"}.${extOf(a.path)}`;
      files.push({
        path,
        content_type: a.content_type,
        dataBase64: toBase64(new Uint8Array(await file.arrayBuffer())),
      });
      adItems.push({
        name: a.name,
        file: path,
        content_type: a.content_type,
        set: setIdByUuid.get(a.ad_set_id) ?? null,
      });
    }

    const entryItems: TenantData["entries"] = [];
    let entryIdx = 0;
    for (const e of entries.data ?? []) {
      entryIdx++;
      let background: { file: string; content_type: string } | null = null;
      if (e.background_path) {
        const { data: file } = await supabase.storage
          .from(ENTRY_BG_BUCKET)
          .download(e.background_path);
        if (file) {
          const path = `images/entries/${String(entryIdx).padStart(2, "0")}-${slugify(e.title) || "entry"}.${extOf(e.background_path)}`;
          const content_type = e.background_content_type || file.type || "image/png";
          files.push({
            path,
            content_type,
            dataBase64: toBase64(new Uint8Array(await file.arrayBuffer())),
          });
          background = { file: path, content_type };
        }
      }
      entryItems.push({
        time: e.time,
        end_time: e.end_time,
        title: e.title,
        description: e.description,
        rooms: e.tags.map((name) => roomIdByName.get(name) ?? slugify(name)).filter(Boolean),
        color_scheme: e.color_scheme_id ? (schemeIdByUuid.get(e.color_scheme_id) ?? null) : null,
        notify: e.notify,
        background,
        background_align: (e.background_align ?? "right-top") as EntryBgAlign,
        background_height: e.background_height ?? 80,
        background_opacity: e.background_opacity ?? 100,
        background_margin: e.background_margin ?? 0,
        background_tint: (e.background_tint ?? null) as EntryBgTint | null,
      });
    }

    const payload: TenantData = {
      version: IO_VERSION,
      exported_at: new Date().toISOString(),
      tenant: {
        name: tenant.name,
        past_grace_minutes: tenant.past_grace_minutes,
        template: templateRefOf(tenant.template) ?? "zeitplan",
        logo_height: tenant.logo_height,
        accent_color: tenant.accent_color,
        ad_seconds: tenant.ad_seconds,
        focus_mode: (tenant.focus_mode ?? "count") as "count" | "minutes",
        focus_count: tenant.focus_count ?? 3,
        focus_minutes: tenant.focus_minutes ?? 30,
        focus_dim_opacity: tenant.focus_dim_opacity ?? 35,
      },
      color_schemes: schemeRows.map((s, idx) => ({
        id: schemeIds[idx],
        name: s.name,
        color: s.color,
      })),
      rooms: roomRows.map((r, idx) => ({
        id: roomIds[idx],
        name: r.name,
        template: templateRefOf(r.template),
        color_scheme: r.color_scheme_id ? (schemeIdByUuid.get(r.color_scheme_id) ?? null) : null,
      })),
      entries: entryItems,

      ad_sets: setRows.map((s, idx) => ({
        id: setIds[idx],
        name: s.name,
        ad_seconds: s.ad_seconds,
      })),
      ads: adItems,

      webhooks: webhookRows.map((w, idx) => ({
        id: webhookIds[idx],
        name: w.name,
        type: w.type as "discord",
        enabled: w.enabled,
        // URLs are secrets and never exported; the key is kept so it can be filled in for import
        url: null,
      })),
      logo,
    };

    return { data: payload, files };
  });

const importFile = z.object({
  path: z.string().min(1).max(300),
  content_type: z.string().min(1).max(100).default("image/png"),
  dataBase64: z.string().min(1),
});

export const importTenantData = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      key: string;
      mode: "replace" | "append";
      sections: string[];
      data: unknown;
      files?: { path: string; content_type?: string; dataBase64: string }[];
    }) =>
      z
        .object({
          key: z.string().min(1),
          mode: z.enum(["replace", "append"]),
          sections: z.array(z.enum(SECTIONS)).min(1),
          data: tenantDataSchema,
          files: z.array(importFile).default([]),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await requireTenantAdmin(data.key);
    const p = data.data;
    const replace = data.mode === "replace";
    const wants = (s: Section) => data.sections.includes(s);
    const norm = (path: string) =>
      path
        .replace(/\\/g, "/")
        .replace(/^\.?\//, "")
        .toLowerCase();
    const base = (path: string) => norm(path).split("/").pop() ?? "";
    const fileByPath = new Map<string, (typeof data.files)[number]>();
    for (const f of data.files) {
      fileByPath.set(norm(f.path), f);
      const b = base(f.path);
      if (!fileByPath.has(b)) fileByPath.set(b, f);
    }
    /** Tolerates archives that were re-zipped with an extra top level folder. */
    const findFile = (ref: string) => {
      const n = norm(ref);
      const direct = fileByPath.get(n) ?? fileByPath.get(base(ref));
      if (direct) return direct;
      for (const [k, v] of fileByPath) if (k.endsWith(n) || n.endsWith(k)) return v;
      return undefined;
    };
    const counts: Record<string, number> = {};
    const warnings: string[] = [];

    // ---- color schemes ----
    const schemeUuidByRef = new Map<string, string>();
    if (wants("color_schemes") && p.color_schemes) {
      if (replace) {
        await supabase.from("color_schemes").delete().eq("tenant_id", tenant.id);
      }
      const { data: existing } = await supabase
        .from("color_schemes")
        .select("id, ref_id, name")
        .eq("tenant_id", tenant.id);
      const taken = new Set<string>();
      for (const row of existing ?? []) {
        const ref = uniqueRefId(effectiveRefId(row), taken, "scheme");
        schemeUuidByRef.set(ref, row.id);
      }
      for (const s of p.color_schemes) {
        const ref = uniqueRefId(slugify(s.id) || slugify(s.name), taken, "scheme");
        const { data: row } = await supabase
          .from("color_schemes")
          .insert({
            tenant_id: tenant.id,
            name: s.name,
            color: s.color.toUpperCase(),
            ref_id: ref,
          })
          .select("id")
          .single();
        if (row) {
          schemeUuidByRef.set(ref, row.id);
          schemeUuidByRef.set(s.id, row.id);
          counts.color_schemes = (counts.color_schemes ?? 0) + 1;
        }
      }
    } else {
      const { data: existing } = await supabase
        .from("color_schemes")
        .select("id, ref_id, name")
        .eq("tenant_id", tenant.id);
      const taken = new Set<string>();
      for (const row of existing ?? []) {
        schemeUuidByRef.set(uniqueRefId(effectiveRefId(row), taken, "scheme"), row.id);
      }
    }
    const schemeUuid = (ref: string | null | undefined) =>
      ref ? (schemeUuidByRef.get(ref) ?? schemeUuidByRef.get(slugify(ref)) ?? null) : null;

    // ---- ad sets ----
    const setUuidByRef = new Map<string, string>();
    let firstSetUuid: string | null = null;
    const loadExistingSets = async () => {
      const { data: existing } = await supabase
        .from("ad_sets")
        .select("id, ref_id, name, sort_order")
        .eq("tenant_id", tenant.id)
        .order("sort_order", { ascending: true });
      const taken = new Set<string>();
      for (const row of existing ?? []) {
        setUuidByRef.set(uniqueRefId(effectiveRefId(row), taken, "ads"), row.id);
        if (!firstSetUuid) firstSetUuid = row.id;
      }
      return taken;
    };
    if (wants("ad_sets") && p.ad_sets) {
      if (replace) {
        const { data: oldAds } = await supabase
          .from("ads")
          .select("path")
          .eq("tenant_id", tenant.id);
        if (oldAds?.length) {
          await supabase.storage.from("tenant-ads").remove(oldAds.map((a) => a.path));
        }
        await supabase.from("ad_sets").delete().eq("tenant_id", tenant.id);
      }
      const taken = await loadExistingSets();
      let order = 0;
      for (const s of p.ad_sets) {
        const ref = uniqueRefId(slugify(s.id) || slugify(s.name), taken, "ads");
        const { data: row, error } = await supabase
          .from("ad_sets")
          .insert({
            tenant_id: tenant.id,
            name: s.name,
            ad_seconds: s.ad_seconds,
            ref_id: ref,
            sort_order: order++,
          })
          .select("id")
          .single();
        if (row) {
          setUuidByRef.set(ref, row.id);
          setUuidByRef.set(s.id, row.id);
          if (!firstSetUuid) firstSetUuid = row.id;
          counts.ad_sets = (counts.ad_sets ?? 0) + 1;
        } else if (error) {
          warnings.push(`Ad set "${s.name}" not imported: ${error.message}`);
        }
      }
    } else {
      await loadExistingSets();
    }
    const setUuid = (ref: string | null | undefined) =>
      ref ? (setUuidByRef.get(ref) ?? setUuidByRef.get(slugify(ref)) ?? null) : null;
    /** Maps "ads:<ref id>" back to "ads:<uuid>". */
    const templateValue = (template: string | null | undefined, label: string): string | null => {
      if (!template) return null;
      if (!template.startsWith("ads:")) return template;
      const uuid = setUuid(template.slice(4));
      if (uuid) return `ads:${uuid}`;
      warnings.push(`${label}: unknown ad set "${template.slice(4)}", using the first ad set`);
      return "ads";
    };


    // ---- rooms ----
    const roomNameByRef = new Map<string, string>();
    if (wants("rooms") && p.rooms) {
      if (replace) {
        await supabase.from("rooms").delete().eq("tenant_id", tenant.id);
      }
      const { data: existing } = await supabase
        .from("rooms")
        .select("id, ref_id, name")
        .eq("tenant_id", tenant.id);
      const taken = new Set<string>();
      for (const row of existing ?? []) {
        roomNameByRef.set(uniqueRefId(effectiveRefId(row), taken, "room"), row.name);
      }
      for (const r of p.rooms) {
        const ref = uniqueRefId(slugify(r.id) || slugify(r.name), taken, "room");
        if (r.color_scheme && !schemeUuid(r.color_scheme)) {
          warnings.push(`Room "${r.name}": unknown color scheme "${r.color_scheme}"`);
        }
        const { error } = await supabase.from("rooms").insert({
          tenant_id: tenant.id,
          name: r.name,
          ref_id: ref,
          template: templateValue(r.template, `Room "${r.name}"`),

          color_scheme_id: schemeUuid(r.color_scheme),
        });
        if (!error) {
          roomNameByRef.set(ref, r.name);
          roomNameByRef.set(r.id, r.name);
          counts.rooms = (counts.rooms ?? 0) + 1;
        } else {
          warnings.push(`Room "${r.name}" not imported: ${error.message}`);
        }
      }
    } else {
      const { data: existing } = await supabase
        .from("rooms")
        .select("id, ref_id, name")
        .eq("tenant_id", tenant.id);
      const taken = new Set<string>();
      for (const row of existing ?? []) {
        roomNameByRef.set(uniqueRefId(effectiveRefId(row), taken, "room"), row.name);
      }
    }

    // ---- entries ----
    if (wants("entries") && p.entries) {
      if (replace) {
        const { data: old } = await supabase
          .from("entries")
          .select("background_path")
          .eq("tenant_id", tenant.id);
        const oldPaths = (old ?? []).map((o) => o.background_path).filter(Boolean) as string[];
        if (oldPaths.length) {
          await supabase.storage.from(ENTRY_BG_BUCKET).remove(oldPaths);
        }
        await supabase.from("entries").delete().eq("tenant_id", tenant.id);
      }
      if (p.entries.length) {
        const rows: {
          tenant_id: string;
          time: string;
          end_time: string | null;
          title: string;
          description: string;
          tags: string[];
          color_scheme_id: string | null;
          notify: boolean;
          background_path: string | null;
          background_content_type: string | null;
          background_align: string;
          background_height: number;
          background_opacity: number;
          background_margin: number;
          background_tint: string | null;
        }[] = [];
        for (const e of p.entries) {
          for (const ref of e.rooms) {
            if (!roomNameByRef.get(ref)) {
              warnings.push(`Entry "${e.title}": unknown room "${ref}"`);
            }
          }
          if (e.color_scheme && !schemeUuid(e.color_scheme)) {
            warnings.push(`Entry "${e.title}": unknown color scheme "${e.color_scheme}"`);
          }
          let bgPath: string | null = null;
          let bgType: string | null = null;
          if (e.background) {
            const file = fileByPath.get(e.background.file);
            if (!file) {
              warnings.push(`Entry "${e.title}": background file "${e.background.file}" missing`);
            } else {
              const bytes = fromBase64(file.dataBase64);
              const contentType = e.background.content_type || file.content_type || "image/png";
              const path = `${tenant.id}/entry-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extOf(e.background.file)}`;
              const { error: upErr } = await supabase.storage
                .from(ENTRY_BG_BUCKET)
                .upload(path, bytes, { contentType, upsert: true });
              if (upErr) {
                warnings.push(`Entry "${e.title}": background upload failed — ${upErr.message}`);
              } else {
                bgPath = path;
                bgType = contentType;
              }
            }
          }
          rows.push({
            tenant_id: tenant.id,
            time: e.time,
            end_time: e.end_time ?? null,
            title: e.title,
            description: e.description,
            tags: e.rooms.map((ref) => roomNameByRef.get(ref) ?? ref),
            color_scheme_id: schemeUuid(e.color_scheme),
            notify: e.notify,
            background_path: bgPath,
            background_content_type: bgType,
            background_align: e.background_align,
            background_height: e.background_height,
            background_opacity: e.background_opacity,
            background_margin: e.background_margin,
            background_tint: e.background_tint ?? null,
          });
        }
        const { error } = await supabase.from("entries").insert(rows);
        if (error) throw new Error(error.message);
        counts.entries = rows.length;
      }
    }


    // ---- webhooks ----
    if (wants("webhooks") && p.webhooks) {
      if (replace) {
        await supabase.from("webhooks").delete().eq("tenant_id", tenant.id);
      }
      const taken = new Set<string>();
      const { data: existing } = await supabase
        .from("webhooks")
        .select("ref_id")
        .eq("tenant_id", tenant.id);
      for (const row of existing ?? []) {
        if (row.ref_id) taken.add(row.ref_id.toLowerCase());
      }
      for (const w of p.webhooks) {
        const ref = uniqueRefId(slugify(w.id) || slugify(w.name), taken, "webhook");
        const url = typeof w.url === "string" && w.url.trim() ? w.url.trim() : null;
        const { error } = await supabase.from("webhooks").insert({
          tenant_id: tenant.id,
          name: w.name,
          type: w.type === "discord" ? "discord" : "discord",
          // Without a URL the webhook cannot send, so it is created disabled
          enabled: url ? w.enabled : false,
          ref_id: ref,
          url: url ?? "",
        });
        if (!error) {
          counts.webhooks = (counts.webhooks ?? 0) + 1;
          if (!url) {
            warnings.push(`Webhook "${w.name}" imported without URL and left inactive.`);
          }
        } else {
          warnings.push(`Webhook "${w.name}" not imported: ${error.message}`);
        }
      }
    }


    // ---- ads ----
    if (wants("ads") && p.ads) {
      if (replace) {
        const { data: oldAds } = await supabase
          .from("ads")
          .select("path")
          .eq("tenant_id", tenant.id);
        if (oldAds?.length) {
          await supabase.storage.from("tenant-ads").remove(oldAds.map((a) => a.path));
        }
        await supabase.from("ads").delete().eq("tenant_id", tenant.id);
      }
      // Ads always belong to a set; create a default one when none exists yet.
      if (!firstSetUuid) {
        const { data: row } = await supabase
          .from("ad_sets")
          .insert({ tenant_id: tenant.id, name: "Ads", ref_id: "ads", ad_seconds: 10 })
          .select("id")
          .single();
        if (row) {
          firstSetUuid = row.id;
          setUuidByRef.set("ads", row.id);
        }
      }
      const orderBySet = new Map<string, number>();
      for (const a of p.ads) {
        const file = findFile(a.file);
        if (!file) {
          warnings.push(`Ad "${a.name}": image file "${a.file}" is missing in the archive`);
          continue;
        }
        const setId = setUuid(a.set) ?? firstSetUuid;
        if (!setId) {
          warnings.push(`Ad "${a.name}": no ad set available`);
          continue;
        }
        if (a.set && !setUuid(a.set)) {
          warnings.push(`Ad "${a.name}": unknown ad set "${a.set}", added to the first set`);
        }
        let order = orderBySet.get(setId);
        if (order === undefined) {
          const { data: last } = await supabase
            .from("ads")
            .select("sort_order")
            .eq("tenant_id", tenant.id)
            .eq("ad_set_id", setId)
            .order("sort_order", { ascending: false })
            .limit(1);
          order = (last?.[0]?.sort_order ?? -1) + 1;
        }
        const bytes = fromBase64(file.dataBase64);
        const path = `${tenant.id}/ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extOf(a.file)}`;
        const { error: upErr } = await supabase.storage
          .from("tenant-ads")
          .upload(path, bytes, { contentType: a.content_type || file.content_type, upsert: true });
        if (upErr) {
          warnings.push(`Ad "${a.name}": upload failed — ${upErr.message}`);
          continue;
        }
        const { error: insErr } = await supabase.from("ads").insert({
          tenant_id: tenant.id,
          ad_set_id: setId,
          name: a.name,
          path,
          content_type: a.content_type || file.content_type,
          sort_order: order,
        });
        if (insErr) {
          warnings.push(`Ad "${a.name}" not imported: ${insErr.message}`);
          continue;
        }
        orderBySet.set(setId, order + 1);
        counts.ads = (counts.ads ?? 0) + 1;
      }
    }


    // ---- logo ----
    let logoPath: string | null | undefined;
    if (wants("logo") && p.logo) {
      const file = findFile(p.logo.file);
      if (!file) {
        warnings.push(`Logo: image file "${p.logo.file}" is missing in the archive`);
      } else {
        const bytes = fromBase64(file.dataBase64);
        const newPath = `${tenant.id}/logo-${Date.now()}.${extOf(p.logo.file)}`;
        const { error } = await supabase.storage.from("tenant-logos").upload(newPath, bytes, {
          contentType: p.logo.content_type || file.content_type,
          upsert: true,
        });
        if (!error) {
          if (tenant.logo_url)
            await supabase.storage.from("tenant-logos").remove([tenant.logo_url]);
          logoPath = newPath;
          counts.logo = 1;
        } else {
          warnings.push(`Logo: upload failed — ${error.message}`);
        }
      }
    }

    // ---- tenant settings ----
    if ((wants("tenant") && p.tenant) || logoPath !== undefined) {
      const update: TablesUpdate<"tenants"> = {};
      if (wants("tenant") && p.tenant) {
        update.name = p.tenant.name;
        update.past_grace_minutes = p.tenant.past_grace_minutes;
        update.template = templateValue(p.tenant.template, "Display template") ?? "zeitplan";
        update.logo_height = p.tenant.logo_height;
        update.accent_color = p.tenant.accent_color.toUpperCase();
        update.ad_seconds = p.tenant.ad_seconds;
        if (p.tenant.focus_mode !== undefined) update.focus_mode = p.tenant.focus_mode;
        if (p.tenant.focus_count !== undefined) update.focus_count = p.tenant.focus_count;
        if (p.tenant.focus_minutes !== undefined) update.focus_minutes = p.tenant.focus_minutes;
        if (p.tenant.focus_dim_opacity !== undefined)
          update.focus_dim_opacity = p.tenant.focus_dim_opacity;
        counts.tenant = 1;
      }
      if (logoPath !== undefined) update.logo_url = logoPath;
      const { error } = await supabase.from("tenants").update(update).eq("id", tenant.id);
      if (error) throw new Error(error.message);
    }

    return { ok: true, counts, warnings };
  });
