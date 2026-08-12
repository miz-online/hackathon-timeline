import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { GripVertical, CheckCircle2, Clock, History, BellOff, Lock, LogOut, X } from "lucide-react";
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
  listAds,
  uploadAd,
  deleteAd,
  moveAd,
  reorderAds,
  listAdSets,
  upsertAdSet,
  deleteAdSet,
  updateTenantTemplate,
  uploadEntryBackground,
  removeEntryBackground,
  ENTRY_BG_ALIGNMENTS,
  type EntryBgAlign,
} from "@/lib/board.functions";

import {
  getTenantAccess,
  unlockTenantAccess,
  lockTenantAccess,
  setTenantPin,
} from "@/lib/tenant-auth.functions";
import { ImportExportPanel } from "@/components/admin/ImportExportPanel";
import { WebhooksPanel } from "@/components/admin/WebhooksPanel";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";
import { derivePalette, DEFAULT_ACCENT } from "@/lib/colors";

const TABS = ["entries", "ads", "messages", "rooms", "colors", "settings", "io"] as const;
const ENTRY_HASHES = ["entries", "entries-all"] as const;

export const Route = createFileRoute("/tenant/$tenantKey/")({
  component: AdminPage,
});

type EntryRow = {
  id: string;
  time: string;
  end_time?: string | null;
  title: string;
  description: string;
  tags: string[];
  color_scheme_id: string | null;
  notify: boolean;
  sent?: boolean;
  background_url?: string | null;
  background_align?: EntryBgAlign | null;
  background_height?: number | null;
  background_opacity?: number | null;
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

/** Template options: the schedule plus one entry per ad set. */
export function useTemplateOptions(tenantKey: string) {
  const { t } = useI18n();
  const listSetsFn = useServerFn(listAdSets);
  const setsQ = useQuery({
    queryKey: ["adSets", tenantKey],
    queryFn: () => listSetsFn({ data: { key: tenantKey } }),
  });
  const sets = setsQ.data ?? [];
  return [
    { value: "zeitplan", label: t("settings.template.zeitplan") },
    ...sets.map((s) => ({ value: `ads:${s.id}`, label: `${t("settings.template.ads")}: ${s.name}` })),
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
        {!known && <option value={value}>{t("settings.template.ads")}</option>}
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

          <TabsContent value="colors" className="space-y-4 pt-4">
            <ColorSchemesPanel
              tenantKey={tenantKey}
              schemes={schemesQ.data ?? []}
              defaultColor={tenant.accent_color}
              onChange={invalidate}
            />
          </TabsContent>

          <TabsContent value="ads" className="space-y-4 pt-4">
            <AdsPanel tenantKey={tenantKey} onChange={invalidate} />
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
              adSeconds={tenant.ad_seconds}
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
    <div className="border-t pt-4 space-y-3">
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
  showExpired,
  onChange,
}: {
  tenantKey: string;
  entries: EntryRow[];
  rooms: RoomRow[];
  schemes: SchemeRow[];
  defaultColor: string;
  graceMinutes: number;
  showExpired: boolean;
  onChange: () => void;
}) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const upsertFn = useServerFn(upsertEntry);
  const deleteFn = useServerFn(deleteEntry);

  // Re-evaluate the expiry window every second so entries disappear on their own.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const now = nowTick;
  const graceMs = (graceMinutes || 0) * 60 * 1000;
  const visibleEntries = showExpired
    ? entries
    : entries.filter((e) => {
        if (e.end_time) return new Date(e.end_time).getTime() >= now;
        return new Date(e.time).getTime() + graceMs >= now;
      });
  const expiredCount = entries.length - visibleEntries.length;

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
      <div className="flex justify-between items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-lg font-medium">{t("entries.title")}</h2>
          {showExpired ? (
            <a
              href="#entries"
              className="text-sm text-primary underline hover:text-primary/80"
            >
              {t("entries.hideExpired")}
            </a>
          ) : expiredCount > 0 ? (
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
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            {t("entries.new")}
          </Button>
        </div>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-3 sm:max-w-3xl sm:p-3">
          <DialogHeader>
            <DialogTitle>{editing ? t("entries.edit") : t("entries.new")}</DialogTitle>
          </DialogHeader>
          {showForm ? (
            <EntryForm
              initial={editing}
              tenantKey={tenantKey}

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
            return (
            <div key={e.id} className="space-y-2">
            {showDay ? (
              <div className="flex items-center gap-3 pt-2 first:pt-0">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {new Date(e.time).toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <Card className="p-4 flex items-start justify-between gap-4">
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
                <div className="font-medium">{e.title}</div>
                {e.description ? (
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
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
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function EntryForm({
  initial,
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
  onSaved: () => void;

  onSubmit: (entry: {
    id?: string;
    time: string;
    end_time?: string | null;
    title: string;
    description: string;
    tags: string[];
    color_scheme_id: string | null;
    notify: boolean;
    background_align: EntryBgAlign;
    background_height: number;
    background_opacity: number;
  }) => Promise<string>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
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
  const [bgUrl, setBgUrl] = useState<string | null>(initial?.background_url ?? null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [bgRemoved, setBgRemoved] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const previewSrc = bgPreview ?? (bgRemoved ? null : bgUrl);


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

          {/* Background image */}
          <div className="space-y-2 border-t pt-3">
            <Label>{t("entries.form.bg")}</Label>
            <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted">
              {previewSrc ? (
                <img src={previewSrc} alt="" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t("entries.form.bgNone")}
                </div>
              )}
            </div>
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => bgInputRef.current?.click()}
              >
                {t("entries.form.bgUpload")}
              </Button>
              {bgUrl && !bgRemoved ? (
                <Button type="button" size="sm" variant="outline" asChild>
                  <a href={bgUrl} download target="_blank" rel="noreferrer">
                    {t("entries.form.bgDownload")}
                  </a>
                </Button>
              ) : null}
              {previewSrc ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setBgFile(null);
                    setBgPreview(null);
                    setBgRemoved(true);
                  }}
                >
                  {t("entries.form.bgRemove")}
                </Button>
              ) : null}
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
          </div>
        </div>


        {/* Right column (2): title, description, rooms */}
        <div className="col-span-1 sm:col-span-2 space-y-3">
          <div className="space-y-1">
            <Label>{t("entries.form.title")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("entries.form.titlePh")}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("entries.form.description")}</Label>
            <Textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("entries.form.descriptionPh")}
            />
          </div>
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
        </div>
      </div>
      </div>
      <div className="flex gap-2 justify-end shrink-0 border-t px-3 pt-3 bg-background">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("entries.cancel")}
        </Button>
        <Button
          disabled={saving || !title.trim() || !time}
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
                time: new Date(time).toISOString(),
                end_time: endMs != null ? new Date(endMs).toISOString() : null,
                title: title.trim(),
                description: description.trim(),
                tags,
                color_scheme_id: schemeId || null,
                notify,
                background_align: bgAlign,
                background_height: bgHeight,
                background_opacity: bgOpacity,
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
      <div className="flex justify-between items-center">
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
        {rooms.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center sm:col-span-2">
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
            <option value={tpl}>{t("settings.template.ads")}</option>
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
  adSeconds,
  onChange,
}: {
  tenantKey: string;
  name: string;
  logoUrl: string | null;
  logoHeight: number;
  accentColor: string;
  graceMinutes: number;
  template: string;
  adSeconds: number;
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [n, setN] = useState(name);
  const [g, setG] = useState(graceMinutes);
  
  const [adSec, setAdSec] = useState(adSeconds);
  const [lh, setLh] = useState(logoHeight);
  const [accent, setAccent] = useState(accentColor || DEFAULT_ACCENT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const updateFn = useServerFn(updateTenantSettings);
  const deleteFn = useServerFn(deleteTenant);

  const uploadLogoFn = useServerFn(uploadTenantLogo);
  const removeLogoFn = useServerFn(removeTenantLogo);
  const fileRef = useRef<HTMLInputElement>(null);

  const [logoBust, setLogoBust] = useState(0);
  const logoSrc = logoUrl ? `/api/public/logo/${tenantKey}?v=${logoBust}` : null;

  return (
    <Card className="p-4 space-y-5 max-w-xl">
      <div className="space-y-3">
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
        {/* Ad display duration is configured per ad set in the Ads tab. */}

      </div>

      <div className="border-t pt-4 space-y-2">
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
                    ad_seconds: adSec,
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
      </div>

      <div className="border-t pt-4 space-y-2">
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
      </div>

      <PinCard tenantKey={tenantKey} />

      <div className="border-t pt-4 space-y-2">
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
      </div>
    </Card>
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
      <div className="flex justify-between items-center">
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

// --------------- Ads ---------------

type AdSetRow = {
  id: string;
  ref_id?: string | null;
  name: string;
  ad_seconds: number;
  sort_order?: number;
};

/** Ad sets are fully separate; the tabs switch between them. */
function AdsPanel({ tenantKey, onChange }: { tenantKey: string; onChange: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listSetsFn = useServerFn(listAdSets);
  const upsertSetFn = useServerFn(upsertAdSet);
  const deleteSetFn = useServerFn(deleteAdSet);
  const [activeSet, setActiveSet] = useState<string | null>(null);

  const setsQ = useQuery({
    queryKey: ["adSets", tenantKey],
    queryFn: () => listSetsFn({ data: { key: tenantKey } }),
  });
  const sets: AdSetRow[] = setsQ.data ?? [];

  useEffect(() => {
    if (!sets.length) {
      setActiveSet(null);
      return;
    }
    if (!activeSet || !sets.some((s) => s.id === activeSet)) setActiveSet(sets[0].id);
  }, [sets, activeSet]);

  const current = sets.find((s) => s.id === activeSet) ?? null;
  const refreshSets = () => {
    qc.invalidateQueries({ queryKey: ["adSets", tenantKey] });
    onChange();
  };

  const [name, setName] = useState("");
  const [refId, setRefId] = useState("");
  const [seconds, setSeconds] = useState(10);
  useEffect(() => {
    setName(current?.name ?? "");
    setRefId(current?.ref_id ?? "");
    setSeconds(current?.ad_seconds ?? 10);
  }, [current?.id, current?.name, current?.ref_id, current?.ad_seconds]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">{t("adSets.title")}</h2>
        <Button
          size="sm"
          onClick={async () => {
            try {
              const res = await upsertSetFn({
                data: {
                  key: tenantKey,
                  set: {
                    name: `${t("adSets.newName")} ${sets.length + 1}`,
                    ref_id: null,
                    ad_seconds: 10,
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
          {t("adSets.new")}
        </Button>
      </div>

      {sets.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">{t("adSets.empty")}</Card>
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
                  <Label>{t("adSets.name")}</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t("adSets.seconds")}</Label>
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
                            ad_seconds: Math.min(600, Math.max(1, seconds || 10)),
                          },
                        },
                      });
                      toast.success(t("adSets.saved"));
                      refreshSets();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  {t("adSets.save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(t("adSets.confirmDelete"))) return;
                    try {
                      await deleteSetFn({ data: { key: tenantKey, id: current.id } });
                      toast.success(t("adSets.deleted"));
                      setActiveSet(null);
                      refreshSets();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  {t("adSets.delete")}
                </Button>
              </div>
            </Card>
          )}

          {current && <AdSetAds tenantKey={tenantKey} setId={current.id} onChange={onChange} />}
        </>
      )}
    </div>
  );
}

function AdSetAds({
  tenantKey,
  setId,
  onChange,
}: {
  tenantKey: string;
  setId: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listAds);
  const uploadFn = useServerFn(uploadAd);
  const deleteFn = useServerFn(deleteAd);
  const moveFn = useServerFn(moveAd);
  const reorderFn = useServerFn(reorderAds);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);

  useEffect(() => setOrder(null), [setId]);

  const adsQ = useQuery({
    queryKey: ["ads", tenantKey, setId],
    queryFn: () => listFn({ data: { key: tenantKey, setId } }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ads", tenantKey, setId] });
    onChange();
  };

  const raw = adsQ.data ?? [];
  const ads =
    order && order.length === raw.length
      ? order
          .map((id) => raw.find((a) => a.id === id))
          .filter((a): a is (typeof raw)[number] => !!a)
      : raw;

  const reorder = async (fromId: string, toId: string) => {
    const ids = ads.map((a) => a.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(ids);
    try {
      await reorderFn({ data: { key: tenantKey, ids } });
      refresh();
    } catch (e) {
      setOrder(null);
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">{t("ads.title")}</h2>
        <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {t("ads.upload")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("ads.hint")}</p>

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
                toast.error(t("ads.tooLarge"));
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
            toast.success(t("ads.uploaded"));
            refresh();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />

      <div className="space-y-2">
        {ads.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">{t("ads.empty")}</Card>
        ) : (
          ads.map((a, i, arr) => (
            <Card
              key={a.id}
              draggable
              onDragStart={() => setDragId(a.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(ev) => {
                ev.preventDefault();
                if (dragId && dragId !== a.id) setOverId(a.id);
              }}
              onDragLeave={() => setOverId((p) => (p === a.id ? null : p))}
              onDrop={(ev) => {
                ev.preventDefault();
                setOverId(null);
                if (dragId) reorder(dragId, a.id);
                setDragId(null);
              }}
              className={`flex items-center gap-4 p-3 cursor-grab active:cursor-grabbing ${
                dragId === a.id ? "opacity-50" : ""
              } ${overId === a.id ? "ring-2 ring-primary" : ""}`}
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <img
                src={a.url ?? `/api/public/ad/${tenantKey}/${a.id}`}
                alt={a.name}
                draggable={false}
                className="aspect-video h-auto w-28 shrink-0 rounded border bg-muted/40 object-contain"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="flex gap-2 flex-wrap">
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
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/api/public/ad/${tenantKey}/${a.id}`} download={a.name}>
                      {t("ads.download")}
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm(t("ads.confirmDelete"))) return;
                      await deleteFn({ data: { key: tenantKey, id: a.id } });
                      toast.success(t("ads.deleted"));
                      refresh();
                    }}
                  >
                    {t("ads.delete")}
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

