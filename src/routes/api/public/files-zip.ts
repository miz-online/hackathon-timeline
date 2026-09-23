import { createFileRoute } from "@tanstack/react-router";

/**
 * Streams a ZIP archive of team files for a short lived signed token. Files are
 * grouped into one folder per team; the browser never sees a provider URL.
 */
export const Route = createFileRoute("/api/public/files-zip")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("t");
        if (!token) return new Response("Missing token", { status: 400 });

        const { readZipToken } = await import("@/lib/files.server");
        const ref = await readZipToken(token);
        if (!ref) return new Response("Invalid or expired token", { status: 403 });

        const { getBackendAdmin } = await import("@/lib/backend/admin.server");
        const db = await getBackendAdmin();
        let q = db
          .from("team_files")
          .select("id, name, storage_key, team_id")
          .eq("tenant_id", ref.t);
        if (ref.ids.length) q = q.in("id", ref.ids);
        const { data } = await q;
        const files = (data ?? []) as unknown as {
          id: string;
          name: string;
          storage_key: string;
          team_id: string;
        }[];
        if (!files.length) return new Response("Not found", { status: 404 });

        const { data: teamRows } = await db
          .from("teams")
          .select("id, name")
          .eq("tenant_id", ref.t);
        const teamName = new Map(
          ((teamRows ?? []) as unknown as { id: string; name: string }[]).map((r) => [
            r.id,
            r.name,
          ]),
        );

        const safe = (s: string) => s.replace(/[\\/:*?"<>|\r\n]/g, "_").trim() || "file";
        const { fileStorage } = await import("@/lib/storage/index.server");
        const storage = fileStorage();
        const tree: Record<string, Uint8Array> = {};
        for (const f of files) {
          const object = await storage.get(f.storage_key);
          if (!object) continue;
          const folder = safe(teamName.get(f.team_id) ?? "team");
          let path = `${folder}/${safe(f.name)}`;
          let i = 2;
          while (tree[path]) path = `${folder}/${i++}-${safe(f.name)}`;
          tree[path] = object.bytes;
        }
        if (!Object.keys(tree).length) return new Response("Not found", { status: 404 });

        const { zipSync } = await import("fflate");
        const nested: Record<string, unknown> = {};
        for (const [path, bytes] of Object.entries(tree)) {
          const [folder, name] = path.split("/");
          const dir = (nested[folder] ??= {}) as Record<string, Uint8Array>;
          dir[name] = bytes;
        }
        const zipped = zipSync(nested as never, { level: 6 });

        return new Response(zipped as unknown as BodyInit, {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="team-files.zip"`,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
