import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GripVertical, CheckCircle2, Clock, History, BellOff, Lock, LogOut, X, Upload, Download, Trash2, ChevronDown, Users, QrCode, Images, CalendarClock } from "lucide-react";
import {
  listEntries,
  upsertEntry,
  deleteEntry,
  listRooms,
  upsertRoom,
  deleteRoom,
  getTenant,
  updateTenantSettings,
  uploadTenantLogo,
  removeTenantLogo,
  deleteTenant,
  listColorSchemes,
  upsertColorScheme,
  deleteColorScheme,
  listSlides,
  addEntriesSlide,
  uploadSlide,
  deleteSlide,
  updateSlide,
  moveSlide,
  reorderSlides,
  listTeams,
  upsertTeam,
  deleteTeam,
  reorderTeams,
  listSlideSets,
  upsertSlideSet,
  deleteSlideSet,
  updateTenantTemplate,
  uploadEntryBackground,
  removeEntryBackground,
  ENTRY_BG_ALIGNMENTS,
  ENTRY_BG_TINTS,
  supportsTint,
  type EntryBgAlign,
} from "@/lib/board.functions";

import {
  getTenantAccess,
  unlockTenantAccess,
  lockTenantAccess,
  setTenantPin,
} from "@/lib/tenant-auth.functions";
import { ImportExportPanel } from "@/components/admin/ImportExportPanel";
import { WebhooksPanel, WebhookConfigPanel } from "@/components/admin/WebhooksPanel";
import { slugify } from "@/lib/ref-id";
import { isTenantLockedError, onTenantLocked, notifyTenantLocked } from "@/lib/tenant-lock";

import defaultLogo from "@/assets/pit-hackathon-logo.png.asset.json";
import { clearStoredTenantKey } from "@/lib/tenant-storage";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { TeamsPanel } from "@/components/admin/TeamsPanel";
import { TenantFilesPanel } from "@/components/admin/TenantFilesPanel";
import { AllTeamFilesPanel } from "@/components/admin/AllTeamFilesPanel";

import { FILE_MODES, normalizeFileMode, type FileMode } from "@/lib/files";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";
import { derivePalette, DEFAULT_ACCENT } from "@/lib/colors";
import { EntriesJsonPanel } from "@/components/admin/EntriesJsonPanel";

const TABS = [
  "entries",
  "slides",
  "messages",
  "rooms",
  "teams",
  "files",
  "colors",
  "settings",
  "io",
] as const;
const ENTRY_HASHES = ["entries", "entries-all"] as const;

export const Route = createFileRoute("/tenant/$tenantKey/")({
  component: AdminPage,
});

type EntryKindValue = "entry" | "practice" | "register" | "slides";

type EntryRow = {
  id: string;
  kind?: string | null;
  time: string;
  end_time?: string | null;
  title: string;
  description: string;
  tags: string[];
  color_scheme_id: string | null;
  slide_set_id?: string | null;
  notify: boolean;
  sent?: boolean;
  background_url?: string | null;
  background_align?: EntryBgAlign | null;
  background_height?: number | null;
  background_opacity?: number | null;
  background_margin?: number | null;
  background_tint?: (typeof ENTRY_BG_TINTS)[number] | null;
  background_content_type?: string | null;
  register_token?: string | null;
};

type RoomRow = {
  id: string;
  ref_id?: string | null;
  name: string;
  color_scheme_id?: string | null;
  template?: string | null;
};
type SchemeRow = { id: string; ref_id?: string | null; name: string; color: string };

/** Editable reference id used by the import/export format. Empty = derived from the name. */
export function RefIdField({
  value,
  onChange,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  name: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <Label>{t("refId.label")}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={slugify(name) || t("refId.placeholder")}
      />
      <p className="text-xs text-muted-foreground">{t("refId.hint")}</p>
    </div>
  );
}

/** Template options: the schedule plus one entry per slide set. */
export function useTemplateOptions(tenantKey: string) {
  const { t } = useI18n();
  const listSetsFn = useServerFn(listSlideSets);
  const setsQ = useQuery({
    queryKey: ["slideSets", tenantKey],
    queryFn: () => listSetsFn({ data: { key: tenantKey } }),
  });
  const sets = setsQ.data ?? [];
  return [
    { value: "auto", label: t("settings.template.auto") },
    { value: "zeitplan", label: t("settings.template.zeitplan") },
    ...sets.map((s) => ({ value: `slides:${s.id}`, label: `${t("settings.template.slides")}: ${s.name}` })),
  ];
}

/** Global display template selector — applies immediately. */
function TemplateSwitcher({
  tenantKey,
  template,
  onChange,
}: {
  tenantKey: string;
  template: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const updateFn = useServerFn(updateTenantTemplate);
  const options = useTemplateOptions(tenantKey);
  const [value, setValue] = useState(template);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(template), [template]);

  const known = options.some((o) => o.value === value);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {t("settings.template")}
      </span>
      <select
        value={value}
        disabled={saving}
        onChange={async (e) => {
          const next = e.target.value;
          setValue(next);
          setSaving(true);
          try {
            await updateFn({ data: { key: tenantKey, template: next } });
            toast.success(t("settings.saved"));
            onChange();
          } catch (err) {
            setValue(template);
            toast.error((err as Error).message);
          } finally {
            setSaving(false);
          }
        }}
        className="rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        {!known && <option value={value}>{t("settings.template.slides")}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}



function AdminPage() {
  const { tenantKey } = Route.useParams();
  const qc = useQueryClient();
  const { t } = useI18n();

  const getTenantFn = useServerFn(getTenant);
  const listEntriesFn = useServerFn(listEntries);
  const listRoomsFn = useServerFn(listRooms);
  const listSchemesFn = useServerFn(listColorSchemes);

  // Keep the admin view in sync with changes made elsewhere (other admins,
  // webhook dispatch, ...). Open dialogs keep their own local state, so a
  // background refetch never overwrites what is being edited.
  const live = {
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    // Don't burn retries on a locked session — surface it to the gate at once.
    retry: (count: number, error: unknown) => !isTenantLockedError(error) && count < 2,
  } as const;

  const getAccessFn = useServerFn(getTenantAccess);
  const accessQ = useQuery({
    queryKey: ["access", tenantKey],
    queryFn: () => getAccessFn({ data: { key: tenantKey } }),
    refetchInterval: 60_000,
  });
  // Any admin server fn throwing TENANT_LOCKED (expired 4h session) drops us
  // back to the PIN gate right away, without waiting for the access poll.
  const [forceLocked, setForceLocked] = useState(false);
  useEffect(
    () =>
      onTenantLocked(() => {
        setForceLocked(true);
        qc.invalidateQueries({ queryKey: ["access", tenantKey] });
      }),
    [qc, tenantKey],
  );

  const allowed =
    !forceLocked && (accessQ.data ? !accessQ.data.protected || accessQ.data.unlocked : false);

  const tenantQ = useQuery({
    queryKey: ["tenant", tenantKey],
    queryFn: () => getTenantFn({ data: { key: tenantKey } }),
    enabled: allowed,
    ...live,
  });
  const entriesQ = useQuery({
    queryKey: ["entries", tenantKey],
    queryFn: () => listEntriesFn({ data: { key: tenantKey } }),
    enabled: allowed && !!tenantQ.data,
    ...live,
  });
  const roomsQ = useQuery({
    queryKey: ["rooms", tenantKey],
    queryFn: () => listRoomsFn({ data: { key: tenantKey } }),
    enabled: allowed && !!tenantQ.data,
    ...live,
  });
  const schemesQ = useQuery({
    queryKey: ["schemes", tenantKey],
    queryFn: () => listSchemesFn({ data: { key: tenantKey } }),
    enabled: allowed && !!tenantQ.data,
    ...live,
  });


  const [tab, setTab] = useState<string>(TABS[0]);
  const [entriesShowAll, setEntriesShowAll] = useState(false);
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace(/^#/, "");
      if ((TABS as readonly string[]).includes(h)) {
        setTab(h);
        setEntriesShowAll(false);
      } else if ((ENTRY_HASHES as readonly string[]).includes(h)) {
        setTab("entries");
        setEntriesShowAll(h === "entries-all");
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const changeTab = (v: string) => {
    setTab(v);
    setEntriesShowAll(false);
    window.history.replaceState(null, "", `#${v}`);
  };

  if (accessQ.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">{t("admin.loading")}</div>;
  }
  if (accessQ.error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="p-6 max-w-md space-y-3 text-center">
          <h2 className="text-lg font-semibold">{t("admin.unknown")}</h2>
          <p className="text-sm text-muted-foreground">{t("admin.unknownBlurb")}</p>
          <Link to="/" className="text-sm underline">
            {t("admin.backStart")}
          </Link>
        </Card>
      </div>
    );
  }
  if (!allowed) {
    return (
      <PinGate
        tenantKey={tenantKey}
        onUnlocked={() => {
          setForceLocked(false);
          // Trust the successful unlock immediately: a cached/stale GET of the
          // access check must not bounce the user back to the PIN screen.
          qc.setQueryData(["access", tenantKey], { protected: true, unlocked: true });
          qc.invalidateQueries({ queryKey: ["access", tenantKey] });
        }}
      />
    );
  }
  if (tenantQ.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">{t("admin.loading")}</div>;
  }
  if (tenantQ.error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="p-6 max-w-md space-y-3 text-center">
          <h2 className="text-lg font-semibold">{t("admin.unknown")}</h2>
          <p className="text-sm text-muted-foreground">{t("admin.unknownBlurb")}</p>
          <Link to="/" className="text-sm underline">
            {t("admin.backStart")}
          </Link>
        </Card>
      </div>
    );
  }

  const tenant = tenantQ.data!;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["entries", tenantKey] });
    qc.invalidateQueries({ queryKey: ["rooms", tenantKey] });
    qc.invalidateQueries({ queryKey: ["tenant", tenantKey] });
    qc.invalidateQueries({ queryKey: ["schemes", tenantKey] });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("admin.label")}
            </div>
            <h1 className="text-xl font-semibold">{tenant.name}</h1>
          </div>
          <div className="flex-1 flex justify-center">
            <TemplateSwitcher
              tenantKey={tenantKey}
              template={tenant.template}
              onChange={invalidate}
            />
          </div>
          <div className="flex gap-2 items-center">

            <LanguageSwitcher />
            <Link to="/tenant/$tenantKey/rooms" params={{ tenantKey }}>
              <Button variant="outline" size="sm">
                {t("nav.rooms")}
              </Button>
            </Link>
            <LockOnlyButton tenantKey={tenantKey} />
            <LockButton tenantKey={tenantKey} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList>
            {TABS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(`admin.tabs.${v}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="entries" className="space-y-4 pt-4">
            <EntriesPanel
              tenantKey={tenantKey}
              entries={entriesQ.data ?? []}
              rooms={roomsQ.data ?? []}
              schemes={schemesQ.data ?? []}
              defaultColor={tenant.accent_color}
              graceMinutes={tenant.past_grace_minutes}
              practiceMinutes={tenant.practice_minutes ?? 10}
              showExpired={entriesShowAll}
              onChange={invalidate}
            />
          </TabsContent>

          <TabsContent value="rooms" className="space-y-4 pt-4">
            <RoomsPanel
              tenantKey={tenantKey}
              rooms={roomsQ.data ?? []}
              schemes={schemesQ.data ?? []}
              defaultColor={tenant.accent_color}
              onChange={invalidate}
            />
          </TabsContent>

          <TabsContent value="teams" className="space-y-4 pt-4">
            <TeamsPanel
              tenantKey={tenantKey}
              tenantName={tenant.name}
              rooms={roomsQ.data ?? []}
              schemes={schemesQ.data ?? []}
              defaultColor={tenant.accent_color}
              filesMode={normalizeFileMode(tenant.files_mode)}
              maxUploadMb={tenant.max_upload_mb ?? 10}
              onChange={invalidate}
            />
          </TabsContent>

          <TabsContent value="files" className="space-y-8 pt-4">
            <TenantFilesPanel
              tenantKey={tenantKey}
              maxUploadMb={tenant.max_upload_mb ?? 10}
              disabled={normalizeFileMode(tenant.files_mode) === "off"}
            />
            <AllTeamFilesPanel tenantKey={tenantKey} />
          </TabsContent>


          <TabsContent value="colors" className="space-y-4 pt-4">
            <ColorSchemesPanel
              tenantKey={tenantKey}
              schemes={schemesQ.data ?? []}
              defaultColor={tenant.accent_color}
              onChange={invalidate}
            />
          </TabsContent>

          <TabsContent value="slides" className="space-y-4 pt-4">
            <SlidesPanel tenantKey={tenantKey} onChange={invalidate} />
          </TabsContent>

          <TabsContent value="messages" className="space-y-4 pt-4">
            <WebhooksPanel
              tenantKey={tenantKey}
              schemes={schemesQ.data ?? []}
              defaultColor={tenant.accent_color}
              onChange={invalidate}
            />
          </TabsContent>


          <TabsContent value="settings" className="space-y-4 pt-4">
            <SettingsPanel
              tenantKey={tenantKey}
              name={tenant.name}
              logoUrl={tenant.logo_url}
              logoHeight={tenant.logo_height}
              accentColor={tenant.accent_color}
              graceMinutes={tenant.past_grace_minutes}
              template={tenant.template}
              slideSeconds={tenant.slide_seconds}
              focusMode={tenant.focus_mode}
              focusCount={tenant.focus_count}
              focusMinutes={tenant.focus_minutes}
              focusDimOpacity={tenant.focus_dim_opacity}
              practiceMinutes={tenant.practice_minutes ?? 10}
              practiceRoomScope={tenant.practice_room_scope ?? "all"}
              teamEditLocked={tenant.team_edit_locked === true}
              filesMode={normalizeFileMode(tenant.files_mode)}
              maxUploadMb={tenant.max_upload_mb ?? 10}
              teamQuotaMb={tenant.team_quota_mb ?? 0}
              onChange={invalidate}
            />
          </TabsContent>

          <TabsContent value="io" className="space-y-4 pt-4">
            <ImportExportPanel tenantKey={tenantKey} onChange={invalidate} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function PinGate({ tenantKey, onUnlocked }: { tenantKey: string; onUnlocked: () => void }) {
  const { t } = useI18n();
  const unlockFn = useServerFn(unlockTenantAccess);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{t("pin.gate.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t("pin.gate.blurb")}</p>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(false);
            setFailure(null);
            try {
              const res = await unlockFn({ data: { key: tenantKey, pin } });
              if (res?.ok) onUnlocked();
              else setError(true);
            } catch (err) {
              // Any transport/server failure must be visible, not silently swallowed.
              console.error("[pin] unlock failed", err);
              setFailure(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1">
            <Label>{t("pin.gate.label")}</Label>
            <Input
              type="password"
              value={pin}
              autoFocus
              autoComplete="current-password"
              onChange={(e) => setPin(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{t("pin.gate.error")}</p>}
          {failure && <p className="text-sm text-destructive break-words">{failure}</p>}
          <Button type="submit" className="w-full" disabled={busy || !pin}>
            {t("pin.gate.submit")}
          </Button>
        </form>
        <div className="text-center">
          <Link to="/" className="text-xs underline text-muted-foreground">
            {t("admin.backStart")}
          </Link>
        </div>
      </Card>
    </div>
  );
}

function LockOnlyButton({ tenantKey }: { tenantKey: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const lockFn = useServerFn(lockTenantAccess);
  return (
    <Button
      variant="outline"
      size="icon"
      title={t("nav.lockOnly")}
      aria-label={t("nav.lockOnly")}
      onClick={async () => {
        try {
          await lockFn({ data: { key: tenantKey } });
        } catch {
          /* ignore */
        }
        notifyTenantLocked();
        qc.invalidateQueries({ queryKey: ["access", tenantKey] });
      }}
    >
      <Lock className="h-4 w-4" />
    </Button>
  );
}

function LockButton({ tenantKey }: { tenantKey: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const lockFn = useServerFn(lockTenantAccess);
  return (
    <Button
      variant="outline"
      size="icon"
      title={t("nav.lock")}
      aria-label={t("nav.lock")}
      onClick={async () => {
        try {
          await lockFn({ data: { key: tenantKey } });
        } catch {
          /* ignore */
        }
        navigate({ to: "/" });
      }}
    >
      <LogOut className="h-4 w-4" />
    </Button>
  );
}

function PinCard({ tenantKey }: { tenantKey: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const getAccessFn = useServerFn(getTenantAccess);
  const setPinFn = useServerFn(setTenantPin);
  const accessQ = useQuery({
    queryKey: ["access", tenantKey],
    queryFn: () => getAccessFn({ data: { key: tenantKey } }),
  });
  const isProtected = !!accessQ.data?.protected;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-3">
      <div className="font-medium">{t("pin.card.title")}</div>
      <p className="text-xs text-muted-foreground">
        {isProtected ? t("pin.card.active") : t("pin.card.inactive")}
      </p>
      {isProtected && (
        <div className="space-y-1">
          <Label>{t("pin.card.current")}</Label>
          <Input
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
      )}
      <div className="space-y-1">
        <Label>{t("pin.card.new")}</Label>
        <Input
          type="password"
          value={next}
          autoComplete="new-password"
          onChange={(e) => setNext(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label>{t("pin.card.repeat")}</Label>
        <Input
          type="password"
          value={repeat}
          autoComplete="new-password"
          onChange={(e) => setRepeat(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("pin.card.hint")}</p>
      <Button
        size="sm"
        disabled={saving}
        onClick={async () => {
          if (next !== repeat) {
            toast.error(t("pin.card.mismatch"));
            return;
          }
          setSaving(true);
          try {
            await setPinFn({
              data: { key: tenantKey, currentPin: current || undefined, newPin: next },
            });
            setCurrent("");
            setNext("");
            setRepeat("");
            toast.success(t("pin.card.saved"));
            qc.invalidateQueries({ queryKey: ["access", tenantKey] });
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        {t("pin.card.save")}
      </Button>
    </div>
  );
}

// --------------- Entries ---------------

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EntriesPanel({
  tenantKey,
  entries,
  rooms,
  schemes,
  defaultColor,
  graceMinutes,
  practiceMinutes,
  showExpired,
  onChange,
}: {
  tenantKey: string;
  entries: EntryRow[];
  rooms: RoomRow[];
  schemes: SchemeRow[];
  defaultColor: string;
  graceMinutes: number;
  practiceMinutes: number;
  showExpired: boolean;
  onChange: () => void;
}) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [newKind, setNewKind] = useState<EntryKindValue>("entry");
  const teamsQ = useQuery({
    queryKey: ["teams", tenantKey],
    queryFn: () => listTeams({ data: { key: tenantKey } }),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const listSetsFn = useServerFn(listSlideSets);
  const slideSetsQ = useQuery({
    queryKey: ["slideSets", tenantKey],
    queryFn: () => listSetsFn({ data: { key: tenantKey } }),
  });
  const slideSets = slideSetsQ.data ?? [];

  const teamCount = teamsQ.data?.length ?? 0;
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<"form" | "json" | "preview">("form");
  const collapseKey = `entries-collapsed:${tenantKey}`;
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(collapseKey) ?? "[]");
      if (Array.isArray(v)) setCollapsed(v.filter((x) => x !== new Date().toDateString()));
    } catch {
      /* ignore */
    }
  }, [collapseKey]);
  const toggleDay = (day: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
      window.localStorage.setItem(collapseKey, JSON.stringify(next));
      return next;
    });
  const upsertFn = useServerFn(upsertEntry);
  const deleteFn = useServerFn(deleteEntry);

  // Remember the editing mode across tab switches / reloads.
  useEffect(() => {
    const saved = window.localStorage.getItem("entries-mode");
    if (saved === "json" || saved === "form" || saved === "preview") setMode(saved);
  }, []);
  const changeMode = (m: "form" | "json" | "preview") => {
    setMode(m);
    window.localStorage.setItem("entries-mode", m);
  };

  // Re-evaluate the expiry window every second so entries disappear on their own.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const now = nowTick;
  const graceMs = (graceMinutes || 0) * 60 * 1000;
  const activeEntries = entries.filter((e) => {
    if (e.end_time) return new Date(e.end_time).getTime() >= now;
    return new Date(e.time).getTime() + graceMs >= now;
  });
  const visibleEntries = showExpired ? entries : activeEntries;
  const expiredCount = entries.length - activeEntries.length;


  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { key: tenantKey, id } }),
    onSuccess: () => {
      toast.success(t("entries.deleted"));
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-2 bg-background/95 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex justify-between items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-lg font-medium">{t("entries.title")}</h2>
          {mode !== "json" && showExpired && expiredCount > 0 ? (
            <a
              href="#entries"
              className="text-sm text-primary underline hover:text-primary/80"
            >
              {t("entries.hideExpired")}
            </a>

          ) : mode !== "json" && expiredCount > 0 ? (
            <a
              href="#entries-all"
              className="text-sm text-primary underline hover:text-primary/80"
            >
              {expiredCount === 1
                ? t("entries.showExpiredCountOne")
                : t("entries.showExpiredCount", { count: expiredCount })}
            </a>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            <Button
              size="sm"
              variant={mode === "form" ? "secondary" : "ghost"}
              onClick={() => changeMode("form")}
            >
              {t("entries.mode.form")}
            </Button>
            <Button
              size="sm"
              variant={mode === "json" ? "secondary" : "ghost"}
              onClick={() => changeMode("json")}
            >
              {t("entries.mode.json")}
            </Button>
            <Button
              size="sm"
              variant={mode === "preview" ? "secondary" : "ghost"}
              onClick={() => changeMode("preview")}
            >
              {t("entries.mode.preview")}
            </Button>
          </div>
          {mode !== "json" ? (
            <div className="flex">
              <Button
                size="sm"
                className="rounded-r-none"
                onClick={() => {
                  setEditing(null);
                  setNewKind("entry");
                  setShowForm(true);
                }}
              >
                {t("entries.new")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    className="rounded-l-none border-l border-primary-foreground/25 px-2"
                    aria-label={t("entries.newPractice")}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(null);
                      setNewKind("practice");
                      setShowForm(true);
                    }}
                  >
                    <Users className="mr-2 h-4 w-4" />
                    {t("entries.newPractice")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(null);
                      setNewKind("register");
                      setShowForm(true);
                    }}
                  >
                    <QrCode className="mr-2 h-4 w-4" />
                    {t("entries.newRegister")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(null);
                      setNewKind("slides");
                      setShowForm(true);
                    }}
                  >
                    <Images className="mr-2 h-4 w-4" />
                    {t("entries.newSlides")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </div>

      {mode === "json" ? <EntriesJsonPanel tenantKey={tenantKey} onChange={onChange} /> : null}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-3 sm:max-w-3xl sm:p-3">
          <DialogHeader>
            <DialogTitle>
              {(editing?.kind ?? newKind) === "slides"
                ? t("entries.newSlides")
                : (editing?.kind ?? newKind) === "register"
                ? t("entries.newRegister")
                : (editing?.kind ?? newKind) === "practice"
                ? editing
                  ? t("entries.editPractice")
                  : t("entries.newPractice")
                : editing
                  ? t("entries.edit")
                  : t("entries.new")}
            </DialogTitle>
          </DialogHeader>
          {showForm ? (
            <EntryForm
              initial={editing}
              tenantKey={tenantKey}
              kind={newKind}
              teamCount={teamCount}
              slideSets={slideSets}
              practiceMinutes={practiceMinutes}

              rooms={rooms}
              schemes={schemes}
              defaultColor={defaultColor}
              onCancel={() => setShowForm(false)}
              onSubmit={async (entry) => {
                const res = await upsertFn({ data: { key: tenantKey, entry } });
                return res.id;
              }}
              onSaved={() => {
                toast.success(editing ? t("entries.updated") : t("entries.created"));
                setShowForm(false);
                onChange();
              }}

            />
          ) : null}
        </DialogContent>
      </Dialog>


      {mode !== "json" ? (
      <div className="space-y-2">
        {visibleEntries.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">
            {entries.length === 0 ? t("entries.empty") : t("entries.noneVisible")}
          </Card>
        ) : (
          visibleEntries.map((e, idx) => {
            const dayKey = new Date(e.time).toDateString();
            const prevDayKey =
              idx > 0 ? new Date(visibleEntries[idx - 1].time).toDateString() : null;
            const showDay = dayKey !== prevDayKey;
            const isCollapsed = collapsed.includes(dayKey);
            const preview = mode === "preview";
            const dayCount = showDay
              ? visibleEntries.filter((x) => new Date(x.time).toDateString() === dayKey).length
              : 0;
            if (!showDay && isCollapsed) return null;
            return (
            <div key={e.id} className="space-y-2">
            {showDay ? (
              <button
                type="button"
                onClick={() => toggleDay(dayKey)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-3 pt-2 text-left first:pt-0"
              >
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {new Date(e.time).toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </span>
                <span className="text-xs text-muted-foreground">({dayCount})</span>
                <span className="h-px flex-1 bg-border" />
              </button>
            ) : null}
            {isCollapsed ? null : preview ? (
              e.kind === "practice" ? (
                <PracticePreview
                  entry={e}
                  teams={teamsQ.data ?? []}
                  rooms={rooms}
                  schemes={schemes}
                  defaultColor={defaultColor}
                  practiceMinutes={practiceMinutes}
                  now={now}
                  graceMs={graceMs}
                  tenantKey={tenantKey}
                  onOpen={() => {
                    setEditing(e);
                    setShowForm(true);
                  }}
                />
              ) : (
                <PreviewEntry
                  entry={e}
                  now={now}
                  graceMs={graceMs}
                  tenantKey={tenantKey}
                  color={schemes.find((s) => s.id === e.color_scheme_id)?.color ?? defaultColor}
                  slideSetName={slideSets.find((s) => s.id === e.slide_set_id)?.name ?? null}
                  onOpen={() => {
                    setEditing(e);
                    setShowForm(true);
                  }}
                />
              )
            ) : (
            <Card className={`flex items-start justify-between gap-4 ${preview ? "p-3 text-sm" : "p-4"}`}>
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <span
                  className={`mt-1 h-4 w-4 rounded-full border ${
                    new Date(e.time).getTime() <= now &&
                    (e.end_time
                      ? new Date(e.end_time).getTime() >= now
                      : new Date(e.time).getTime() + graceMs >= now)
                      ? "animate-pulse"
                      : ""
                  }`}
                  style={{
                    backgroundColor:
                      schemes.find((s) => s.id === e.color_scheme_id)?.color ?? defaultColor,
                  }}
                  title={
                    schemes.find((s) => s.id === e.color_scheme_id)?.name ?? t("colors.default")
                  }
                />
                {(() => {
                  const isPast = new Date(e.time).getTime() < now;
                  if (e.sent) {
                    return (
                      <span title={t("entries.sent")}>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      </span>
                    );
                  }
                  if (!e.notify) {
                    return (
                      <span title={t("entries.notifyOff")}>
                        <BellOff className="h-4 w-4 text-muted-foreground" />
                      </span>
                    );
                  }
                  if (isPast) {
                    return (
                      <span title={t("entries.pastUnposted")}>
                        <History className="h-4 w-4 text-muted-foreground" />
                      </span>
                    );
                  }
                  return (
                    <span title={t("entries.pending")}>
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    </span>
                  );
                })()}
              </div>

              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold">
                    {new Date(e.time).toLocaleString([], {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    {e.end_time
                      ? ` – ${new Date(e.end_time).toLocaleString([], { timeStyle: "short" })}`
                      : ""}
                  </span>
                  {e.tags.length === 0 ? (
                    <span className="text-xs italic text-muted-foreground">
                      {t("entries.allRooms")}
                    </span>
                  ) : (
                    e.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-2 font-medium">
                  {e.kind === "practice" ? (
                    <Badge variant="outline" className="gap-1">
                      <Users className="h-3 w-3" />
                      {t("entries.newPractice")}
                    </Badge>
                  ) : null}
                  {e.kind === "register" ? (
                    <Badge variant="outline" className="gap-1">
                      <QrCode className="h-3 w-3" />
                      {t("entries.kind.register")}
                    </Badge>
                  ) : null}
                  {e.kind === "slides" ? (
                    <Badge variant="outline" className="gap-1">
                      <Images className="h-3 w-3" />
                      {slideSets.find((s) => s.id === e.slide_set_id)?.name ??
                        t("entries.kind.slides")}
                    </Badge>
                  ) : null}
                  {e.kind === "slides" ? null : <span>{e.title}</span>}
                </div>
                {preview && e.kind === "slides" ? (
                  <SlideStrip tenantKey={tenantKey} setId={e.slide_set_id ?? null} />
                ) : null}
                {e.description ? (
                  <div className={`${preview ? "text-xs" : "text-sm"} text-muted-foreground whitespace-pre-wrap break-words`}>
                    {e.description}
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(e);
                    setShowForm(true);
                  }}
                >
                  {t("entries.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(t("entries.confirmDelete"))) delMut.mutate(e.id);
                  }}
                >
                  {t("entries.delete")}
                </Button>
              </div>
            </Card>
            )}
            </div>
            );
          })
        )}
      </div>
      ) : null}
    </div>
  );
}

function PracticePreview({
  entry,
  teams,
  rooms,
  schemes,
  defaultColor,
  practiceMinutes,
  now,
  graceMs,
  tenantKey,
  onOpen,
}: {
  entry: EntryRow;
  teams: Array<{ id: string; name: string; room_id: string | null }>;
  rooms: RoomRow[];
  schemes: SchemeRow[];
  defaultColor: string;
  practiceMinutes: number;
  now: number;
  graceMs: number;
  tenantKey: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const start = new Date(entry.time).getTime();
  const minutes = Math.max(1, practiceMinutes || 10);
  if (teams.length === 0) {
    const placeholderEntry: EntryRow = {
      ...entry,
      kind: "entry",
      end_time: null,
      title: entry.title,
      description: t("entries.preview.noPracticeTeams"),
    };
    return (
      <PreviewEntry
        entry={placeholderEntry}
        now={now}
        graceMs={graceMs}
        tenantKey={tenantKey}
        color={defaultColor}
        slideSetName={null}
        onOpen={onOpen}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {teams.map((team, index) => {
        const room = rooms.find((candidate) => candidate.id === team.room_id);
        const color = schemes.find((scheme) => scheme.id === room?.color_scheme_id)?.color ?? defaultColor;
        const teamEntry: EntryRow = {
          ...entry,
          id: `${entry.id}:${team.id}`,
          kind: "entry",
          time: new Date(start + index * minutes * 60_000).toISOString(),
          end_time: new Date(start + (index + 1) * minutes * 60_000).toISOString(),
          title: team.name,
          description: entry.title,
        };
        return (
          <div key={team.id}>
            <PreviewEntry
              entry={teamEntry}
              now={now}
              graceMs={graceMs}
              tenantKey={tenantKey}
              color={color}
              slideSetName={null}
              onOpen={onOpen}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Read-only miniature of an entry as it appears on the room screens. */
function PreviewEntry({
  entry: e,
  now,
  graceMs,
  tenantKey,
  color,
  slideSetName,
  onOpen,
}: {
  entry: EntryRow;
  now: number;
  graceMs: number;
  tenantKey: string;
  color: string;
  slideSetName: string | null;
  onOpen: () => void;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const registerUrl =
    e.kind === "register" && e.register_token && origin ? `${origin}/tr/${e.register_token}` : null;
  const { t } = useI18n();
  const p = derivePalette(color || DEFAULT_ACCENT);
  const start = new Date(e.time).getTime();
  const end = e.end_time ? new Date(e.end_time).getTime() : null;
  const running = start <= now && (end != null ? end > now : start + graceMs >= now);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const bg = e.background_url ?? null;
  const align = e.background_align ?? "right-top";
  const m = e.background_margin ?? 0;
  const scale = 0.5;
  const tint = e.background_tint ? p[e.background_tint] : null;
  const bgBox: CSSProperties =
    align === "fill"
      ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
      : align === "right-stretch"
        ? { position: "absolute", top: m * scale, bottom: m * scale, right: m * scale, height: `calc(100% - ${m}px)`, aspectRatio: "1" }
        : align === "right-bottom"
          ? { position: "absolute", bottom: m * scale, right: m * scale, height: (e.background_height ?? 80) * scale, aspectRatio: "1" }
          : { position: "absolute", top: m * scale, right: m * scale, height: (e.background_height ?? 80) * scale, aspectRatio: "1" };
  const img = (style: CSSProperties) =>
    tint ? (
      <span
        aria-hidden
        style={{
          ...style,
          opacity: (e.background_opacity ?? 100) / 100,
          backgroundColor: tint,
          WebkitMaskImage: `url("${bg}")`,
          maskImage: `url("${bg}")`,
          WebkitMaskSize: align === "fill" ? "cover" : "contain",
          maskSize: align === "fill" ? "cover" : "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "right center",
          maskPosition: "right center",
          pointerEvents: "none",
        }}
      />
    ) : (
      <img
        src={bg!}
        alt=""
        aria-hidden
        style={{
          ...style,
          aspectRatio: undefined,
          width: align === "fill" ? "100%" : "auto",
          objectFit: align === "fill" ? "cover" : "contain",
          opacity: (e.background_opacity ?? 100) / 100,
          pointerEvents: "none",
        }}
      />
    );
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen();
        }
      }}
      className="flex cursor-pointer overflow-hidden rounded-[26px] transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ border: `2px solid ${p.base}`, background: "#fff", color: "#1f2937", minHeight: 52 }}
    >
      <div
        className="flex w-28 shrink-0 flex-col items-center justify-center px-3 py-2 font-bold tabular-nums leading-tight"
        style={{ backgroundColor: p.base, color: p.onBase }}
      >
        <div className="text-base">{running ? t("display.now") : fmt(e.time)}</div>
        {e.end_time ? (
          <div className="text-[11px] font-medium opacity-70">
            {t("display.untilTime", { time: fmt(e.end_time) })}
          </div>
        ) : null}
        {bg && align === "time" ? img({ position: "relative", width: "100%", height: "auto", marginTop: 4 }) : null}
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-4 py-2">
        {bg && align !== "time" && e.kind !== "register" ? img(bgBox) : null}
        {registerUrl ? (
          <div className="absolute bottom-1.5 right-2 top-1.5 z-[1]">
            <PreviewQr url={registerUrl} color={p.deep} />
          </div>
        ) : null}
        <div className="relative z-[1] text-sm font-bold leading-tight">
          {e.kind === "slides" ? slideSetName ?? t("entries.kind.slides") : e.title}
        </div>
        {e.kind === "slides" ? (
          <div className="relative z-[1]">
            <SlideStrip tenantKey={tenantKey} setId={e.slide_set_id ?? null} />
          </div>
        ) : e.description ? (
          <div className="relative z-[1] whitespace-pre-wrap text-xs italic text-gray-500">
            {e.description}
          </div>
        ) : null}
        {registerUrl ? (
          <div
            className="relative z-[1] break-all pr-16 font-mono text-xs font-bold"
            style={{ color: p.deep }}
          >
            {registerUrl.replace(/^https?:\/\//, "")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PreviewQr({ url, color }: { url: string; color: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode").then(async (QR) => {
      const data = await QR.toDataURL(url, { margin: 1, width: 256, color: { dark: color, light: "#ffffff" } });
      if (alive) setSrc(data);
    });
    return () => {
      alive = false;
    };
  }, [url, color]);
  return src ? <img src={src} alt="" aria-hidden className="block h-full w-auto" /> : null;
}

/** One-line horizontal preview of all slides in a set. */
function SlideStrip({ tenantKey, setId }: { tenantKey: string; setId: string | null }) {
  const { t } = useI18n();
  const listFn = useServerFn(listSlides);
  const q = useQuery({
    queryKey: ["slides", tenantKey, setId],
    queryFn: () => listFn({ data: { key: tenantKey, setId: setId! } }),
    enabled: !!setId,
  });
  if (!setId) return <div className="text-xs italic text-muted-foreground">{t("entries.preview.noSet")}</div>;
  const slides = q.data ?? [];
  if (q.isSuccess && slides.length === 0)
    return <div className="text-xs italic text-muted-foreground">{t("slides.empty")}</div>;
  return (
    <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1 pt-1">
      {slides.map((s) =>
        s.kind === "entries" ? (
          <div
            key={s.id}
            title={s.name}
            className="flex aspect-video w-28 shrink-0 items-center justify-center rounded border bg-muted/40 text-muted-foreground"
          >
            <CalendarClock className="h-6 w-6" />
          </div>
        ) : (
          <img
            key={s.id}
            src={s.url ?? `/api/public/slide/${tenantKey}/${s.id}`}
            alt={s.name}
            title={s.name}
            className="aspect-video w-28 shrink-0 rounded border bg-muted/40 object-cover"
          />
        ),
      )}
    </div>
  );
}

function EntryForm({
  initial,
  kind: kindProp,
  teamCount = 0,
  practiceMinutes = 10,
  slideSets = [],
  rooms,
  schemes,
  defaultColor,
  tenantKey,
  onSubmit,
  onSaved,
  onCancel,
}: {
  initial: EntryRow | null;
  rooms: RoomRow[];
  schemes: SchemeRow[];
  defaultColor: string;
  tenantKey: string;
  /** "practice" entries expand into one row per team on the displays */
  kind?: EntryKindValue;
  teamCount?: number;
  practiceMinutes?: number;
  /** slide sets a slideshow entry can play */
  slideSets?: { id: string; name: string }[];
  onSaved: () => void;

  onSubmit: (entry: {
    id?: string;
    kind: EntryKindValue;
    time: string;
    end_time?: string | null;
    title: string;
    description: string;
    tags: string[];
    color_scheme_id: string | null;
    slide_set_id: string | null;
    notify: boolean;
    background_align: EntryBgAlign;
    background_height: number;
    background_opacity: number;
    background_margin: number;
    background_tint: (typeof ENTRY_BG_TINTS)[number] | null;
  }) => Promise<string>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const kind: EntryKindValue =
    (initial?.kind as EntryKindValue | undefined) ?? kindProp ?? "entry";
  const isPractice = kind === "practice";
  // registration entries render a QR code instead of an image
  const isRegister = kind === "register";
  // slideshow entries switch "auto" displays to a slide set between start and end
  const isSlides = kind === "slides";
  const [slideSetId, setSlideSetId] = useState<string>(
    initial?.slide_set_id ?? slideSets[0]?.id ?? "",
  );
  const uploadBgFn = useServerFn(uploadEntryBackground);
  const removeBgFn = useServerFn(removeEntryBackground);
  const [time, setTime] = useState(
    initial ? toLocalInput(initial.time) : toLocalInput(new Date().toISOString()),
  );
  // end time is time-only (hh:mm); its date always comes from the start time's date
  const [endTime, setEndTime] = useState<string | null>(
    initial?.end_time
      ? (() => {
          const d = new Date(initial.end_time!);
          const p = (n: number) => n.toString().padStart(2, "0");
          return `${p(d.getHours())}:${p(d.getMinutes())}`;
        })()
      : null,
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [selectedRooms, setSelectedRooms] = useState<string[]>(initial?.tags ?? []);
  const [schemeId, setSchemeId] = useState<string>(initial?.color_scheme_id ?? "");
  const [notify, setNotify] = useState<boolean>(initial?.notify !== false);
  const [saving, setSaving] = useState(false);
  const [bgAlign, setBgAlign] = useState<EntryBgAlign>(
    (initial?.background_align as EntryBgAlign) ?? "right-top",
  );
  const [bgHeight, setBgHeight] = useState<number>(initial?.background_height ?? 80);
  const [bgOpacity, setBgOpacity] = useState<number>(initial?.background_opacity ?? 100);
  const [bgMargin, setBgMargin] = useState<number>(initial?.background_margin ?? 0);
  const [bgTint, setBgTint] = useState<(typeof ENTRY_BG_TINTS)[number] | null>(
    initial?.background_tint ?? null,
  );
  const [bgUrl, setBgUrl] = useState<string | null>(initial?.background_url ?? null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [bgRemoved, setBgRemoved] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const previewSrc = bgPreview ?? (bgRemoved ? null : bgUrl);
  const entryPalette = derivePalette(
    schemes.find((s) => s.id === schemeId)?.color ?? defaultColor,
  );
  // only images with an alpha channel (PNG/SVG/WebP/GIF) can be recolored
  const tintable =
    !!previewSrc &&
    supportsTint(bgFile ? bgFile.type : (initial?.background_content_type ?? null));


  const toggleRoom = (name: string) => {
    setSelectedRooms((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden gap-3">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {/* Left column (1): time, end time, color scheme, posting option */}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("entries.form.time")}</Label>
            <Input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          {isPractice ? (
            <div className="space-y-1">
              <Label>{t("entries.form.endTime")}</Label>
              <Input
                readOnly
                disabled
                value={(() => {
                  const startMs = new Date(time).getTime();
                  if (!Number.isFinite(startMs)) return "";
                  const end = new Date(startMs + teamCount * practiceMinutes * 60_000);
                  return end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                })()}
              />
              <p className="text-xs text-muted-foreground">
                {t("entries.form.practiceEndHint", {
                  teams: teamCount,
                  minutes: practiceMinutes,
                })}
              </p>
            </div>
          ) : (
          <div className="space-y-1">
            <Label>{t("entries.form.endTime")}</Label>
            <div className="flex items-center gap-1">
              <Input
                type="time"
                value={endTime ?? ""}
                onChange={(e) => setEndTime(e.target.value || null)}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    disabled={!endTime}
                    onClick={() => setEndTime(null)}
                    aria-label={t("entries.form.clearEnd")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("entries.form.clearEnd")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          )}
          {isSlides ? (
            <div className="space-y-1">
              <Label>{t("entries.form.slideSet")}</Label>
              <select
                value={slideSetId}
                onChange={(e) => setSlideSetId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">{t("entries.form.slideSetNone")}</option>
                {slideSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t("entries.form.slidesHint")}</p>
            </div>
          ) : null}
          {isPractice || isRegister || isSlides ? null : (
          <div className="space-y-1">
            <Label>{t("entries.form.scheme")}</Label>
            <div className="flex items-center gap-2">
              <span
                className="h-6 w-6 shrink-0 rounded-full border"
                style={{
                  backgroundColor: schemes.find((s) => s.id === schemeId)?.color ?? defaultColor,
                }}
              />
              <select
                value={schemeId}
                onChange={(e) => setSchemeId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">{t("colors.default")}</option>
                {schemes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">{t("entries.form.schemeHint")}</p>
          </div>
          )}
          {isSlides ? null : (
          <div className="flex items-center gap-2">
            <Checkbox
              id="notify"
              checked={notify}
              onCheckedChange={(c) => setNotify(c === true)}
            />
            <Label htmlFor="notify" className="text-sm font-normal">
              {t("entries.form.notify")}
            </Label>
          </div>
          )}
        </div>


        {/* Right column (2): title, description, rooms */}
        <div className="col-span-1 sm:col-span-2 space-y-3">
          {isSlides ? null : (
          <div className="space-y-1">
            <Label>{t("entries.form.title")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("entries.form.titlePh")}
            />
          </div>
          )}
          {isSlides ? null : isPractice ? (
            <p className="text-sm text-muted-foreground">{t("entries.form.practiceHint")}</p>
          ) : (
          <div className="space-y-1">
            <Label>{t("entries.form.description")}</Label>
            <Textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("entries.form.descriptionPh")}
            />
          </div>
          )}
          {isPractice || isRegister ? null : (
          <div className="space-y-2">
            <Label>{t("entries.form.rooms")}</Label>
            <div className="flex flex-wrap gap-2">
              {rooms.length === 0 ? (
                <span className="text-xs italic text-muted-foreground">{t("entries.allRooms")}</span>
              ) : (
                rooms.map((r) => {
                  const active = selectedRooms.includes(r.name);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleRoom(r.name)}
                      className={
                        "px-3 py-1 rounded-full border text-sm transition " +
                        (active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-input hover:bg-accent")
                      }
                    >
                      {r.name}
                    </button>
                  );
                })
              )}
              {rooms.length > 0 && selectedRooms.length === 0 ? (
                <span className="px-3 py-1 rounded-full border border-dashed text-xs italic text-muted-foreground">
                  {t("entries.allRooms")}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{t("entries.form.roomsHint")}</p>
          </div>
          )}

          {isRegister ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm text-muted-foreground">{t("entries.form.registerHint")}</p>
              {initial?.register_token ? (
                <div className="space-y-1">
                  <Label className="text-xs">{t("entries.form.registerToken")}</Label>
                  <Input
                    readOnly
                    className="font-mono text-xs"
                    value={`${typeof window === "undefined" ? "" : window.location.origin}/tr/${initial.register_token}`}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Background image */}
          <div className={`space-y-2 border-t pt-3 ${isRegister || isSlides ? "hidden" : ""}`}>
            <Label>{t("entries.form.bg")}</Label>
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setBgFile(f);
                setBgRemoved(false);
                setBgPreview(URL.createObjectURL(f));
              }}
            />
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              {/* left: preview, upload/download/remove, tint */}
              <div className="space-y-2">
                <div className="flex gap-3 items-start">
                  <div
                    className="relative h-24 w-40 shrink-0 overflow-hidden rounded-md border"
                    style={{
                      backgroundColor: bgAlign === "time" ? entryPalette.base : "#ffffff",
                    }}
                  >
                    {previewSrc ? (
                      bgTint && tintable ? (
                        <span
                          aria-hidden
                          className="absolute inset-0"
                          style={{
                            opacity: bgOpacity / 100,
                            backgroundColor: entryPalette[bgTint],
                            WebkitMaskImage: `url("${previewSrc}")`,
                            maskImage: `url("${previewSrc}")`,
                            WebkitMaskSize: "contain",
                            maskSize: "contain",
                            WebkitMaskRepeat: "no-repeat",
                            maskRepeat: "no-repeat",
                            WebkitMaskPosition: "center",
                            maskPosition: "center",
                          }}
                        />
                      ) : (
                        <img
                          src={previewSrc}
                          alt=""
                          className="h-full w-full object-contain"
                          style={{ opacity: bgOpacity / 100 }}
                        />
                      )
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        {t("entries.form.bgNone")}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => bgInputRef.current?.click()}
                          aria-label={t("entries.form.bgUpload")}
                        >
                          <Upload className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("entries.form.bgUpload")}</TooltipContent>
                    </Tooltip>
                    {bgUrl && !bgRemoved ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            asChild
                            aria-label={t("entries.form.bgDownload")}
                          >
                            <a href={bgUrl} download target="_blank" rel="noreferrer">
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("entries.form.bgDownload")}</TooltipContent>
                      </Tooltip>
                    ) : null}
                    {previewSrc ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setBgFile(null);
                              setBgPreview(null);
                              setBgRemoved(true);
                            }}
                            aria-label={t("entries.form.bgRemove")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("entries.form.bgRemove")}</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </div>
                {tintable ? (
                  <div className="space-y-1">
                    <Label className="text-xs">{t("entries.form.bgTint")}</Label>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-6 w-6 shrink-0 rounded border"
                        style={{
                          backgroundColor: bgTint
                            ? entryPalette[bgTint]
                            : "transparent",
                          backgroundImage: bgTint
                            ? undefined
                            : "linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%)",
                          backgroundSize: "8px 8px",
                          backgroundPosition: "0 0, 4px 4px",
                        }}
                      />
                      <select
                        value={bgTint ?? ""}
                        onChange={(e) =>
                          setBgTint(
                            (e.target.value || null) as (typeof ENTRY_BG_TINTS)[number] | null,
                          )
                        }
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      >
                        <option value="">{t("entries.form.bgTintNone")}</option>
                        {ENTRY_BG_TINTS.map((tint) => (
                          <option key={tint} value={tint}>
                            {t(`entries.form.bgTint.${tint}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("entries.form.bgTintHint")}
                    </p>
                  </div>
                ) : null}
              </div>

              {/* right: opacity, alignment, size, margin */}
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {t("entries.form.bgOpacity")}: {bgOpacity}%
                  </Label>
                  <Input
                    type="range"
                    min={0}
                    max={100}
                    value={bgOpacity}
                    onChange={(e) => setBgOpacity(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("entries.form.bgAlign")}</Label>
                  <select
                    value={bgAlign}
                    onChange={(e) => setBgAlign(e.target.value as EntryBgAlign)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {ENTRY_BG_ALIGNMENTS.map((a) => (
                      <option key={a} value={a}>
                        {t(`entries.form.bgAlign.${a}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {bgAlign === "right-top" || bgAlign === "right-bottom" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">{t("entries.form.bgHeight")}</Label>
                    <Input
                      type="number"
                      min={8}
                      max={2000}
                      value={bgHeight}
                      onChange={(e) => setBgHeight(Number(e.target.value) || 8)}
                    />
                  </div>
                ) : null}
                {bgAlign !== "fill" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">{t("entries.form.bgMargin")}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={500}
                      value={bgMargin}
                      onChange={(e) => setBgMargin(Math.max(0, Number(e.target.value) || 0))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("entries.form.bgMarginHint")}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
      <div className="flex gap-2 justify-end shrink-0 border-t px-3 pt-3 bg-background">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("entries.cancel")}
        </Button>
        <Button
          disabled={
            saving ||
            (!isSlides && !title.trim()) ||
            !time ||
            (isSlides && (!endTime || !slideSetId))
          }
          onClick={async () => {
            setSaving(true);
            try {
              const startMs = new Date(time).getTime();
              // Build end from the start time's date plus the entered hh:mm.
              // If that would be at or before the start (crossing midnight),
              // auto-roll to the next day.
              let endMs: number | null = null;
              if (endTime) {
                const [eh, em] = endTime.split(":").map(Number);
                const end = new Date(startMs);
                end.setHours(eh, em, 0, 0);
                if (end.getTime() <= startMs) end.setDate(end.getDate() + 1);
                endMs = end.getTime();
              }
              // Drop any selected room names that no longer exist
              const validNames = new Set(rooms.map((r) => r.name));
              const tags = selectedRooms.filter((n) => validNames.has(n));
              const id = await onSubmit({
                id: initial?.id,
                kind,
                time: new Date(time).toISOString(),
                end_time: isPractice ? null : endMs != null ? new Date(endMs).toISOString() : null,
                title: isSlides
                  ? (slideSets.find((s) => s.id === slideSetId)?.name ?? "")
                  : title.trim(),
                description: isPractice || isSlides ? "" : description.trim(),
                tags: isPractice || isRegister ? [] : tags,
                color_scheme_id: isPractice || isRegister || isSlides ? null : schemeId || null,
                slide_set_id: isSlides ? slideSetId || null : null,
                notify: isSlides ? false : notify,
                background_align: bgAlign,
                background_height: bgHeight,
                background_opacity: bgOpacity,
                background_margin: bgMargin,
                background_tint: bgTint,
              });
              if (bgRemoved && !bgFile) {
                await removeBgFn({ data: { key: tenantKey, id } });
              }
              if (bgFile) {
                const buf = new Uint8Array(await bgFile.arrayBuffer());
                let bin = "";
                for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
                await uploadBgFn({
                  data: {
                    key: tenantKey,
                    id,
                    filename: bgFile.name,
                    contentType: bgFile.type || "image/png",
                    dataBase64: btoa(bin),
                  },
                });
              }
              onSaved();

            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? t("entries.saving") : t("entries.save")}
        </Button>
      </div>
    </div>
    </TooltipProvider>
  );
}

// --------------- Rooms ---------------

function RoomsPanel({
  tenantKey,
  rooms,
  schemes,
  defaultColor,
  onChange,
}: {
  tenantKey: string;
  rooms: RoomRow[];
  schemes: SchemeRow[];
  defaultColor: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<RoomRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const upsertFn = useServerFn(upsertRoom);
  const deleteFn = useServerFn(deleteRoom);

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { key: tenantKey, id } }),
    onSuccess: () => {
      toast.success(t("rooms.deleted"));
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-2 bg-background/95 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex justify-between items-center">
        <h2 className="text-lg font-medium">{t("rooms.title")}</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          {t("rooms.new")}
        </Button>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("rooms.edit") : t("rooms.new")}</DialogTitle>
          </DialogHeader>
          {showForm ? (
            <RoomForm
              tenantKey={tenantKey}
              initial={editing}
              schemes={schemes}
              defaultColor={defaultColor}
              onCancel={() => setShowForm(false)}
              onSubmit={async (room) => {
                await upsertFn({ data: { key: tenantKey, room } });
                toast.success(editing ? t("rooms.updated") : t("rooms.created"));
                setShowForm(false);
                onChange();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>


      <div className="grid gap-2 sm:grid-cols-2">
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span
              className="h-4 w-4 shrink-0 rounded-full border"
              style={{ backgroundColor: defaultColor }}
              title={t("colors.default")}
            />
            <div className="font-semibold truncate">{t("rooms.overview")}</div>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <Link
              to="/tenant/$tenantKey/room/$roomId"
              params={{ tenantKey, roomId: "overview" }}
              target="_blank"
            >
              <Button size="sm" variant="default">
                {t("rooms.openDisplay")}
              </Button>
            </Link>
            <span className="text-xs text-muted-foreground">{t("rooms.overviewHint")}</span>
          </div>
        </Card>
        {rooms.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">
            {t("rooms.empty")}
          </Card>
        ) : (
          rooms.map((r) => (
            <Card key={r.id} className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-4 w-4 shrink-0 rounded-full border"
                  style={{
                    backgroundColor:
                      schemes.find((s) => s.id === r.color_scheme_id)?.color ?? defaultColor,
                  }}
                  title={
                    schemes.find((s) => s.id === r.color_scheme_id)?.name ?? t("colors.default")
                  }
                />
                <div className="font-semibold truncate">{r.name}</div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Link
                  to="/tenant/$tenantKey/room/$roomId"
                  params={{ tenantKey, roomId: r.id }}
                  target="_blank"
                >
                  <Button size="sm" variant="default">
                    {t("rooms.openDisplay")}
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(r);
                    setShowForm(true);
                  }}
                >
                  {t("rooms.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(t("rooms.confirmDelete"))) delMut.mutate(r.id);
                  }}
                >
                  {t("rooms.delete")}
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function RoomForm({
  initial,
  schemes,
  defaultColor,
  tenantKey,
  onSubmit,
  onCancel,
}: {
  initial: RoomRow | null;
  schemes: SchemeRow[];
  defaultColor: string;
  tenantKey: string;
  onSubmit: (room: {
    id?: string;
    ref_id: string | null;
    name: string;
    color_scheme_id: string | null;
    template: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const templateOptions = useTemplateOptions(tenantKey);
  const [name, setName] = useState(initial?.name ?? "");
  const [refId, setRefId] = useState(initial?.ref_id ?? "");
  const [schemeId, setSchemeId] = useState(initial?.color_scheme_id ?? "");
  const [tpl, setTpl] = useState(initial?.template ?? "");
  const [saving, setSaving] = useState(false);


  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t("rooms.form.name")}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("rooms.form.namePh")}
        />
        <p className="text-xs text-muted-foreground">{t("rooms.form.nameHint")}</p>
      </div>
      <RefIdField value={refId} onChange={setRefId} name={name} />

      <div className="space-y-1">
        <Label>{t("rooms.form.scheme")}</Label>
        <div className="flex items-center gap-2">
          <span
            className="h-6 w-6 shrink-0 rounded-full border"
            style={{
              backgroundColor: schemes.find((s) => s.id === schemeId)?.color ?? defaultColor,
            }}
          />
          <select
            value={schemeId}
            onChange={(e) => setSchemeId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">{t("colors.default")}</option>
            {schemes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">{t("rooms.form.schemeHint")}</p>
      </div>
      <div className="space-y-1">
        <Label>{t("rooms.form.template")}</Label>
        <select
          value={tpl}
          onChange={(e) => setTpl(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">{t("rooms.form.templateGlobal")}</option>
          {tpl && !templateOptions.some((o) => o.value === tpl) && (
            <option value={tpl}>{t("settings.template.slides")}</option>
          )}
          {templateOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}

        </select>
        <p className="text-xs text-muted-foreground">{t("rooms.form.templateHint")}</p>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("entries.cancel")}
        </Button>
        <Button
          disabled={saving || !name.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              await onSubmit({
                ref_id: refId.trim() || null,

                id: initial?.id,
                name: name.trim(),
                color_scheme_id: schemeId || null,
                template: tpl || null,
              });
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? t("entries.saving") : t("entries.save")}
        </Button>
      </div>
    </div>
  );
}

// --------------- Settings ---------------

function SettingsPanel({
  tenantKey,
  name,
  logoUrl,
  logoHeight,
  accentColor,
  graceMinutes,
  template,
  slideSeconds,
  focusMode,
  focusCount,
  focusMinutes,
  focusDimOpacity,
  practiceMinutes,
  practiceRoomScope,
  teamEditLocked,
  filesMode,
  maxUploadMb,
  teamQuotaMb,
  onChange,
}: {
  tenantKey: string;
  name: string;
  logoUrl: string | null;
  logoHeight: number;
  accentColor: string;
  graceMinutes: number;
  template: string;
  slideSeconds: number;
  focusMode: string;
  focusCount: number;
  focusMinutes: number;
  focusDimOpacity: number;
  practiceMinutes: number;
  practiceRoomScope: string;
  teamEditLocked?: boolean;
  filesMode?: FileMode;
  maxUploadMb?: number;
  teamQuotaMb?: number;
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [n, setN] = useState(name);
  const [g, setG] = useState(graceMinutes);
  
  const [slideSec, setAdSec] = useState(slideSeconds);
  const [lh, setLh] = useState(logoHeight);
  const [accent, setAccent] = useState(accentColor || DEFAULT_ACCENT);
  const [fMode, setFMode] = useState<"count" | "minutes">(
    focusMode === "minutes" ? "minutes" : "count",
  );
  const [fCount, setFCount] = useState(focusCount);
  const [fMinutes, setFMinutes] = useState(focusMinutes);
  const [fDim, setFDim] = useState(focusDimOpacity);
  const [pMinutes, setPMinutes] = useState(practiceMinutes);
  const [pScope, setPScope] = useState<"all" | "assigned">(
    practiceRoomScope === "assigned" ? "assigned" : "all",
  );
  const [teamLock, setTeamLock] = useState(teamEditLocked === true);
  const [fileMode, setFileMode] = useState<FileMode>(normalizeFileMode(filesMode));
  const [maxMb, setMaxMb] = useState(maxUploadMb ?? 10);
  const [quotaMb, setQuotaMb] = useState(teamQuotaMb ?? 0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const updateFn = useServerFn(updateTenantSettings);
  const deleteFn = useServerFn(deleteTenant);

  const uploadLogoFn = useServerFn(uploadTenantLogo);
  const removeLogoFn = useServerFn(removeTenantLogo);
  const fileRef = useRef<HTMLInputElement>(null);

  const [logoBust, setLogoBust] = useState(0);
  const logoSrc = logoUrl ? `/api/public/logo/${tenantKey}?v=${logoBust}` : null;

  const [section, setSection] = useState<
    "general" | "display" | "teams" | "files" | "logo" | "webhooks" | "tenant"
  >("general");


  const saveButton = (
    <div className="pt-2">
      <Button
        size="sm"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await updateFn({
              data: {
                key: tenantKey,
                name: n,
                past_grace_minutes: g,
                template,
                logo_height: lh,
                accent_color: accent,
                slide_seconds: slideSec,
                focus_mode: fMode,
                focus_count: fCount,
                focus_minutes: fMinutes,
                focus_dim_opacity: fDim,
                practice_minutes: pMinutes,
                practice_room_scope: pScope,
                team_edit_locked: teamLock,
                files_mode: fileMode,
                max_upload_mb: maxMb,
                team_quota_mb: quotaMb,
              },
            });
            toast.success(t("settings.saved"));
            onChange();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? t("entries.saving") : t("settings.save")}
      </Button>
    </div>
  );

  return (
    <div className="max-w-xl space-y-4">
      <Tabs value={section} onValueChange={(v) => setSection(v as typeof section)}>
        <TabsList>
          <TabsTrigger value="general">{t("settings.sec.general")}</TabsTrigger>
          <TabsTrigger value="display">{t("settings.sec.display")}</TabsTrigger>
          <TabsTrigger value="teams">{t("settings.sec.teams")}</TabsTrigger>
          <TabsTrigger value="files">{t("settings.sec.files")}</TabsTrigger>

          <TabsTrigger value="logo">{t("settings.sec.logo")}</TabsTrigger>
          <TabsTrigger value="webhooks">{t("settings.sec.webhooks")}</TabsTrigger>
          <TabsTrigger value="tenant">{t("settings.sec.tenant")}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="pt-4">
          <Card className="p-4 space-y-3">
            <div className="space-y-1">
              <Label>{t("settings.name")}</Label>
              <Input value={n} onChange={(e) => setN(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("settings.accent")}</Label>
              <ColorField value={accent} onChange={setAccent} />
              <p className="text-xs text-muted-foreground">{t("settings.accentHint")}</p>
              <PalettePreview color={accent} />
            </div>
            {saveButton}
          </Card>
        </TabsContent>

        <TabsContent value="display" className="pt-4">
          <Card className="p-4 space-y-3">
            <div className="space-y-1">
              <Label>{t("settings.grace")}</Label>
              <Input
                type="number"
                min={0}
                max={1440}
                value={g}
                onChange={(e) => setG(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2 border-t pt-4 mt-4">
              <Label>{t("settings.focusTitle")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.focusHint")}</p>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("settings.focusMode")}</Label>
                <Select value={fMode} onValueChange={(v) => setFMode(v as "count" | "minutes")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">{t("settings.focusModeCount")}</SelectItem>
                    <SelectItem value="minutes">{t("settings.focusModeMinutes")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {fMode === "count" ? (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {t("settings.focusCount")}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={fCount}
                    onChange={(e) => setFCount(Number(e.target.value))}
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {t("settings.focusMinutes")}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={1440}
                    value={fMinutes}
                    onChange={(e) => setFMinutes(Number(e.target.value))}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t("settings.focusDim")}: {fDim}%
                </Label>
                <Input
                  type="range"
                  min={0}
                  max={100}
                  value={fDim}
                  onChange={(e) => setFDim(Number(e.target.value))}
                />
              </div>
            </div>
            {saveButton}
          </Card>
        </TabsContent>

        <TabsContent value="teams" className="pt-4">
          <Card className="p-4 space-y-3">
            <div className="space-y-1">
              <Label>{t("settings.practiceMinutes")}</Label>
              <Input
                type="number"
                min={1}
                max={600}
                value={pMinutes}
                onChange={(e) => setPMinutes(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("settings.practiceScope")}</Label>
              <select
                value={pScope}
                onChange={(e) => setPScope(e.target.value as "all" | "assigned")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">{t("settings.practiceScope.all")}</option>
                <option value="assigned">{t("settings.practiceScope.room")}</option>
              </select>
            </div>
            <div className="flex items-start gap-2 border-t pt-3">
              <Checkbox
                id="team-lock"
                checked={teamLock}
                onCheckedChange={(c) => setTeamLock(c === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="team-lock" className="text-sm font-normal">
                  {t("teams.lockEdit")}
                </Label>
                <p className="text-xs text-muted-foreground">{t("teams.lockEditHint")}</p>
              </div>
            </div>
            {saveButton}
          </Card>
        </TabsContent>

        <TabsContent value="files" className="pt-4">
          <Card className="p-4 space-y-3">
            <div className="space-y-1">
              <Label>{t("settings.filesMode")}</Label>
              <select
                value={fileMode}
                onChange={(e) => setFileMode(e.target.value as FileMode)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {FILE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`settings.filesMode.${m}`)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t("settings.filesModeHint")}</p>
            </div>
            {fileMode !== "off" ? (
              <div className="space-y-1">
                <Label>{t("settings.maxUploadMb")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={2048}
                  value={maxMb}
                  onChange={(e) => setMaxMb(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            ) : null}
            {fileMode === "full" ? (
              <div className="space-y-1">
                <Label>{t("settings.teamQuotaMb")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={quotaMb}
                  onChange={(e) => setQuotaMb(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                />
                <p className="text-xs text-muted-foreground">{t("settings.teamQuotaHint")}</p>
              </div>
            ) : null}
            {saveButton}
          </Card>
        </TabsContent>


        <TabsContent value="logo" className="pt-4">
          <Card className="p-4 space-y-2">
            <Label>{t("settings.logo")}</Label>
            <div className="space-y-1 pb-2">
              <Label className="text-xs text-muted-foreground">{t("settings.logoHeight")}</Label>
              <Input
                type="number"
                min={16}
                max={400}
                value={lh}
                onChange={(e) => setLh(Number(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="rounded-md border bg-muted/40 p-2">
                <img
                  src={logoSrc ?? defaultLogo.url}
                  alt="Logo"
                  className="h-12 w-auto object-contain"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {logoSrc ? t("settings.logoHint") : t("settings.logoDefault")}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (ev) => {
                const file = ev.target.files?.[0];
                ev.target.value = "";
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                  toast.error(t("settings.logoTooLarge"));
                  return;
                }
                try {
                  const buf = new Uint8Array(await file.arrayBuffer());
                  let bin = "";
                  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
                  await uploadLogoFn({
                    data: {
                      key: tenantKey,
                      filename: file.name,
                      contentType: file.type || "image/png",
                      dataBase64: btoa(bin),
                    },
                  });
                  setLogoBust(Date.now());
                  toast.success(t("settings.logoSaved"));
                  onChange();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            />
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                {t("settings.logoUpload")}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={logoSrc ?? defaultLogo.url} download>
                  {t("settings.logoDownload")}
                </a>
              </Button>
              {logoSrc ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    try {
                      await removeLogoFn({ data: { key: tenantKey } });
                      toast.success(t("settings.logoRemoved"));
                      onChange();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  {t("settings.logoRemove")}
                </Button>
              ) : null}
            </div>
            {saveButton}
          </Card>
        </TabsContent>

        <TabsContent value="webhooks" className="pt-4">
          <Card className="p-4">
            <WebhookConfigPanel tenantKey={tenantKey} onChange={onChange} />
          </Card>
        </TabsContent>

        <TabsContent value="tenant" className="pt-4 space-y-4">
          <Card className="p-4 space-y-2">
            <div className="font-medium">{t("settings.keyTitle")}</div>
            <div className="font-mono text-xs break-all rounded-md border bg-muted px-3 py-2">
              {tenantKey}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(tenantKey)}
              >
                {t("home.copy")}
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <PinCard tenantKey={tenantKey} />
          </Card>

          <Card className="p-4 space-y-2">
            <div className="font-medium text-destructive">{t("settings.dangerTitle")}</div>
            <p className="text-xs text-muted-foreground">{t("settings.dangerHint")}</p>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={async () => {
                if (!confirm(t("settings.deleteConfirm"))) return;
                setDeleting(true);
                try {
                  await deleteFn({ data: { key: tenantKey } });
                  clearStoredTenantKey();
                  toast.success(t("settings.deleted"));
                  navigate({ to: "/" });
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {t("settings.delete")}
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}


// --------------- Color schemes ---------------

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-9 w-12 cursor-pointer rounded border bg-background p-1"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="font-mono"
      />
    </div>
  );
}

function PalettePreview({ color }: { color: string }) {
  const { t } = useI18n();
  const p = derivePalette(color);
  const swatches: { key: string; value: string }[] = [
    { key: "colors.swatch.base", value: p.base },
    { key: "colors.swatch.deep", value: p.deep },
    { key: "colors.swatch.peak", value: p.peak },
    { key: "colors.swatch.highlight", value: p.highlight },
  ];
  return (
    <div className="space-y-1 pt-1">
      <div className="flex gap-2">
        {swatches.map((s) => (
          <div key={s.key} className="space-y-1 text-center">
            <div
              className="h-7 w-12 rounded border"
              style={{ backgroundColor: s.value }}
              title={s.value}
            />
            <div className="text-[10px] text-muted-foreground">{t(s.key)}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("colors.derived", {
          glow: p.glowBlur,
          border: p.borderDuration,
          pulse: p.pulseDuration,
        })}
      </p>
    </div>
  );
}

function ColorSchemesPanel({
  tenantKey,
  schemes,
  defaultColor,
  onChange,
}: {
  tenantKey: string;
  schemes: SchemeRow[];
  defaultColor: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<SchemeRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const upsertFn = useServerFn(upsertColorScheme);
  const deleteFn = useServerFn(deleteColorScheme);

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { key: tenantKey, id } }),
    onSuccess: () => {
      toast.success(t("colors.deleted"));
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-2 bg-background/95 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex justify-between items-center">
        <h2 className="text-lg font-medium">{t("colors.title")}</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          {t("colors.new")}
        </Button>
      </div>

      <Card className="p-4 space-y-2 max-w-xl">
        <div className="font-medium text-sm">{t("colors.default")}</div>
        <PalettePreview color={defaultColor} />
        <p className="text-xs text-muted-foreground">{t("colors.defaultHint")}</p>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("entries.edit") : t("colors.new")}</DialogTitle>
          </DialogHeader>
          {showForm ? (
            <SchemeForm
              initial={editing}
              onCancel={() => setShowForm(false)}
              onSubmit={async (scheme) => {
                await upsertFn({ data: { key: tenantKey, scheme } });
                toast.success(editing ? t("colors.updated") : t("colors.created"));
                setShowForm(false);
                onChange();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>


      <div className="grid gap-2 sm:grid-cols-2">
        {schemes.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center sm:col-span-2">
            {t("colors.empty")}
          </Card>
        ) : (
          schemes.map((s) => (
            <Card key={s.id} className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-5 w-5 rounded-full border"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-semibold truncate">{s.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{s.color}</span>
              </div>
              <PalettePreview color={s.color} />
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(s);
                    setShowForm(true);
                  }}
                >
                  {t("entries.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(t("colors.confirmDelete"))) delMut.mutate(s.id);
                  }}
                >
                  {t("entries.delete")}
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function SchemeForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: SchemeRow | null;
  onSubmit: (scheme: {
    id?: string;
    ref_id: string | null;
    name: string;
    color: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [refId, setRefId] = useState(initial?.ref_id ?? "");
  const [color, setColor] = useState(initial?.color ?? DEFAULT_ACCENT);
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t("colors.form.name")}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("colors.form.namePh")}
        />
      </div>
      <RefIdField value={refId} onChange={setRefId} name={name} />
      <div className="space-y-1">
        <Label>{t("colors.form.color")}</Label>
        <ColorField value={color} onChange={setColor} />
        <PalettePreview color={color} />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("entries.cancel")}
        </Button>
        <Button
          disabled={saving || !name.trim() || !/^#[0-9a-fA-F]{6}$/.test(color)}
          onClick={async () => {
            setSaving(true);
            try {
              await onSubmit({
                id: initial?.id,
                ref_id: refId.trim() || null,
                name: name.trim(),
                color: color.toUpperCase(),
              });
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? t("entries.saving") : t("entries.save")}
        </Button>
      </div>
    </div>
  );
}

// --------------- Slides ---------------

type SlideSetRow = {
  id: string;
  ref_id?: string | null;
  name: string;
  slide_seconds: number;
  sort_order?: number;
  show_room_name?: boolean | null;
  show_clock?: boolean | null;
  show_logo?: boolean | null;
};

/** Slide sets are fully separate; the tabs switch between them. */
function SlidesPanel({ tenantKey, onChange }: { tenantKey: string; onChange: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listSetsFn = useServerFn(listSlideSets);
  const upsertSetFn = useServerFn(upsertSlideSet);
  const deleteSetFn = useServerFn(deleteSlideSet);
  const [activeSet, setActiveSet] = useState<string | null>(null);

  const setsQ = useQuery({
    queryKey: ["slideSets", tenantKey],
    queryFn: () => listSetsFn({ data: { key: tenantKey } }),
  });
  const sets: SlideSetRow[] = setsQ.data ?? [];

  useEffect(() => {
    if (!sets.length) {
      setActiveSet(null);
      return;
    }
    if (!activeSet || !sets.some((s) => s.id === activeSet)) setActiveSet(sets[0].id);
  }, [sets, activeSet]);

  const current = sets.find((s) => s.id === activeSet) ?? null;
  const refreshSets = () => {
    qc.invalidateQueries({ queryKey: ["slideSets", tenantKey] });
    onChange();
  };

  const [name, setName] = useState("");
  const [refId, setRefId] = useState("");
  const [seconds, setSeconds] = useState(10);
  const [showRoomName, setShowRoomName] = useState(true);
  const [showClock, setShowClock] = useState(true);
  const [showLogo, setShowLogo] = useState(true);
  useEffect(() => {
    setName(current?.name ?? "");
    setRefId(current?.ref_id ?? "");
    setSeconds(current?.slide_seconds ?? 10);
    setShowRoomName(current?.show_room_name ?? true);
    setShowClock(current?.show_clock ?? true);
    setShowLogo(current?.show_logo ?? true);
  }, [
    current?.id,
    current?.name,
    current?.ref_id,
    current?.slide_seconds,
    current?.show_room_name,
    current?.show_clock,
    current?.show_logo,
  ]);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-2 bg-background/95 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">{t("slideSets.title")}</h2>
        <Button
          size="sm"
          onClick={async () => {
            try {
              const res = await upsertSetFn({
                data: {
                  key: tenantKey,
                  set: {
                    name: `${t("slideSets.newName")} ${sets.length + 1}`,
                    ref_id: null,
                    slide_seconds: 10,
                    show_room_name: true,
                    show_clock: true,
                    show_logo: true,
                  },
                },
              });
              setActiveSet(res.id);
              refreshSets();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          {t("slideSets.new")}
        </Button>
      </div>

      {sets.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">{t("slideSets.empty")}</Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 border-b pb-2">
            {sets.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant={s.id === activeSet ? "default" : "outline"}
                onClick={() => setActiveSet(s.id)}
              >
                {s.name}
              </Button>
            ))}
          </div>

          {current && (
            <Card className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>{t("slideSets.name")}</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t("slideSets.seconds")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    value={seconds}
                    onChange={(e) => setSeconds(Number(e.target.value))}
                  />
                </div>
                <RefIdField value={refId} onChange={setRefId} name={name} />
              </div>
              <div className="rounded-md border p-3 space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("slideSets.overlayTitle")}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={showRoomName} onCheckedChange={(v) => setShowRoomName(Boolean(v))} />
                    {t("slideSets.showRoomName")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={showClock} onCheckedChange={(v) => setShowClock(Boolean(v))} />
                    {t("slideSets.showClock")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={showLogo} onCheckedChange={(v) => setShowLogo(Boolean(v))} />
                    {t("slideSets.showLogo")}
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await upsertSetFn({
                        data: {
                          key: tenantKey,
                          set: {
                            id: current.id,
                            name: name.trim() || current.name,
                            ref_id: refId.trim() || null,
                            slide_seconds: Math.min(600, Math.max(1, seconds || 10)),
                            show_room_name: showRoomName,
                            show_clock: showClock,
                            show_logo: showLogo,
                          },
                        },
                      });
                      toast.success(t("slideSets.saved"));
                      refreshSets();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  {t("slideSets.save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(t("slideSets.confirmDelete"))) return;
                    try {
                      await deleteSetFn({ data: { key: tenantKey, id: current.id } });
                      toast.success(t("slideSets.deleted"));
                      setActiveSet(null);
                      refreshSets();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  {t("slideSets.delete")}
                </Button>
              </div>
            </Card>
          )}

          {current && <SlideSetSlides tenantKey={tenantKey} setId={current.id} defaultSeconds={current.slide_seconds} onChange={onChange} />}
        </>
      )}
    </div>
  );
}

function SlideSetSlides({
  tenantKey,
  setId,
  defaultSeconds,
  onChange,
}: {
  tenantKey: string;
  setId: string;
  defaultSeconds: number;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listSlides);
  const uploadFn = useServerFn(uploadSlide);
  const addEntriesFn = useServerFn(addEntriesSlide);
  const deleteFn = useServerFn(deleteSlide);
  const moveFn = useServerFn(moveSlide);
  const updateFn = useServerFn(updateSlide);
  const reorderFn = useServerFn(reorderSlides);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDuration, setEditDuration] = useState("");

  useEffect(() => setOrder(null), [setId]);

  const adsQ = useQuery({
    queryKey: ["slides", tenantKey, setId],
    queryFn: () => listFn({ data: { key: tenantKey, setId } }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["slides", tenantKey, setId] });
    onChange();
  };

  const raw = adsQ.data ?? [];
  const slides =
    order && order.length === raw.length
      ? order
          .map((id) => raw.find((a) => a.id === id))
          .filter((a): a is (typeof raw)[number] => !!a)
      : raw;

  const reorderAt = async (fromId: string, insertIdx: number) => {
    const ids = slides.map((a) => a.id);
    const from = ids.indexOf(fromId);
    if (from < 0) return;
    let to = insertIdx;
    if (from < to) to -= 1;
    if (from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    setOrder(ids);
    try {
      await reorderFn({ data: { key: tenantKey, ids } });
      refresh();
    } catch (e) {
      setOrder(null);
      toast.error((e as Error).message);
    }
  };

  const InsertMarker = ({ show }: { show: boolean }) => (
    <div
      className={`h-1 rounded-full transition-colors ${show ? "bg-primary" : "bg-transparent"}`}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">{t("slides.title")}</h2>
        <div className="flex">
          <Button size="sm" className="rounded-r-none" disabled={busy} onClick={() => fileRef.current?.click()}>
            {t("slides.upload")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                disabled={busy}
                className="rounded-l-none border-l border-primary-foreground/25 px-2"
                aria-label={t("slides.addEntries")}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await addEntriesFn({ data: { key: tenantKey, setId, name: t("slides.kind.entries") } });
                    refresh();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <CalendarClock className="h-4 w-4 mr-2" />
                {t("slides.addEntries")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("slides.hint")}</p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (ev) => {
          const files = Array.from(ev.target.files ?? []);
          ev.target.value = "";
          if (!files.length) return;
          setBusy(true);
          try {
            for (const file of files) {
              if (file.size > 10 * 1024 * 1024) {
                toast.error(t("slides.tooLarge"));
                continue;
              }
              const buf = new Uint8Array(await file.arrayBuffer());
              let bin = "";
              for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
              await uploadFn({
                data: {
                  key: tenantKey,
                  setId,
                  filename: file.name,
                  contentType: file.type || "image/png",
                  dataBase64: btoa(bin),
                },
              });
            }
            toast.success(t("slides.uploaded"));
            refresh();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />

      <div className="space-y-2">
        {slides.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">{t("slides.empty")}</Card>
        ) : (
          slides.map((a, i, arr) => (
            <div
              key={a.id}
              className="space-y-2"
              onDragOver={(ev) => {
                if (!dragId) return;
                ev.preventDefault();
                ev.dataTransfer.dropEffect = "move";
                const r = ev.currentTarget.getBoundingClientRect();
                setOverIdx(ev.clientY - r.top > r.height / 2 ? i + 1 : i);
              }}
              onDrop={(ev) => {
                if (!dragId) return;
                ev.preventDefault();
                ev.stopPropagation();
                const r = ev.currentTarget.getBoundingClientRect();
                const idx = overIdx ?? (ev.clientY - r.top > r.height / 2 ? i + 1 : i);
                void reorderAt(dragId, idx);
                setOverIdx(null);
                setDragId(null);
              }}
            >
              <InsertMarker show={!!dragId && overIdx === i} />
              <Card
                draggable
                onDragStart={(ev) => {
                  setDragId(a.id);
                  ev.dataTransfer.effectAllowed = "move";
                  ev.dataTransfer.setData("text/plain", a.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverIdx(null);
                }}
                className={`flex items-center gap-4 p-3 cursor-grab active:cursor-grabbing ${
                  dragId === a.id ? "opacity-50" : ""
                }`}
              >

              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              {a.kind === "entries" ? (
                <div className="aspect-video w-28 shrink-0 rounded border bg-muted/40 flex items-center justify-center text-muted-foreground">
                  <CalendarClock className="h-7 w-7" />
                </div>
              ) : (
                <img
                  src={a.url ?? `/api/public/slide/${tenantKey}/${a.id}`}
                  alt={a.name}
                  draggable={false}
                  className="aspect-video h-auto w-28 shrink-0 rounded border bg-muted/40 object-contain"
                />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t("slides.duration")}:{" "}
                  {a.duration_seconds ?? (
                    <span className="opacity-50">{defaultSeconds}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditName(a.name);
                      setEditDuration(a.duration_seconds ? String(a.duration_seconds) : "");
                      setEditing(a.id);
                    }}
                  >
                    {t("slides.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={i === 0}
                    onClick={async () => {
                      await moveFn({ data: { key: tenantKey, id: a.id, direction: "up" } });
                      refresh();
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={i === arr.length - 1}
                    onClick={async () => {
                      await moveFn({ data: { key: tenantKey, id: a.id, direction: "down" } });
                      refresh();
                    }}
                  >
                    ↓
                  </Button>
                  {a.kind !== "entries" && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`/api/public/slide/${tenantKey}/${a.id}`} download={a.name}>
                        {t("slides.download")}
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm(t("slides.confirmDelete"))) return;
                      await deleteFn({ data: { key: tenantKey, id: a.id } });
                      toast.success(t("slides.deleted"));
                      refresh();
                    }}
                  >
                    {t("slides.delete")}
                  </Button>
                </div>
              </div>
            </Card>
              {i === arr.length - 1 ? (
                <InsertMarker show={!!dragId && overIdx === arr.length} />
              ) : null}
            </div>
          ))
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("slides.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>{t("slides.filename")}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("slides.duration")}</Label>
              <Input
                type="number"
                min={1}
                max={600}
                placeholder={String(defaultSeconds)}
                value={editDuration}
                onChange={(e) => setEditDuration(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("slides.durationHint")}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                {t("entries.cancel")}
              </Button>
              <Button
                onClick={async () => {
                  const name = editName.trim();
                  if (!name || !editing) return;
                  const value =
                    editDuration.trim() === ""
                      ? null
                      : Math.min(600, Math.max(1, Number(editDuration) || 1));
                  try {
                    await updateFn({
                      data: { key: tenantKey, id: editing, name, duration_seconds: value },
                    });
                    toast.success(t("slides.saved"));
                    setEditing(null);
                    refresh();
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                {t("entries.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

