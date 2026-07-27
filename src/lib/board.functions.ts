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

async function resolveTenant(
  key: string,
): Promise<{ id: string; name: string; past_grace_minutes: number; template: string; logo_url: string | null }> {
  const supabase = await getAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, past_grace_minutes, template, logo_url")
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
  }) =>
    z
      .object({
        key: z.string().min(1),
        name: z.string().min(1).max(120),
        past_grace_minutes: z.number().int().min(0).max(24 * 60),
        template: z.string().min(1).max(40),
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
      .select("id, time, title, description, tags")
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
        .update({ time: e.time, title: e.title, description: e.description, tags: e.tags })
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
      .select("id, name")
      .eq("tenant_id", id)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const roomInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
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
        .update({ name: r.name })
        .eq("id", r.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return { id: r.id };
    } else {
      const { data: row, error } = await supabase
        .from("rooms")
        .insert({ tenant_id: tenantId, name: r.name })
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
  tenant: { name: string; past_grace_minutes: number; template: string; logo_url: string | null };
  room: { id: string; name: string };
  entries: { id: string; time: string; title: string; description: string; tags: string[] }[];
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
      .select("id, name")
      .eq("id", data.roomId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (roomErr) throw new Error(roomErr.message);
    if (!room) throw new Error("Unknown room");
    const { data: entries, error: entriesErr } = await supabase
      .from("entries")
      .select("id, time, title, description, tags")
      .eq("tenant_id", tenant.id);
    if (entriesErr) throw new Error(entriesErr.message);
    return {
      tenant: {
        name: tenant.name,
        past_grace_minutes: tenant.past_grace_minutes,
        template: tenant.template,
        logo_url: tenant.logo_url,
      },
      room,
      entries: filterVisible(entries ?? [], room.name, tenant.past_grace_minutes),
    };
  });
