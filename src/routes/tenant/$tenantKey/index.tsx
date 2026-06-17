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

export const Route = createFileRoute("/tenant/$tenantKey/")({
  component: AdminPage,
});

function AdminPage() {
  const { tenantKey } = Route.useParams();
  const qc = useQueryClient();

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
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (tenantQ.error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="p-6 max-w-md space-y-3 text-center">
          <h2 className="text-lg font-semibold">Unknown tenant key</h2>
          <p className="text-sm text-muted-foreground">
            The key in the URL doesn’t match any tenant.
          </p>
          <Link to="/" className="text-sm underline">
            Back to start
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
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Admin</div>
            <h1 className="text-xl font-semibold">{tenant.name}</h1>
          </div>
          <div className="flex gap-2">
            <Link to="/tenant/$tenantKey/rooms" params={{ tenantKey }}>
              <Button variant="outline" size="sm">
                Rooms
              </Button>
            </Link>
            <Link to="/">
              <Button variant="ghost" size="sm">
                Exit
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <Tabs defaultValue="entries">
          <TabsList>
            <TabsTrigger value="entries">Entries</TabsTrigger>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="entries" className="space-y-4 pt-4">
            <EntriesPanel
              tenantKey={tenantKey}
              entries={entriesQ.data ?? []}
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
              graceMinutes={tenant.past_grace_minutes}
              onChange={invalidate}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// --------------- Entries ---------------

type EntryRow = { id: string; time: string; description: string; tags: string[] };

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EntriesPanel({
  tenantKey,
  entries,
  onChange,
}: {
  tenantKey: string;
  entries: EntryRow[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const upsertFn = useServerFn(upsertEntry);
  const deleteFn = useServerFn(deleteEntry);

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { key: tenantKey, id } }),
    onSuccess: () => {
      toast.success("Entry deleted");
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Time entries</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          New entry
        </Button>
      </div>

      {showForm ? (
        <EntryForm
          initial={editing}
          onCancel={() => setShowForm(false)}
          onSubmit={async (entry) => {
            await upsertFn({ data: { key: tenantKey, entry } });
            toast.success(editing ? "Entry updated" : "Entry created");
            setShowForm(false);
            onChange();
          }}
        />
      ) : null}

      <div className="space-y-2">
        {entries.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">
            No entries yet.
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
                  {e.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
                <div className="text-sm whitespace-pre-wrap break-words">{e.description}</div>
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
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Delete this entry?")) delMut.mutate(e.id);
                  }}
                >
                  Delete
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
  onSubmit,
  onCancel,
}: {
  initial: EntryRow | null;
  onSubmit: (entry: { id?: string; time: string; description: string; tags: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [time, setTime] = useState(initial ? toLocalInput(initial.time) : toLocalInput(new Date().toISOString()));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(", "));
  const [saving, setSaving] = useState(false);

  return (
    <Card className="p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Time</Label>
          <Input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Tags (comma separated, leave empty for all rooms)</Label>
          <Input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="lobby, stage"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Description (first line = title, rest = detail)</Label>
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Begrüßung der Teilnehmer:innen"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          disabled={saving || !description.trim() || !time}
          onClick={async () => {
            setSaving(true);
            try {
              const tags = tagsText
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              await onSubmit({
                id: initial?.id,
                time: new Date(time).toISOString(),
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
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

// --------------- Rooms ---------------

type RoomRow = { id: string; name: string; tag: string; template: string };

function RoomsPanel({
  tenantKey,
  rooms,
  onChange,
}: {
  tenantKey: string;
  rooms: RoomRow[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<RoomRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const upsertFn = useServerFn(upsertRoom);
  const deleteFn = useServerFn(deleteRoom);

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { key: tenantKey, id } }),
    onSuccess: () => {
      toast.success("Room deleted");
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Rooms</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          New room
        </Button>
      </div>

      {showForm ? (
        <RoomForm
          initial={editing}
          onCancel={() => setShowForm(false)}
          onSubmit={async (room) => {
            await upsertFn({ data: { key: tenantKey, room } });
            toast.success(editing ? "Room updated" : "Room created");
            setShowForm(false);
            onChange();
          }}
        />
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {rooms.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center sm:col-span-2">
            No rooms yet.
          </Card>
        ) : (
          rooms.map((r) => (
            <Card key={r.id} className="p-4 space-y-2">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    tag: <span className="font-mono">{r.tag}</span> · template:{" "}
                    <span className="font-mono">{r.template}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Link
                  to="/tenant/$tenantKey/room/$roomId"
                  params={{ tenantKey, roomId: r.id }}
                  target="_blank"
                >
                  <Button size="sm" variant="default">
                    Open display
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
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Delete this room?")) delMut.mutate(r.id);
                  }}
                >
                  Delete
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
  onSubmit: (room: { id?: string; name: string; tag: string; template: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [tag, setTag] = useState(initial?.tag ?? "");
  const [template, setTemplate] = useState(initial?.template ?? "zeitplan");
  const [saving, setSaving] = useState(false);

  return (
    <Card className="p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Stage" />
        </div>
        <div className="space-y-1">
          <Label>Tag</Label>
          <Input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="stage"
          />
        </div>
        <div className="space-y-1">
          <Label>Template</Label>
          <Input
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="zeitplan"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          disabled={saving || !name.trim() || !tag.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              await onSubmit({
                id: initial?.id,
                name: name.trim(),
                tag: tag.trim(),
                template: template.trim() || "zeitplan",
              });
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

// --------------- Settings ---------------

function SettingsPanel({
  tenantKey,
  name,
  graceMinutes,
  onChange,
}: {
  tenantKey: string;
  name: string;
  graceMinutes: number;
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const [n, setN] = useState(name);
  const [g, setG] = useState(graceMinutes);
  const [saving, setSaving] = useState(false);
  const updateFn = useServerFn(updateTenantSettings);
  const regenFn = useServerFn(regenerateKey);

  return (
    <Card className="p-4 space-y-5 max-w-xl">
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Organization name</Label>
          <Input value={n} onChange={(e) => setN(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Past entry grace (minutes)</Label>
          <Input
            type="number"
            min={0}
            max={1440}
            value={g}
            onChange={(e) => setG(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Entries disappear from displays after this many minutes past their time.
          </p>
        </div>
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await updateFn({ data: { key: tenantKey, name: n, past_grace_minutes: g } });
              toast.success("Settings saved");
              onChange();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>

      <div className="border-t pt-4 space-y-2">
        <div className="font-medium">Tenant key</div>
        <div className="font-mono text-xs break-all rounded-md border bg-muted px-3 py-2">
          {tenantKey}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(tenantKey)}
          >
            Copy
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (
                !confirm(
                  "Regenerate the tenant key? The old key will stop working immediately. Make sure to save the new one.",
                )
              )
                return;
              const res = await regenFn({ data: { key: tenantKey } });
              setStoredTenantKey(res.key);
              alert(`New key:\n\n${res.key}\n\nSave it now. It will not be shown again.`);
              navigate({ to: "/tenant/$tenantKey", params: { tenantKey: res.key } });
            }}
          >
            Regenerate key
          </Button>
        </div>
      </div>
    </Card>
  );
}
