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
};

const TENANT_COLS =
  "id, name, past_grace_minutes, template, logo_url, logo_height, accent_color, ad_seconds";

async function resolveTenant(key: string): Promise<TenantRow> {
  const supabase = await getAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .select(TENANT_COLS)
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unknown tenant key");
  return data;
}

function filterVisible<T extends { time: string; tags: string[] }>(
  entries: T[],
  roomName: string,
  graceMinutes: number,
): T[] {
  const cutoff = Date.now() - graceMinutes * 60 * 1000;
  return entries
    .filter((e) => new Date(e.time).getTime() >= cutoff)
    .filter((e) => e.tags.length === 0 || e.tags.includes(roomName))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

// ---------- tenant ----------

export const createTenant = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = await getAdmin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = generateKey();
    const { data, error } = await supabase.from("tenants").insert({ key }).select("key").single();
    if (!error && data) return { key: data.key };
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
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await resolveTenant(data.key);
    const { error } = await supabase
      .from("tenants")
      .update({
        name: data.name,
        past_grace_minutes: data.past_grace_minutes,
        template: data.template,
        logo_height: data.logo_height,
        accent_color: data.accent_color.toUpperCase(),
        ad_seconds: data.ad_seconds,
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
    const { id } = await resolveTenant(data.key);
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
    const { id } = await resolveTenant(data.key);
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
    const tenant = await resolveTenant(data.key);
    const { data: ads } = await supabase.from("ads").select("path").eq("tenant_id", tenant.id);
    if (ads?.length) await supabase.storage.from("tenant-ads").remove(ads.map((a) => a.path));
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
    const { id } = await resolveTenant(data.key);
    const { data: rows, error } = await supabase
      .from("entries")
      .select("id, time, title, description, tags, color_scheme_id, notify")
      .eq("tenant_id", id)
      .order("time", { ascending: true });
    if (error) throw new Error(error.message);
    const entries = rows ?? [];

    // Mark which entries have already been delivered to a webhook for their current time
    const { data: deliveries } = entries.length
      ? await supabase
          .from("webhook_deliveries")
          .select("entry_id, entry_time")
          .in(
            "entry_id",
            entries.map((e) => e.id),
          )
      : { data: [] as { entry_id: string; entry_time: string }[] };

    const sent = new Set(
      (deliveries ?? []).map((d) => `${d.entry_id}|${new Date(d.entry_time).getTime()}`),
    );

    return entries.map((e) => ({
      ...e,
      sent: sent.has(`${e.id}|${new Date(e.time).getTime()}`),
    }));
  });

const entryInput = z.object({
  id: z.string().uuid().optional(),
  time: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  tags: z.array(z.string().min(1).max(120)).max(50).default([]),
  color_scheme_id: z.string().uuid().nullable().default(null),
  notify: z.boolean().default(true),
});

export const upsertEntry = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; entry: z.infer<typeof entryInput> }) =>
    z.object({ key: z.string().min(1), entry: entryInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await resolveTenant(data.key);
    const e = data.entry;
    if (e.id) {
      const { error } = await supabase
      .from("entries")
      .update({
        time: e.time,
        title: e.title,
        description: e.description,
        tags: e.tags,
        color_scheme_id: e.color_scheme_id ?? null,
        notify: e.notify,
      })
      .eq("id", e.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { id: e.id };
  } else {
    const { data: row, error } = await supabase
      .from("entries")
      .insert({
        tenant_id: tenantId,
        time: e.time,
        title: e.title,
        description: e.description,
        tags: e.tags,
        color_scheme_id: e.color_scheme_id ?? null,
        notify: e.notify,
      })
      .select("id")
      .single();
      if (error) throw new Error(error.message);
      return { id: row.id };
    }
  });

export const deleteEntry = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    z.object({ key: z.string().min(1), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await resolveTenant(data.key);
    const { error } = await supabase
      .from("entries")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- rooms ----------

export const listRooms = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await resolveTenant(data.key);
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
    const { id: tenantId } = await resolveTenant(data.key);
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
    const { id: tenantId } = await resolveTenant(data.key);
    const { error } = await supabase
      .from("rooms")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
});

// ---------- webhooks ----------

export const listWebhooks = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await resolveTenant(data.key);
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
    const { id: tenantId } = await resolveTenant(data.key);
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
    const { id: tenantId } = await resolveTenant(data.key);
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
    const tenant = await resolveTenant(data.key);
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
      message: { title: string; description: string; color?: string | null };
    }) =>
      z
        .object({
          key: z.string().min(1),
          message: z.object({
            title: z.string().min(1).max(200),
            description: z.string().max(2000).default(""),
            color: z.string().max(7).nullable().default(null),
          }),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id: tenantId } = await resolveTenant(data.key);
    const { data: rows, error } = await supabase
      .from("webhooks")
      .select("id, name, url, type, enabled")
      .eq("tenant_id", tenantId)
      .eq("enabled", true);
    if (error) throw new Error(error.message);
    const webhooks = rows ?? [];
    if (webhooks.length === 0) throw new Error("No active webhooks configured");
    const results = await Promise.all(
      webhooks.map(async (w) => {
        const result = await sendWebhook(w.url, w.type as WebhookType, data.message);
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
  };
  room: { id: string; name: string; color: string | null; template: string };
  entries: {
    id: string;
    time: string;
    title: string;
    description: string;
    tags: string[];
    color: string | null;
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
      .select("id, time, title, description, tags, color_scheme_id")
      .eq("tenant_id", tenant.id);
    if (entriesErr) throw new Error(entriesErr.message);
    const { data: schemes } = await supabase
      .from("color_schemes")
      .select("id, color")
      .eq("tenant_id", tenant.id);
    const { data: ads } = await supabase
      .from("ads")
      .select("id, name, content_type, sort_order")
      .eq("tenant_id", tenant.id)
      .order("sort_order", { ascending: true });
    const colorById = new Map((schemes ?? []).map((s) => [s.id, s.color]));
    const withColor = (entries ?? []).map((e) => ({
      id: e.id,
      time: e.time,
      title: e.title,
      description: e.description,
      tags: e.tags,
      color: e.color_scheme_id ? (colorById.get(e.color_scheme_id) ?? null) : null,
    }));
    return {
      tenant: {
        name: tenant.name,
        past_grace_minutes: tenant.past_grace_minutes,
        template: tenant.template,
        logo_url: tenant.logo_url,
        logo_height: tenant.logo_height,
        accent_color: tenant.accent_color,
        ad_seconds: tenant.ad_seconds,
      },
      room: {
        id: room.id,
        name: room.name,
        color: room.color_scheme_id ? (colorById.get(room.color_scheme_id) ?? null) : null,
        template: room.template || tenant.template,
      },
      entries: filterVisible(withColor, room.name, tenant.past_grace_minutes),
      ads: (ads ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        url: `/api/public/ad/${data.key}/${a.id}`,
        content_type: a.content_type,
      })),
    };
  });

// ---------- color schemes ----------

export const listColorSchemes = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await resolveTenant(data.key);
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
    const { id: tenantId } = await resolveTenant(data.key);
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
    const { id: tenantId } = await resolveTenant(data.key);
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
    const tenant = await resolveTenant(data.key);
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
    const tenant = await resolveTenant(data.key);
    if (tenant.logo_url) {
      await supabase.storage.from("tenant-logos").remove([tenant.logo_url]);
    }
    const { error } = await supabase.from("tenants").update({ logo_url: null }).eq("id", tenant.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- ads ----------

export const listAds = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await resolveTenant(data.key);
    const { data: rows, error } = await supabase
      .from("ads")
      .select("id, name, content_type, sort_order, path")
      .eq("tenant_id", id)
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
    const { id: tenantId } = await resolveTenant(data.key);
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
  .inputValidator((d: { key: string; filename: string; contentType: string; dataBase64: string }) =>
    z
      .object({
        key: z.string().min(1),
        filename: z.string().min(1).max(200),
        contentType: z.string().regex(/^image\//),
        dataBase64: z.string().min(1).max(14_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const tenant = await resolveTenant(data.key);
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
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextOrder = (last?.[0]?.sort_order ?? -1) + 1;
    const { data: row, error } = await supabase
      .from("ads")
      .insert({
        tenant_id: tenant.id,
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
    const { id: tenantId } = await resolveTenant(data.key);
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
    const { id: tenantId } = await resolveTenant(data.key);
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
    const { id: tenantId } = await resolveTenant(data.key);
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
    const tenant = await resolveTenant(data.key);
    const [schemes, rooms, entries, ads, webhooks] = await Promise.all([
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
        .select("time, title, description, tags, color_scheme_id, notify")
        .eq("tenant_id", tenant.id)
        .order("time", { ascending: true }),
      supabase
        .from("ads")
        .select("name, path, content_type, sort_order")
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

    const adItems: { name: string; file: string; content_type: string }[] = [];
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
      adItems.push({ name: a.name, file: path, content_type: a.content_type });
    }

    const payload: TenantData = {
      version: IO_VERSION,
      exported_at: new Date().toISOString(),
      tenant: {
        name: tenant.name,
        past_grace_minutes: tenant.past_grace_minutes,
        template: tenant.template,
        logo_height: tenant.logo_height,
        accent_color: tenant.accent_color,
        ad_seconds: tenant.ad_seconds,
      },
      color_schemes: schemeRows.map((s, idx) => ({
        id: schemeIds[idx],
        name: s.name,
        color: s.color,
      })),
      rooms: roomRows.map((r, idx) => ({
        id: roomIds[idx],
        name: r.name,
        template: (r.template === "ads" || r.template === "zeitplan" ? r.template : null) as
          | "ads"
          | "zeitplan"
          | null,
        color_scheme: r.color_scheme_id ? (schemeIdByUuid.get(r.color_scheme_id) ?? null) : null,
      })),
      entries: (entries.data ?? []).map((e) => ({
        time: e.time,
        title: e.title,
        description: e.description,
        rooms: e.tags.map((name) => roomIdByName.get(name) ?? slugify(name)).filter(Boolean),
        color_scheme: e.color_scheme_id ? (schemeIdByUuid.get(e.color_scheme_id) ?? null) : null,
        notify: e.notify,
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
    const tenant = await resolveTenant(data.key);
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
          template: r.template ?? null,
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
        await supabase.from("entries").delete().eq("tenant_id", tenant.id);
      }
      if (p.entries.length) {
        const rows = p.entries.map((e) => {
          for (const ref of e.rooms) {
            if (!roomNameByRef.get(ref)) {
              warnings.push(`Entry "${e.title}": unknown room "${ref}"`);
            }
          }
          if (e.color_scheme && !schemeUuid(e.color_scheme)) {
            warnings.push(`Entry "${e.title}": unknown color scheme "${e.color_scheme}"`);
          }
          return {
            tenant_id: tenant.id,
            time: e.time,
            title: e.title,
            description: e.description,
            tags: e.rooms.map((ref) => roomNameByRef.get(ref) ?? ref),
            color_scheme_id: schemeUuid(e.color_scheme),
            notify: e.notify,
          };
        });
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
      const { data: last } = await supabase
        .from("ads")
        .select("sort_order")
        .eq("tenant_id", tenant.id)
        .order("sort_order", { ascending: false })
        .limit(1);
      let order = (last?.[0]?.sort_order ?? -1) + 1;
      for (const a of p.ads) {
        const file = findFile(a.file);
        if (!file) {
          warnings.push(`Ad "${a.name}": image file "${a.file}" is missing in the archive`);
          continue;
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
          name: a.name,
          path,
          content_type: a.content_type || file.content_type,
          sort_order: order++,
        });
        if (insErr) {
          warnings.push(`Ad "${a.name}" not imported: ${insErr.message}`);
          continue;
        }
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
        update.template = p.tenant.template;
        update.logo_height = p.tenant.logo_height;
        update.accent_color = p.tenant.accent_color.toUpperCase();
        update.ad_seconds = p.tenant.ad_seconds;
        counts.tenant = 1;
      }
      if (logoPath !== undefined) update.logo_url = logoPath;
      const { error } = await supabase.from("tenants").update(update).eq("id", tenant.id);
      if (error) throw new Error(error.message);
    }

    return { ok: true, counts, warnings };
  });
