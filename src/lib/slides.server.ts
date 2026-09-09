import { getBackendAdmin } from "@/lib/backend/admin.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SnapshotSlide = {
  id: string;
  name: string;
  url: string;
  content_type: string;
  duration_seconds: number | null;
};

export type SlideOverlay = {
  show_room_name: boolean;
  show_clock: boolean;
  show_logo: boolean;
};

/** Returns the requested set id (or null for "first set") when the template is a slides template. */
export function parseSlidesTemplate(
  template: string | null | undefined,
): { setId: string | null } | null {
  if (!template) return null;
  if (template === "slides") return { setId: null };
  if (template.startsWith("slides:")) {
    const rest = template.slice(7).trim();
    return { setId: rest && UUID_RE.test(rest) ? rest : null };
  }
  return null;
}

export function isSlidesTemplate(template: string | null | undefined): boolean {
  return parseSlidesTemplate(template) !== null;
}

/** Loads the slides (with signed URLs), display duration and overlay flags for a slides template. */
export async function loadSlidesForTemplate(opts: {
  tenantId: string;
  tenantKey: string;
  template: string | null | undefined;
  fallbackSeconds: number;
}): Promise<{
  slides: SnapshotSlide[];
  slideSeconds: number;
  showRoomName: boolean;
  showClock: boolean;
  showLogo: boolean;
}> {
  const parsed = parseSlidesTemplate(opts.template);
  if (!parsed) {
    return {
      slides: [],
      slideSeconds: opts.fallbackSeconds,
      showRoomName: true,
      showClock: true,
      showLogo: true,
    };
  }

  const supabaseAdmin = await getBackendAdmin();

  let query = supabaseAdmin
    .from("slide_sets")
    .select("id, slide_seconds, show_room_name, show_clock, show_logo")
    .eq("tenant_id", opts.tenantId)
    .order("sort_order", { ascending: true })
    .limit(1);
  if (parsed.setId) query = query.eq("id", parsed.setId);
  const { data: sets } = await query;
  const set = sets?.[0] ?? null;
  if (!set) {
    return {
      slides: [],
      slideSeconds: opts.fallbackSeconds,
      showRoomName: true,
      showClock: true,
      showLogo: true,
    };
  }

  const { data: slides } = await supabaseAdmin
    .from("slides")
    .select("id, name, content_type, path, duration_seconds")
    .eq("tenant_id", opts.tenantId)
    .eq("slide_set_id", set.id)
    .order("sort_order", { ascending: true });

  const list = slides ?? [];
  // Signed storage URLs so displays don't load images through this worker
  // origin (a long-lived SSE connection can stall those).
  const signed = new Map<string, string>();
  if (list.length) {
    const { data: urls } = await supabaseAdmin.storage.from("tenant-ads").createSignedUrls(
      list.map((s) => s.path),
      60 * 60 * 12,
    );
    (urls ?? []).forEach((u, i) => {
      if (u.signedUrl && list[i]) signed.set(list[i].id, u.signedUrl);
    });
  }

  return {
    slideSeconds: set.slide_seconds,
    showRoomName: set.show_room_name ?? true,
    showClock: set.show_clock ?? true,
    showLogo: set.show_logo ?? true,
    slides: list.map((s) => ({
      id: s.id,
      name: s.name,
      url: signed.get(s.id) ?? `/api/public/slide/${opts.tenantKey}/${s.id}`,
      content_type: s.content_type,
      duration_seconds: s.duration_seconds ?? null,
    })),
  };
}
