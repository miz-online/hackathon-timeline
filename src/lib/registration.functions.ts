import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EDIT_CODE_LENGTH, randomToken, roomForToken } from "@/lib/registration";

type Resolved = {
  tenantId: string;
  tenantKey: string;
  tenantName: string;
  teamEditLocked: boolean;
  entry: { id: string; title: string; description: string; time: string; end_time: string | null };
  rooms: { id: string; name: string }[];
  roomId: string | null;
};

/**
 * Resolves a public registration token: either the base token of a registration
 * entry, or one of its room-specific variants (which preselects that room).
 */
async function resolveToken(token: string): Promise<Resolved | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows } = await supabaseAdmin
    .from("entries")
    .select("id, tenant_id, title, description, time, end_time, register_token")
    .eq("kind", "register");
  const entries = (rows ?? []) as unknown as Array<{
    id: string;
    tenant_id: string;
    title: string;
    description: string;
    time: string;
    end_time: string | null;
    register_token: string | null;
  }>;

  for (const e of entries) {
    if (!e.register_token) continue;
    const { data: roomRows } = await supabaseAdmin
      .from("rooms")
      .select("id, name")
      .eq("tenant_id", e.tenant_id)
      .order("name", { ascending: true });
    const rooms = (roomRows ?? []) as { id: string; name: string }[];
    const isBase = token === e.register_token;
    const roomId = isBase
      ? null
      : await roomForToken(e.register_token, token, rooms.map((r) => r.id));
    if (!isBase && !roomId) continue;
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("key, name, team_edit_locked")
      .eq("id", e.tenant_id)
      .maybeSingle();
    const t = tenant as unknown as { key: string; name: string; team_edit_locked: boolean } | null;
    if (!t) return null;
    return {
      tenantId: e.tenant_id,
      tenantKey: t.key,
      tenantName: t.name,
      teamEditLocked: t.team_edit_locked === true,
      entry: {
        id: e.id,
        title: e.title,
        description: e.description,
        time: e.time,
        end_time: e.end_time,
      },
      rooms,
      roomId,
    };
  }
  return null;
}

function windowOpen(entry: Resolved["entry"]): boolean {
  const now = Date.now();
  const start = new Date(entry.time).getTime();
  const end = entry.end_time ? new Date(entry.end_time).getTime() : start + 60 * 60 * 1000;
  return now >= start && now <= end;
}

export const getRegistration = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) =>
    z.object({ token: z.string().min(4).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const res = await resolveToken(data.token);
    if (!res) return { found: false as const };
    return {
      found: true as const,
      open: windowOpen(res.entry),
      tenantName: res.tenantName,
      title: res.entry.title,
      description: res.entry.description,
      time: res.entry.time,
      end_time: res.entry.end_time,
      rooms: res.rooms,
      roomId: res.roomId,
    };
  });

const teamFields = {
  name: z.string().min(1).max(120),
  members: z.string().max(2000).default(""),
  project: z.string().max(4000).default(""),
  room_id: z.string().uuid().nullable().default(null),
};

export const submitRegistration = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      name: string;
      members?: string;
      project?: string;
      room_id?: string | null;
    }) => z.object({ token: z.string().min(4).max(40), ...teamFields }).parse(d),
  )
  .handler(async ({ data }) => {
    const res = await resolveToken(data.token);
    if (!res) throw new Error("Unknown registration link");
    if (!windowOpen(res.entry)) throw new Error("Registration is closed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: last } = await supabaseAdmin
      .from("teams")
      .select("sort_order")
      .eq("tenant_id", res.tenantId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const code = randomToken(EDIT_CODE_LENGTH);
    const { error } = await supabaseAdmin.from("teams").insert({
      tenant_id: res.tenantId,
      name: data.name.trim(),
      ref_id: data.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      members: data.members ?? "",
      project: data.project ?? "",
      room_id: data.room_id ?? res.roomId ?? null,
      sort_order: (last?.sort_order ?? -1) + 1,
      edit_code: code,
      self_registered: true,
    } as never);
    if (error) throw new Error(error.message);
    return { code };
  });

export const getRegisteredTeam = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string; code: string }) =>
    z.object({ token: z.string().min(4).max(40), code: z.string().min(6).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const res = await resolveToken(data.token);
    if (!res) return { found: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("teams")
      .select("id, name, members, project, room_id")
      .eq("tenant_id", res.tenantId)
      .eq("edit_code" as never, data.code as never)
      .maybeSingle();
    if (!row) return { found: false as const };
    return {
      found: true as const,
      locked: res.teamEditLocked,
      tenantName: res.tenantName,
      title: res.entry.title,
      rooms: res.rooms,
      team: row as unknown as {
        id: string;
        name: string;
        members: string;
        project: string;
        room_id: string | null;
      },
    };
  });

export const updateRegisteredTeam = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      code: string;
      name: string;
      members?: string;
      project?: string;
      room_id?: string | null;
    }) =>
      z
        .object({
          token: z.string().min(4).max(40),
          code: z.string().min(6).max(40),
          ...teamFields,
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const res = await resolveToken(data.token);
    if (!res) throw new Error("Unknown registration link");
    if (res.teamEditLocked) throw new Error("Team editing is locked");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("teams")
      .update({
        name: data.name.trim(),
        members: data.members ?? "",
        project: data.project ?? "",
        room_id: data.room_id ?? null,
      })
      .eq("tenant_id", res.tenantId)
      .eq("edit_code" as never, data.code as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
