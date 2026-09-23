import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { FileItem } from "@/lib/files";

const keyIn = z.object({ key: z.string().min(1) });
const uploadIn = {
  filename: z.string().min(1).max(300),
  contentType: z.string().min(1).max(200).default("application/octet-stream"),
  dataBase64: z.string().min(1),
};

async function admin() {
  const { getBackendAdmin } = await import("@/lib/backend/admin.server");
  return getBackendAdmin();
}

function rows(data: unknown): FileItem[] {
  return (data ?? []) as FileItem[];
}

async function nextSort(table: "team_files" | "tenant_files", filter: Record<string, string>) {
  const db = await admin();
  let q = db.from(table).select("sort_order");
  for (const [k, v] of Object.entries(filter)) q = q.eq(k as never, v as never);
  const { data } = await q.order("sort_order", { ascending: false }).limit(1).maybeSingle();
  return ((data as { sort_order?: number } | null)?.sort_order ?? -1) + 1;
}

// ---------- team files (admin) ----------

export const listTeamFiles = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string; teamId: string }) =>
    keyIn.extend({ teamId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }): Promise<FileItem[]> => {
    const { requireFileAdmin } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const db = await admin();
    const { data: list } = await db
      .from("team_files")
      .select("id, name, size_bytes, content_type, created_at")
      .eq("tenant_id", tenant.id)
      .eq("team_id" as never, data.teamId as never)
      .order("sort_order", { ascending: true });
    return rows(list);
  });

export const uploadTeamFile = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      key: string;
      teamId: string;
      filename: string;
      contentType?: string;
      dataBase64: string;
    }) => keyIn.extend({ teamId: z.string().uuid(), ...uploadIn }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireFileAdmin, decodeBase64, extensionOf } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    if (tenant.filesMode === "off") throw new Error("Files are disabled");
    const bytes = decodeBase64(data.dataBase64);
    if (bytes.byteLength > tenant.maxUploadMb * 1024 * 1024)
      throw new Error(`File is larger than ${tenant.maxUploadMb} MB`);
    const { fileStorage, teamFileKey } = await import("@/lib/storage/index.server");
    const storageKey = teamFileKey(tenant.id, data.teamId, extensionOf(data.filename));
    await fileStorage().put(storageKey, bytes, data.contentType);
    const db = await admin();
    const { error } = await db.from("team_files").insert({
      tenant_id: tenant.id,
      team_id: data.teamId,
      name: data.filename,
      storage_key: storageKey,
      content_type: data.contentType,
      size_bytes: bytes.byteLength,
      sort_order: await nextSort("team_files", { team_id: data.teamId }),
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTeamFile = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    keyIn.extend({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireFileAdmin } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const db = await admin();
    const { data: row } = await db
      .from("team_files")
      .select("id, storage_key")
      .eq("tenant_id", tenant.id)
      .eq("id", data.id)
      .maybeSingle();
    const found = row as unknown as { storage_key: string } | null;
    if (!found) throw new Error("File not found");
    const { fileStorage } = await import("@/lib/storage/index.server");
    await fileStorage().remove([found.storage_key]);
    await db.from("team_files").delete().eq("tenant_id", tenant.id).eq("id", data.id);
    return { ok: true };
  });

// ---------- organization wide downloads (admin) ----------

export const listTenantFiles = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => keyIn.parse(d))
  .handler(async ({ data }): Promise<FileItem[]> => {
    const { requireFileAdmin } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const db = await admin();
    const { data: list } = await db
      .from("tenant_files")
      .select("id, name, size_bytes, content_type, created_at")
      .eq("tenant_id", tenant.id)
      .order("sort_order", { ascending: true });
    return rows(list);
  });

export const uploadTenantFile = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; filename: string; contentType?: string; dataBase64: string }) =>
    keyIn.extend(uploadIn).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireFileAdmin, decodeBase64, extensionOf } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    if (tenant.filesMode === "off") throw new Error("Files are disabled");
    const bytes = decodeBase64(data.dataBase64);
    if (bytes.byteLength > tenant.maxUploadMb * 1024 * 1024)
      throw new Error(`File is larger than ${tenant.maxUploadMb} MB`);
    const { fileStorage, tenantFileKey } = await import("@/lib/storage/index.server");
    const storageKey = tenantFileKey(tenant.id, extensionOf(data.filename));
    await fileStorage().put(storageKey, bytes, data.contentType);
    const db = await admin();
    const { error } = await db.from("tenant_files").insert({
      tenant_id: tenant.id,
      name: data.filename,
      storage_key: storageKey,
      content_type: data.contentType,
      size_bytes: bytes.byteLength,
      sort_order: await nextSort("tenant_files", { tenant_id: tenant.id }),
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const renameTenantFile = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string; name: string }) =>
    keyIn.extend({ id: z.string().uuid(), name: z.string().min(1).max(300) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireFileAdmin } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const db = await admin();
    const { error } = await db
      .from("tenant_files")
      .update({ name: data.name.trim() } as never)
      .eq("tenant_id", tenant.id)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTenantFile = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string }) =>
    keyIn.extend({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireFileAdmin } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const db = await admin();
    const { data: row } = await db
      .from("tenant_files")
      .select("id, storage_key")
      .eq("tenant_id", tenant.id)
      .eq("id", data.id)
      .maybeSingle();
    const found = row as unknown as { storage_key: string } | null;
    if (!found) throw new Error("File not found");
    const { fileStorage } = await import("@/lib/storage/index.server");
    await fileStorage().remove([found.storage_key]);
    await db.from("tenant_files").delete().eq("tenant_id", tenant.id).eq("id", data.id);
    return { ok: true };
  });

/** Returns a short lived download URL for an admin (team or global file). */
export const getFileDownloadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; scope: "team" | "tenant"; id: string }) =>
    keyIn.extend({ scope: z.enum(["team", "tenant"]), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireFileAdmin, signFileToken } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const db = await admin();
    const { data: row } = await db
      .from(data.scope === "team" ? "team_files" : "tenant_files")
      .select("name, storage_key, content_type")
      .eq("tenant_id", tenant.id)
      .eq("id", data.id)
      .maybeSingle();
    const found = row as unknown as {
      name: string;
      storage_key: string;
      content_type: string;
    } | null;
    if (!found) throw new Error("File not found");
    const token = await signFileToken({
      k: found.storage_key,
      n: found.name,
      ct: found.content_type,
    });
    return { url: `/api/public/file-download?t=${encodeURIComponent(token)}` };
  });

// ---------- all team files (admin overview) ----------

export type TeamFileRow = FileItem & { team_id: string; tag: string };

export const listAllTeamFiles = createServerFn({ method: "GET" })
  .inputValidator((d: { key: string }) => keyIn.parse(d))
  .handler(async ({ data }): Promise<TeamFileRow[]> => {
    const { requireFileAdmin } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const db = await admin();
    const [{ data: list }, { data: teams }] = await Promise.all([
      db
        .from("team_files")
        .select("id, name, size_bytes, content_type, created_at, team_id")
        .eq("tenant_id", tenant.id),
      db.from("teams").select("id, name, sort_order").eq("tenant_id", tenant.id),
    ]);
    const teamRows = (teams ?? []) as unknown as {
      id: string;
      name: string;
      sort_order: number | null;
    }[];
    const nameById = new Map(teamRows.map((r) => [r.id, r.name]));
    const orderById = new Map(teamRows.map((r) => [r.id, r.sort_order ?? 0]));
    const rowsOut = ((list ?? []) as unknown as (FileItem & { team_id: string })[]).map((f) => ({
      ...f,
      tag: nameById.get(f.team_id) ?? "—",
    }));
    return rowsOut.sort(
      (a, b) =>
        (orderById.get(a.team_id) ?? 0) - (orderById.get(b.team_id) ?? 0) ||
        a.tag.localeCompare(b.tag) ||
        a.name.localeCompare(b.name),
    );
  });

export const renameTeamFile = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; id: string; name: string }) =>
    keyIn.extend({ id: z.string().uuid(), name: z.string().min(1).max(300) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireFileAdmin } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const db = await admin();
    const { error } = await db
      .from("team_files")
      .update({ name: data.name.trim() } as never)
      .eq("tenant_id", tenant.id)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Signed URL for a ZIP of all team files, or of the given selection. */
export const getTeamFilesZipUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; ids?: string[] }) =>
    keyIn.extend({ ids: z.array(z.string().uuid()).max(2000).default([]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireFileAdmin, signZipToken } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const token = await signZipToken({ t: tenant.id, ids: data.ids });
    return { url: `/api/public/files-zip?t=${encodeURIComponent(token)}` };
  });

/** Self management path of a team, creating a missing edit code on demand. */
export const getTeamSelfUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { key: string; teamId: string }) =>
    keyIn.extend({ teamId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ path: string } | { reason: "no-token" }> => {
    const { requireFileAdmin } = await import("@/lib/files.server");
    const tenant = await requireFileAdmin(data.key);
    const db = await admin();
    const { data: teamRow } = await db
      .from("teams")
      .select("id, edit_code, room_id")
      .eq("tenant_id", tenant.id)
      .eq("id", data.teamId)
      .maybeSingle();
    const team = teamRow as unknown as {
      id: string;
      edit_code: string | null;
      room_id: string | null;
    } | null;
    if (!team) throw new Error("Unknown team");

    const { data: entryRows } = await db
      .from("entries")
      .select("register_token, tags, time")
      .eq("tenant_id", tenant.id)
      .eq("kind" as never, "register" as never)
      .order("time", { ascending: true });
    const entries = ((entryRows ?? []) as unknown as {
      register_token: string | null;
      tags: string[] | null;
    }[]).filter((e) => !!e.register_token);
    if (!entries.length) return { reason: "no-token" as const };
    const preferred =
      entries.find((e) => !!team.room_id && (e.tags ?? []).includes(team.room_id)) ?? entries[0];

    let code = team.edit_code;
    if (!code) {
      const { randomToken, EDIT_CODE_LENGTH } = await import("@/lib/registration");
      code = randomToken(EDIT_CODE_LENGTH);
      const { error } = await db
        .from("teams")
        .update({ edit_code: code } as never)
        .eq("tenant_id", tenant.id)
        .eq("id", team.id);
      if (error) throw new Error(error.message);
    }
    return { path: `/tr/${preferred.register_token}/${code}` };
  });
