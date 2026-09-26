import { getBackendAdmin } from "@/lib/backend/admin.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SnapshotSlide = {
  id: string;
  name: string;
  url: string;
  content_type: string;
  duration_seconds: number | null;
  kind: "image" | "entries" | "teams";
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

/** Template value that follows the schedule: slideshow entries switch the display. */
export const AUTO_TEMPLATE = "auto";

export type SlideshowEntryRow = {
  kind?: string | null;
  time: string;
  end_time: string | null;
  tags: string[];
  slide_set_id?: string | null;
};

export function isSlideshowEntry(e: { kind?: string | null }): boolean {
  return (e.kind ?? "entry") === "slides";
}

/**
 * Resolves the "auto" template against the slideshow entries of a room.
 * Returns the template to render plus the next moment the result changes,
 * so displays can refetch exactly then.
 */
export function resolveAutoTemplate(opts: {
  template: string | null | undefined;
  entries: SlideshowEntryRow[];
  roomName: string;
  isOverview: boolean;
  now?: number;
}): { template: string | null | undefined; switchAt: string | null } {
  if (opts.template !== AUTO_TEMPLATE) return { template: opts.template, switchAt: null };
  const now = opts.now ?? Date.now();
  const relevant = opts.entries.filter(
    (e) =>
      isSlideshowEntry(e) &&
      e.slide_set_id &&
      e.end_time &&
      (opts.isOverview || e.tags.length === 0 || e.tags.includes(opts.roomName)),
  );
  let active: SlideshowEntryRow | null = null;
  let nextSwitch = Infinity;
  for (const e of relevant) {
    const start = new Date(e.time).getTime();
    const end = new Date(e.end_time!).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start <= now && now < end) {
      // Later start wins on overlap.
      if (!active || start > new Date(active.time).getTime()) active = e;
    }
    for (const boundary of [start, end]) {
      if (boundary > now && boundary < nextSwitch) nextSwitch = boundary;
    }
  }
  return {
    template: active ? `slides:${active.slide_set_id}` : "zeitplan",
    switchAt: Number.isFinite(nextSwitch) ? new Date(nextSwitch).toISOString() : null,
  };
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
    .select("id, name, content_type, path, duration_seconds, kind")
    .eq("tenant_id", opts.tenantId)
    .eq("slide_set_id", set.id)
    .order("sort_order", { ascending: true });

  const all = slides ?? [];
  const list = all.filter((s) => (s.kind ?? "image") === "image");
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
    slides: all.map((s) => ({
      kind: (s.kind ?? "image") as "image" | "entries" | "teams",
      id: s.id,
      name: s.name,
      url: signed.get(s.id) ?? `/api/public/slide/${opts.tenantKey}/${s.id}`,
      content_type: s.content_type,
      duration_seconds: s.duration_seconds ?? null,
    })),
  };
}
