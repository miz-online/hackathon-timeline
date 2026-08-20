import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { toast } from "sonner";

import { listTeams, upsertTeam, deleteTeam, reorderTeams } from "@/lib/board.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { slugify } from "@/lib/ref-id";

type TeamRow = {
  id: string;
  ref_id?: string | null;
  name: string;
  members: string;
  project: string;
  room_id: string | null;
};

type RoomLike = { id: string; name: string; color_scheme_id?: string | null };
type SchemeLike = { id: string; name: string; color: string };

export function TeamsPanel({
  tenantKey,
  rooms,
  schemes,
  defaultColor,
  onChange,
}: {
  tenantKey: string;
  rooms: RoomLike[];
  schemes: SchemeLike[];
  defaultColor: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listTeams);
  const upsertFn = useServerFn(upsertTeam);
  const deleteFn = useServerFn(deleteTeam);
  const reorderFn = useServerFn(reorderTeams);

  const [editing, setEditing] = useState<TeamRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);

  const teamsQ = useQuery({
    queryKey: ["teams", tenantKey],
    queryFn: () => listFn({ data: { key: tenantKey } }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["teams", tenantKey] });
    onChange();
  };

  const raw = (teamsQ.data ?? []) as TeamRow[];
  const teams =
    order && order.length === raw.length
      ? order.map((id) => raw.find((x) => x.id === id)).filter((x): x is TeamRow => !!x)
      : raw;

  const colorOf = (team: TeamRow) => {
    const room = rooms.find((r) => r.id === team.room_id);
    const scheme = room?.color_scheme_id
      ? schemes.find((s) => s.id === room.color_scheme_id)
      : undefined;
    return scheme?.color ?? defaultColor;
  };

  const applyOrder = async (ids: string[]) => {
    setOrder(ids);
    try {
      await reorderFn({ data: { key: tenantKey, ids } });
      refresh();
    } catch (e) {
      setOrder(null);
      toast.error((e as Error).message);
    }
  };

  const move = (id: string, dir: -1 | 1) => {
    const ids = teams.map((x) => x.id);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    void applyOrder(ids);
  };

  const drop = (fromId: string, toId: string) => {
    const ids = teams.map((x) => x.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    void applyOrder(ids);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t("teams.title")}</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          {t("teams.new")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("teams.hint")}</p>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("teams.edit") : t("teams.new")}</DialogTitle>
          </DialogHeader>
          {showForm ? (
            <TeamForm
              initial={editing}
              rooms={rooms}
              onCancel={() => setShowForm(false)}
              onSubmit={async (team) => {
                await upsertFn({ data: { key: tenantKey, team } });
                toast.success(editing ? t("teams.updated") : t("teams.created"));
                setShowForm(false);
                setOrder(null);
                refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {teams.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{t("teams.empty")}</Card>
      ) : (
        <div className="space-y-2">
          {teams.map((team, idx) => (
            <Card
              key={team.id}
              draggable
              onDragStart={() => setDragId(team.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(ev) => {
                if (dragId && dragId !== team.id) ev.preventDefault();
              }}
              onDrop={(ev) => {
                ev.preventDefault();
                if (dragId) drop(dragId, team.id);
                setDragId(null);
              }}
              className={`flex items-start gap-3 p-4 ${dragId === team.id ? "opacity-50" : ""}`}
            >
              <GripVertical className="mt-1 h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
              <span
                className="mt-1 h-4 w-4 shrink-0 rounded-full border"
                style={{ backgroundColor: colorOf(team) }}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{team.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {rooms.find((r) => r.id === team.room_id)?.name ?? t("teams.noRoom")}
                  </span>
                </div>
                {team.members ? (
                  <div className="text-sm text-muted-foreground break-words">{team.members}</div>
                ) : null}
                {team.project ? (
                  <div className="whitespace-pre-wrap break-words text-sm">{team.project}</div>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={idx === 0}
                  aria-label={t("teams.moveUp")}
                  onClick={() => move(team.id, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={idx === teams.length - 1}
                  aria-label={t("teams.moveDown")}
                  onClick={() => move(team.id, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(team);
                    setShowForm(true);
                  }}
                >
                  {t("teams.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(t("teams.confirmDelete"))) return;
                    try {
                      await deleteFn({ data: { key: tenantKey, id: team.id } });
                      toast.success(t("teams.deleted"));
                      setOrder(null);
                      refresh();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  {t("teams.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamForm({
  initial,
  rooms,
  onSubmit,
  onCancel,
}: {
  initial: TeamRow | null;
  rooms: RoomLike[];
  onSubmit: (team: {
    id?: string;
    ref_id: string | null;
    name: string;
    members: string;
    project: string;
    room_id: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [refId, setRefId] = useState(initial?.ref_id ?? "");
  const [members, setMembers] = useState(initial?.members ?? "");
  const [project, setProject] = useState(initial?.project ?? "");
  const [roomId, setRoomId] = useState(initial?.room_id ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t("teams.form.name")}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>{t("refId.label")}</Label>
        <Input
          value={refId}
          onChange={(e) => setRefId(e.target.value)}
          placeholder={slugify(name) || t("refId.placeholder")}
        />
        <p className="text-xs text-muted-foreground">{t("refId.hint")}</p>
      </div>
      <div className="space-y-1">
        <Label>{t("teams.form.members")}</Label>
        <Input
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          placeholder={t("teams.form.membersPh")}
        />
        <p className="text-xs text-muted-foreground">{t("teams.form.membersHint")}</p>
      </div>
      <div className="space-y-1">
        <Label>{t("teams.form.project")}</Label>
        <Textarea rows={4} value={project} onChange={(e) => setProject(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>{t("teams.form.room")}</Label>
        <select
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">{t("teams.noRoom")}</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t("teams.form.roomHint")}</p>
      </div>
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("entries.cancel")}
        </Button>
        <Button
          disabled={saving || !name.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              await onSubmit({
                id: initial?.id,
                ref_id: refId.trim() ? refId.trim() : null,
                name: name.trim(),
                members: members.trim(),
                project: project.trim(),
                room_id: roomId || null,
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
