import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
    const { data, error } = await supabase
      .from("tenants")
      .insert({ key })
      .select("key")
      .single();
    if (!error && data) return { key: data.key };
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
  }
  throw new Error("Could not generate unique tenant key");
});

export const getTenant = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => resolveTenant(data.key));

export const updateTenantSettings = createServerFn({ method: "POST" })
  .inputValidator((d: {
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
        past_grace_minutes: z.number().int().min(0).max(24 * 60),
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

// ---------- entries ----------

export const listEntries = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { id } = await resolveTenant(data.key);
    const { data: rows, error } = await supabase
      .from("entries")
      .select("id, time, title, description, tags, color_scheme_id")
      .eq("tenant_id", id)
      .order("time", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const entryInput = z.object({
  id: z.string().uuid().optional(),
  time: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  tags: z.array(z.string().min(1).max(120)).max(50).default([]),
  color_scheme_id: z.string().uuid().nullable().default(null),
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
      .select("id, name, color_scheme_id, template")
      .eq("tenant_id", id)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const roomInput = z.object({
  id: z.string().uuid().optional(),
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
    if (r.id) {
      const { error } = await supabase
        .from("rooms")
        .update({
          name: r.name,
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

// ---------- snapshot for displays ----------

export type RoomSnapshot = {
  tenant: {
    name: string;
    past_grace_minutes: number;
    template: string;
    logo_url: string | null;
    logo_height: number;
    accent_color: string;
  };
  room: { id: string; name: string; color: string | null };
  entries: {
    id: string;
    time: string;
    title: string;
    description: string;
    tags: string[];
    color: string | null;
  }[];
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
      .select("id, name, color_scheme_id")
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
      },
      room: {
        id: room.id,
        name: room.name,
        color: room.color_scheme_id ? (colorById.get(room.color_scheme_id) ?? null) : null,
      },
      entries: filterVisible(withColor, room.name, tenant.past_grace_minutes),
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
      .select("id, name, color")
      .eq("tenant_id", id)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const schemeInput = z.object({
  id: z.string().uuid().optional(),
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
    if (s.id) {
      const { error } = await supabase
        .from("color_schemes")
        .update({ name: s.name, color: s.color })
        .eq("id", s.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return { id: s.id };
    }
    const { data: row, error } = await supabase
      .from("color_schemes")
      .insert({ tenant_id: tenantId, name: s.name, color: s.color })
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
