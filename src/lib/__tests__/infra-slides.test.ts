import { describe, it, expect, vi, beforeEach } from "vitest";

const adminMock = {
  from: vi.fn(),
  storage: { from: vi.fn() },
};

vi.mock("@/lib/backend/admin.server", () => ({
  getBackendAdmin: vi.fn(async () => adminMock),
}));

import {
  parseSlidesTemplate,
  isSlidesTemplate,
  isSlideshowEntry,
  resolveAutoTemplate,
  loadSlidesForTemplate,
  AUTO_TEMPLATE,
} from "../slides.server";

describe("parseSlidesTemplate", () => {
  it("returns null for falsy/non-slides templates", () => {
    expect(parseSlidesTemplate(null)).toBeNull();
    expect(parseSlidesTemplate(undefined)).toBeNull();
    expect(parseSlidesTemplate("zeitplan")).toBeNull();
  });
  it("bare 'slides' means the first set", () => {
    expect(parseSlidesTemplate("slides")).toEqual({ setId: null });
  });
  it("parses a valid uuid suffix", () => {
    const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(parseSlidesTemplate(`slides:${uuid}`)).toEqual({ setId: uuid });
  });
  it("falls back to null setId for a malformed suffix", () => {
    expect(parseSlidesTemplate("slides:not-a-uuid")).toEqual({ setId: null });
    expect(parseSlidesTemplate("slides:")).toEqual({ setId: null });
  });
});

describe("isSlidesTemplate", () => {
  it("mirrors parseSlidesTemplate", () => {
    expect(isSlidesTemplate("slides")).toBe(true);
    expect(isSlidesTemplate("zeitplan")).toBe(false);
  });
});

describe("isSlideshowEntry", () => {
  it("defaults missing kind to 'entry'", () => {
    expect(isSlideshowEntry({})).toBe(false);
    expect(isSlideshowEntry({ kind: "slides" })).toBe(true);
    expect(isSlideshowEntry({ kind: null })).toBe(false);
  });
});

describe("resolveAutoTemplate", () => {
  const roomName = "Room A";
  it("passes through non-auto templates untouched", () => {
    expect(resolveAutoTemplate({ template: "zeitplan", entries: [], roomName, isOverview: false })).toEqual({
      template: "zeitplan",
      switchAt: null,
    });
  });

  it("ignores entries missing slide_set_id or end_time, or scoped to other rooms", () => {
    const now = new Date("2026-01-01T12:00:00Z").getTime();
    const entries = [
      { kind: "slides", time: "2026-01-01T11:00:00Z", end_time: null, tags: [], slide_set_id: "s1" },
      { kind: "slides", time: "2026-01-01T11:00:00Z", end_time: "2026-01-01T13:00:00Z", tags: [], slide_set_id: null },
      { kind: "entry", time: "2026-01-01T11:00:00Z", end_time: "2026-01-01T13:00:00Z", tags: [], slide_set_id: "s1" },
      {
        kind: "slides",
        time: "2026-01-01T11:00:00Z",
        end_time: "2026-01-01T13:00:00Z",
        tags: ["Other Room"],
        slide_set_id: "s1",
      },
    ];
    const out = resolveAutoTemplate({ template: AUTO_TEMPLATE, entries, roomName, isOverview: false, now });
    expect(out.template).toBe("zeitplan");
  });

  it("picks the active slide set, ignores invalid dates, and reports the next switch", () => {
    const now = new Date("2026-01-01T12:00:00Z").getTime();
    const entries = [
      {
        kind: "slides",
        time: "garbage",
        end_time: "2026-01-01T13:00:00Z",
        tags: [],
        slide_set_id: "bad-date",
      },
      {
        kind: "slides",
        time: "2026-01-01T11:00:00Z",
        end_time: "2026-01-01T13:00:00Z",
        tags: [],
        slide_set_id: "s1",
      },
      {
        // later start wins on overlap
        kind: "slides",
        time: "2026-01-01T11:30:00Z",
        end_time: "2026-01-01T13:30:00Z",
        tags: [roomName],
        slide_set_id: "s2",
      },
    ];
    const out = resolveAutoTemplate({ template: AUTO_TEMPLATE, entries, roomName, isOverview: true, now });
    expect(out.template).toBe("slides:s2");
    expect(out.switchAt).toBe("2026-01-01T13:00:00.000Z");
  });

  it("defaults now to Date.now when not provided and uses the overview short-circuit", () => {
    const out = resolveAutoTemplate({
      template: AUTO_TEMPLATE,
      entries: [],
      roomName,
      isOverview: false,
    });
    expect(out.template).toBe("zeitplan");
    expect(out.switchAt).toBeNull();
  });
});

describe("loadSlidesForTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function chain(result: unknown) {
    const q: any = {
      select: vi.fn(() => q),
      eq: vi.fn(() => q),
      order: vi.fn(() => q),
      limit: vi.fn(() => q),
      then: (resolve: any) => Promise.resolve(result).then(resolve),
    };
    return q;
  }

  it("returns defaults when the template is not a slides template", async () => {
    const out = await loadSlidesForTemplate({
      tenantId: "t1",
      tenantKey: "key1",
      template: "zeitplan",
      fallbackSeconds: 5,
    });
    expect(out).toEqual({
      slides: [],
      slideSeconds: 5,
      showRoomName: true,
      showClock: true,
      showLogo: true,
    });
  });

  it("returns defaults when no slide set is found", async () => {
    adminMock.from.mockReturnValueOnce(chain({ data: [] }));
    const out = await loadSlidesForTemplate({
      tenantId: "t1",
      tenantKey: "key1",
      template: "slides",
      fallbackSeconds: 7,
    });
    expect(out.slides).toEqual([]);
    expect(out.slideSeconds).toBe(7);
  });

  it("filters by a specific set id, signs image urls and falls back for unsigned/non-image slides", async () => {
    const setsQuery = chain({ data: [{ id: "set1", slide_seconds: 9, show_room_name: false, show_clock: null, show_logo: null }] });
    const slidesQuery = chain({
      data: [
        { id: "sl1", name: "One", content_type: "image/png", path: "p1", duration_seconds: 3, kind: "image" },
        { id: "sl2", name: "Two", content_type: "image/png", path: "p2", duration_seconds: null, kind: "image" },
        { id: "sl3", name: "Three", content_type: "text/plain", path: "p3", duration_seconds: null, kind: "entries" },
      ],
    });
    adminMock.from.mockReturnValueOnce(setsQuery).mockReturnValueOnce(slidesQuery);
    adminMock.storage.from.mockReturnValue({
      createSignedUrls: vi.fn(async () => ({
        data: [
          { signedUrl: "https://signed/one" },
          { signedUrl: null },
        ],
      })),
    });

    const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const out = await loadSlidesForTemplate({
      tenantId: "t1",
      tenantKey: "key1",
      template: `slides:${uuid}`,
      fallbackSeconds: 7,
    });
    expect(setsQuery.eq).toHaveBeenCalledWith("id", uuid);
    expect(out.slideSeconds).toBe(9);
    expect(out.showRoomName).toBe(false);
    expect(out.showClock).toBe(true);
    expect(out.showLogo).toBe(true);
    expect(out.slides).toEqual([
      { kind: "image", id: "sl1", name: "One", url: "https://signed/one", content_type: "image/png", duration_seconds: 3 },
      { kind: "image", id: "sl2", name: "Two", url: "/api/public/slide/key1/sl2", content_type: "image/png", duration_seconds: null },
      { kind: "entries", id: "sl3", name: "Three", url: "/api/public/slide/key1/sl3", content_type: "text/plain", duration_seconds: null },
    ]);
  });

  it("skips signing when there are no image slides", async () => {
    const setsQuery = chain({ data: [{ id: "set1", slide_seconds: 9, show_room_name: true, show_clock: true, show_logo: true }] });
    const slidesQuery = chain({ data: [{ id: "sl1", name: "T", content_type: "text", path: "p", duration_seconds: null, kind: "teams" }] });
    adminMock.from.mockReturnValueOnce(setsQuery).mockReturnValueOnce(slidesQuery);
    const out = await loadSlidesForTemplate({ tenantId: "t1", tenantKey: "key1", template: "slides", fallbackSeconds: 7 });
    expect(adminMock.storage.from).not.toHaveBeenCalled();
    expect(out.slides[0].url).toBe("/api/public/slide/key1/sl1");
  });

  it("handles a null slides result", async () => {
    const setsQuery = chain({ data: [{ id: "set1", slide_seconds: 9, show_room_name: true, show_clock: true, show_logo: true }] });
    const slidesQuery = chain({ data: null });
    adminMock.from.mockReturnValueOnce(setsQuery).mockReturnValueOnce(slidesQuery);
    const out = await loadSlidesForTemplate({ tenantId: "t1", tenantKey: "key1", template: "slides", fallbackSeconds: 7 });
    expect(out.slides).toEqual([]);
  });
});
