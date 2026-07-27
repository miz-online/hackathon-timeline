import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
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
  regenerateKey,
} from "@/lib/board.functions";
import { setStoredTenantKey } from "@/lib/tenant-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

export const Route = createFileRoute("/tenant/$tenantKey/")({
  component: AdminPage,
});

type EntryRow = { id: string; time: string; title: string; description: string; tags: string[] };
type RoomRow = { id: string; name: string };

function AdminPage() {
  const { tenantKey } = Route.useParams();
  const qc = useQueryClient();
  const { t } = useI18n();

  const getTenantFn = useServerFn(getTenant);
  const listEntriesFn = useServerFn(listEntries);
  const listRoomsFn = useServerFn(listRooms);

  const tenantQ = useQuery({
    queryKey: ["tenant", tenantKey],
    queryFn: () => getTenantFn({ data: { key: tenantKey } }),
  });
  const entriesQ = useQuery({
    queryKey: ["entries", tenantKey],
    queryFn: () => listEntriesFn({ data: { key: tenantKey } }),
    enabled: !!tenantQ.data,
  });
  const roomsQ = useQuery({
    queryKey: ["rooms", tenantKey],
    queryFn: () => listRoomsFn({ data: { key: tenantKey } }),
    enabled: !!tenantQ.data,
  });

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
          <div className="flex gap-2 items-center">
            <LanguageSwitcher />
            <Link to="/tenant/$tenantKey/rooms" params={{ tenantKey }}>
              <Button variant="outline" size="sm">
                {t("nav.rooms")}
              </Button>
            </Link>
            <Link to="/">
              <Button variant="ghost" size="sm">
                {t("nav.exit")}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <Tabs defaultValue="entries">
          <TabsList>
            <TabsTrigger value="entries">{t("admin.tabs.entries")}</TabsTrigger>
            <TabsTrigger value="rooms">{t("admin.tabs.rooms")}</TabsTrigger>
            <TabsTrigger value="settings">{t("admin.tabs.settings")}</TabsTrigger>
          </TabsList>

          <TabsContent value="entries" className="space-y-4 pt-4">
            <EntriesPanel
              tenantKey={tenantKey}
              entries={entriesQ.data ?? []}
              rooms={roomsQ.data ?? []}
              onChange={invalidate}
            />
          </TabsContent>

          <TabsContent value="rooms" className="space-y-4 pt-4">
            <RoomsPanel
              tenantKey={tenantKey}
              rooms={roomsQ.data ?? []}
              onChange={invalidate}
            />
          </TabsContent>

          <TabsContent value="settings" className="space-y-4 pt-4">
            <SettingsPanel
              tenantKey={tenantKey}
              name={tenant.name}
              logoUrl={tenant.logo_url}
              graceMinutes={tenant.past_grace_minutes}
              template={tenant.template}
              onChange={invalidate}
            />
          </TabsContent>
        </Tabs>
      </main>
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
  onChange,
}: {
  tenantKey: string;
  entries: EntryRow[];
  rooms: RoomRow[];
  onChange: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const upsertFn = useServerFn(upsertEntry);
  const deleteFn = useServerFn(deleteEntry);

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
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">{t("entries.title")}</h2>
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

      {showForm ? (
        <EntryForm
          initial={editing}
          rooms={rooms}
          onCancel={() => setShowForm(false)}
          onSubmit={async (entry) => {
            await upsertFn({ data: { key: tenantKey, entry } });
            toast.success(editing ? t("entries.updated") : t("entries.created"));
            setShowForm(false);
            onChange();
          }}
        />
      ) : null}

      <div className="space-y-2">
        {entries.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">
            {t("entries.empty")}
          </Card>
        ) : (
          entries.map((e) => (
            <Card key={e.id} className="p-4 flex items-start justify-between gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold">
                    {new Date(e.time).toLocaleString([], {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
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
          ))
        )}
      </div>
    </div>
  );
}

function EntryForm({
  initial,
  rooms,
  onSubmit,
  onCancel,
}: {
  initial: EntryRow | null;
  rooms: RoomRow[];
  onSubmit: (entry: {
    id?: string;
    time: string;
    title: string;
    description: string;
    tags: string[];
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [time, setTime] = useState(
    initial ? toLocalInput(initial.time) : toLocalInput(new Date().toISOString()),
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [selectedRooms, setSelectedRooms] = useState<string[]>(initial?.tags ?? []);
  const [saving, setSaving] = useState(false);

  const toggleRoom = (name: string) => {
    setSelectedRooms((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>{t("entries.form.time")}</Label>
          <Input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>{t("entries.form.title")}</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("entries.form.titlePh")}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>{t("entries.form.description")}</Label>
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("entries.form.descriptionPh")}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("entries.form.rooms")}</Label>
        <div className="flex flex-wrap gap-2">
          {rooms.length === 0 ? (
            <span className="text-xs italic text-muted-foreground">
              {t("entries.allRooms")}
            </span>
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
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("entries.cancel")}
        </Button>
        <Button
          disabled={saving || !title.trim() || !time}
          onClick={async () => {
            setSaving(true);
            try {
              // Drop any selected room names that no longer exist
              const validNames = new Set(rooms.map((r) => r.name));
              const tags = selectedRooms.filter((n) => validNames.has(n));
              await onSubmit({
                id: initial?.id,
                time: new Date(time).toISOString(),
                title: title.trim(),
                description: description.trim(),
                tags,
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
    </Card>
  );
}

// --------------- Rooms ---------------

function RoomsPanel({
  tenantKey,
  rooms,
  onChange,
}: {
  tenantKey: string;
  rooms: RoomRow[];
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

      {showForm ? (
        <RoomForm
          initial={editing}
          onCancel={() => setShowForm(false)}
          onSubmit={async (room) => {
            await upsertFn({ data: { key: tenantKey, room } });
            toast.success(editing ? t("rooms.updated") : t("rooms.created"));
            setShowForm(false);
            onChange();
          }}
        />
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {rooms.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center sm:col-span-2">
            {t("rooms.empty")}
          </Card>
        ) : (
          rooms.map((r) => (
            <Card key={r.id} className="p-4 space-y-2">
              <div className="font-semibold truncate">{r.name}</div>
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
  onSubmit,
  onCancel,
}: {
  initial: RoomRow | null;
  onSubmit: (room: { id?: string; name: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <Card className="p-4 space-y-3">
      <div className="space-y-1">
        <Label>{t("rooms.form.name")}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("rooms.form.namePh")}
        />
        <p className="text-xs text-muted-foreground">{t("rooms.form.nameHint")}</p>
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
              await onSubmit({ id: initial?.id, name: name.trim() });
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
    </Card>
  );
}

// --------------- Settings ---------------

function SettingsPanel({
  tenantKey,
  name,
  logoUrl,
  graceMinutes,
  template,
  onChange,
}: {
  tenantKey: string;
  name: string;
  logoUrl: string | null;
  graceMinutes: number;
  template: string;
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const [n, setN] = useState(name);
  const [g, setG] = useState(graceMinutes);
  const [tpl, setTpl] = useState(template);
  const [saving, setSaving] = useState(false);
  const updateFn = useServerFn(updateTenantSettings);
  const regenFn = useServerFn(regenerateKey);
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
          <Label>{t("settings.grace")}</Label>
          <Input
            type="number"
            min={0}
            max={1440}
            value={g}
            onChange={(e) => setG(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("settings.template")}</Label>
          <select
            value={tpl}
            onChange={(e) => setTpl(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="zeitplan">{t("settings.template.zeitplan")}</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>{t("settings.language")}</Label>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as "en" | "de")}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </div>
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await updateFn({
                data: {
                  key: tenantKey,
                  name: n,
                  past_grace_minutes: g,
                  template: tpl,
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

      <div className="border-t pt-4 space-y-2">
        <Label>{t("settings.logo")}</Label>
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
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!confirm(t("settings.regenerateConfirm"))) return;
              const res = await regenFn({ data: { key: tenantKey } });
              setStoredTenantKey(res.key);
              toast.success(t("settings.regenerated"));
              navigate({ to: "/tenant/$tenantKey", params: { tenantKey: res.key } });
            }}
          >
            {t("settings.regenerate")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
