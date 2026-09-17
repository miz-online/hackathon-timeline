import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EDIT_CODE_LENGTH, randomToken, roomForToken } from "@/lib/registration";
import type { FileItem, FileMode } from "@/lib/files";

type Resolved = {
  tenantId: string;
  tenantKey: string;
  tenantName: string;
  logoUrl: string | null;
  logoHeight: number;
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
  const { getBackendAdmin } = await import("@/lib/backend/admin.server");
  const supabaseAdmin = await getBackendAdmin();
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
      .select("key, name, logo_url, logo_height, team_edit_locked")
      .eq("id", e.tenant_id)
      .maybeSingle();
    const t = tenant as unknown as {
      key: string;
      name: string;
      logo_url: string | null;
      logo_height: number | null;
      team_edit_locked: boolean;
    } | null;
    if (!t) return null;
    return {
      tenantId: e.tenant_id,
      tenantKey: t.key,
      tenantName: t.name,
      logoUrl: t.logo_url ? `/api/public/logo/${t.key}` : null,
      logoHeight: t.logo_height ?? 64,
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
      logoUrl: res.logoUrl,
      logoHeight: res.logoHeight,
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
    const { getBackendAdmin } = await import("@/lib/backend/admin.server");
    const supabaseAdmin = await getBackendAdmin();
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

/** Resolves the team behind a token + edit code pair. */
async function resolveTeam(token: string, code: string) {
  const res = await resolveToken(token);
  if (!res) return null;
  const { getBackendAdmin } = await import("@/lib/backend/admin.server");
  const supabaseAdmin = await getBackendAdmin();
  const { data: row } = await supabaseAdmin
    .from("teams")
    .select("id, name, members, project, room_id")
    .eq("tenant_id", res.tenantId)
    .eq("edit_code" as never, code as never)
    .maybeSingle();
  if (!row) return null;
  return {
    res,
    team: row as unknown as {
      id: string;
      name: string;
      members: string;
      project: string;
      room_id: string | null;
    },
  };
}

export const getRegisteredTeam = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string; code: string }) =>
    z.object({ token: z.string().min(4).max(40), code: z.string().min(6).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const found = await resolveTeam(data.token, data.code);
    if (!found) return { found: false as const };
    const { res, team } = found;
    const { tenantFileConfig } = await import("@/lib/files.server");
    const cfg = await tenantFileConfig(res.tenantId);
    return {
      found: true as const,
      locked: res.teamEditLocked,
      tenantName: res.tenantName,
      logoUrl: res.logoUrl,
      logoHeight: res.logoHeight,
      title: res.entry.title,
      rooms: res.rooms,
      filesMode: cfg.filesMode,
      maxUploadMb: cfg.maxUploadMb,
      team,
    };
  });

export const updateRegisteredTeam = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { token: string; code: string; name: string; members?: string; project?: string }) =>
      z
        .object({
          token: z.string().min(4).max(40),
          code: z.string().min(6).max(40),
          name: teamFields.name,
          members: teamFields.members,
          project: teamFields.project,
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const res = await resolveToken(data.token);
    if (!res) throw new Error("Unknown registration link");
    if (res.teamEditLocked) throw new Error("Team editing is locked");
    const { getBackendAdmin } = await import("@/lib/backend/admin.server");
    const supabaseAdmin = await getBackendAdmin();
    const { error } = await supabaseAdmin
      .from("teams")
      .update({
        name: data.name.trim(),
        members: data.members ?? "",
        project: data.project ?? "",
      })
      .eq("tenant_id", res.tenantId)
      .eq("edit_code" as never, data.code as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- team files (self service) ----------

const teamFileIn = z.object({
  token: z.string().min(4).max(40),
  code: z.string().min(6).max(40),
});

/** Own files plus the organization wide downloads. */
export const listFilesForTeam = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string; code: string }) => teamFileIn.parse(d))
  .handler(async ({ data }): Promise<{ mode: FileMode; own: FileItem[]; shared: FileItem[] }> => {
    const found = await resolveTeam(data.token, data.code);
    if (!found) throw new Error("Unknown link");
    const { tenantFileConfig } = await import("@/lib/files.server");
    const cfg = await tenantFileConfig(found.res.tenantId);
    if (cfg.filesMode === "off") return { own: [], shared: [], mode: cfg.filesMode };
    const { getBackendAdmin } = await import("@/lib/backend/admin.server");
    const db = await getBackendAdmin();
    const cols = "id, name, size_bytes, content_type, created_at";
    const [own, shared] = await Promise.all([
      cfg.filesMode === "full"
        ? db
            .from("team_files")
            .select(cols)
            .eq("tenant_id", found.res.tenantId)
            .eq("team_id" as never, found.team.id as never)
            .order("sort_order", { ascending: true })
        : Promise.resolve({ data: [] }),
      db
        .from("tenant_files")
        .select(cols)
        .eq("tenant_id", found.res.tenantId)
        .order("sort_order", { ascending: true }),
    ]);
    return {
      mode: cfg.filesMode,
      own: (own.data ?? []) as unknown as FileItem[],
      shared: (shared.data ?? []) as unknown as FileItem[],
    };
  });

export const uploadFileForTeam = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      code: string;
      filename: string;
      contentType?: string;
      dataBase64: string;
    }) =>
      teamFileIn
        .extend({
          filename: z.string().min(1).max(300),
          contentType: z.string().min(1).max(200).default("application/octet-stream"),
          dataBase64: z.string().min(1),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const found = await resolveTeam(data.token, data.code);
    if (!found) throw new Error("Unknown link");
    const { tenantFileConfig, decodeBase64, extensionOf } = await import("@/lib/files.server");
    const cfg = await tenantFileConfig(found.res.tenantId);
    if (cfg.filesMode !== "full") throw new Error("Uploads are disabled");
    if (cfg.teamEditLocked) throw new Error("Team editing is locked");
    const bytes = decodeBase64(data.dataBase64);
    if (bytes.byteLength > cfg.maxUploadMb * 1024 * 1024)
      throw new Error(`File is larger than ${cfg.maxUploadMb} MB`);
    const { fileStorage, teamFileKey } = await import("@/lib/storage/index.server");
    const storageKey = teamFileKey(found.res.tenantId, found.team.id, extensionOf(data.filename));
    await fileStorage().put(storageKey, bytes, data.contentType);
    const { getBackendAdmin } = await import("@/lib/backend/admin.server");
    const db = await getBackendAdmin();
    const { data: last } = await db
      .from("team_files")
      .select("sort_order")
      .eq("team_id" as never, found.team.id as never)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await db.from("team_files").insert({
      tenant_id: found.res.tenantId,
      team_id: found.team.id,
      name: data.filename,
      storage_key: storageKey,
      content_type: data.contentType,
      size_bytes: bytes.byteLength,
      sort_order: ((last as { sort_order?: number } | null)?.sort_order ?? -1) + 1,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFileForTeam = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; code: string; id: string }) =>
    teamFileIn.extend({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const found = await resolveTeam(data.token, data.code);
    if (!found) throw new Error("Unknown link");
    const { tenantFileConfig } = await import("@/lib/files.server");
    const cfg = await tenantFileConfig(found.res.tenantId);
    if (cfg.filesMode !== "full") throw new Error("Files are read only");
    if (cfg.teamEditLocked) throw new Error("Team editing is locked");
    const { getBackendAdmin } = await import("@/lib/backend/admin.server");
    const db = await getBackendAdmin();
    const { data: row } = await db
      .from("team_files")
      .select("id, storage_key")
      .eq("team_id" as never, found.team.id as never)
      .eq("id", data.id)
      .maybeSingle();
    const file = row as unknown as { storage_key: string } | null;
    if (!file) throw new Error("File not found");
    const { fileStorage } = await import("@/lib/storage/index.server");
    await fileStorage().remove([file.storage_key]);
    await db.from("team_files").delete().eq("id", data.id);
    return { ok: true };
  });

/** Short lived download URL for the team's own files or a shared download. */
export const getTeamFileDownloadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; code: string; scope: "team" | "tenant"; id: string }) =>
    teamFileIn.extend({ scope: z.enum(["team", "tenant"]), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const found = await resolveTeam(data.token, data.code);
    if (!found) throw new Error("Unknown link");
    const { tenantFileConfig, signFileToken } = await import("@/lib/files.server");
    const cfg = await tenantFileConfig(found.res.tenantId);
    if (cfg.filesMode === "off") throw new Error("Files are disabled");
    if (data.scope === "team" && cfg.filesMode !== "full") throw new Error("Files are disabled");
    const { getBackendAdmin } = await import("@/lib/backend/admin.server");
    const db = await getBackendAdmin();
    let q = db
      .from(data.scope === "team" ? "team_files" : "tenant_files")
      .select("name, storage_key, content_type")
      .eq("tenant_id", found.res.tenantId)
      .eq("id", data.id);
    // Teams never reach files of other teams.
    if (data.scope === "team") q = q.eq("team_id" as never, found.team.id as never);
    const { data: row } = await q.maybeSingle();
    const file = row as unknown as { name: string; storage_key: string; content_type: string } | null;
    if (!file) throw new Error("File not found");
    const token = await signFileToken({ k: file.storage_key, n: file.name, ct: file.content_type });
    return { url: `/api/public/file-download?t=${encodeURIComponent(token)}` };
  });


