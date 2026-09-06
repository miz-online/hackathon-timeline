import { getBackendAdmin } from "@/lib/backend/admin.server";
/** Ads are grouped in sets; a display template selects one set: "ads:<setId>". */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SnapshotAd = { id: string; name: string; url: string; content_type: string };

/** Returns the requested set id (or null for "first set") when the template is an ads template. */
export function parseAdsTemplate(
  template: string | null | undefined,
): { setId: string | null } | null {
  if (!template) return null;
  if (template === "ads") return { setId: null };
  if (template.startsWith("ads:")) {
    const rest = template.slice(4).trim();
    return { setId: rest && UUID_RE.test(rest) ? rest : null };
  }
  return null;
}

export function isAdsTemplate(template: string | null | undefined): boolean {
  return parseAdsTemplate(template) !== null;
}

/** Loads the ads (with signed URLs) and display duration for an ads template. */
export async function loadAdsForTemplate(opts: {
  tenantId: string;
  tenantKey: string;
  template: string | null | undefined;
  fallbackSeconds: number;
}): Promise<{ ads: SnapshotAd[]; adSeconds: number }> {
  const parsed = parseAdsTemplate(opts.template);
  if (!parsed) return { ads: [], adSeconds: opts.fallbackSeconds };

  const supabaseAdmin = await getBackendAdmin();

  let query = supabaseAdmin
    .from("ad_sets")
    .select("id, ad_seconds")
    .eq("tenant_id", opts.tenantId)
    .order("sort_order", { ascending: true })
    .limit(1);
  if (parsed.setId) query = query.eq("id", parsed.setId);
  const { data: sets } = await query;
  const set = sets?.[0] ?? null;
  if (!set) return { ads: [], adSeconds: opts.fallbackSeconds };

  const { data: ads } = await supabaseAdmin
    .from("ads")
    .select("id, name, content_type, path")
    .eq("tenant_id", opts.tenantId)
    .eq("ad_set_id", set.id)
    .order("sort_order", { ascending: true });

  const list = ads ?? [];
  // Signed storage URLs so displays don't load images through this worker
  // origin (a long-lived SSE connection can stall those).
  const signed = new Map<string, string>();
  if (list.length) {
    const { data: urls } = await supabaseAdmin.storage.from("tenant-ads").createSignedUrls(
      list.map((a) => a.path),
      60 * 60 * 12,
    );
    (urls ?? []).forEach((u, i) => {
      if (u.signedUrl && list[i]) signed.set(list[i].id, u.signedUrl);
    });
  }

  return {
    adSeconds: set.ad_seconds,
    ads: list.map((a) => ({
      id: a.id,
      name: a.name,
      url: signed.get(a.id) ?? `/api/public/ad/${opts.tenantKey}/${a.id}`,
      content_type: a.content_type,
    })),
  };
}
