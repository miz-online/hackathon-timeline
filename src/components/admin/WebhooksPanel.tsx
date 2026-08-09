import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  listWebhooks,
  upsertWebhook,
  deleteWebhook,
  testWebhook,
  sendWebhookMessage,
} from "@/lib/board.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefIdField } from "@/routes/tenant/$tenantKey";

type WebhookListItem = Awaited<ReturnType<typeof listWebhooks>>[number];

export function WebhooksPanel({
  tenantKey,
  schemes,
  defaultColor,
  onChange,
}: {
  tenantKey: string;
  schemes: { id: string; ref_id?: string | null; name: string; color: string }[];
  defaultColor: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const listFn = useServerFn(listWebhooks);
  const { data: webhooks, refetch } = useQuery({
    queryKey: ["webhooks", tenantKey],
    queryFn: () => listFn({ data: { key: tenantKey } }),
  });

  const deleteFn = useServerFn(deleteWebhook);
  const testFn = useServerFn(testWebhook);

  const [editing, setEditing] = useState<WebhookListItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { key: tenantKey, id } }),
    onSuccess: () => {
      toast.success(t("messages.deleted"));
      refetch();
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => testFn({ data: { key: tenantKey, id } }),
    onSuccess: () => toast.success(t("messages.testSent")),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <DirectMessagePanel
        tenantKey={tenantKey}
        webhooks={webhooks ?? []}
        schemes={schemes}
        defaultColor={defaultColor}
      />

      <div className="space-y-2 border-t pt-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">{t("messages.configTitle")}</h2>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("messages.new")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t("messages.hint")}</p>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("messages.editWebhook") : t("messages.new")}</DialogTitle>
          </DialogHeader>
          <WebhookForm
            tenantKey={tenantKey}
            initial={editing}
            onCancel={() => setFormOpen(false)}
            onSaved={() => {
              setFormOpen(false);
              refetch();
              onChange();
            }}
          />
        </DialogContent>
      </Dialog>

      <div className="space-y-2">
        {(webhooks ?? []).length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">
            {t("messages.noWebhooks")}
          </Card>
        ) : (
          (webhooks ?? []).map((w) => (
            <Card key={w.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  {w.name}
                  <span className="text-xs text-muted-foreground">
                    {t("messages.type.discord")}
                  </span>
                  {!w.enabled ? (
                    <span className="text-xs text-muted-foreground">
                      ({t("messages.enabled")}: off)
                    </span>
                  ) : null}
                </div>
                {w.ref_id ? (
                  <div className="text-xs text-muted-foreground">Id: {w.ref_id}</div>
                ) : null}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => testMut.mutate(w.id)}>
                  {t("messages.test")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(w);
                    setFormOpen(true);
                  }}
                >
                  {t("entries.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(t("messages.confirmDelete"))) deleteMut.mutate(w.id);
                  }}
                >
                  {t("messages.delete")}
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function WebhookForm({
  tenantKey,
  initial,
  onCancel,
  onSaved,
}: {
  tenantKey: string;
  initial: WebhookListItem | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const upsertFn = useServerFn(upsertWebhook);
  const [name, setName] = useState(initial?.name ?? "");
  const [refId, setRefId] = useState(initial?.ref_id ?? "");
  const [type, setType] = useState<"discord">((initial?.type as "discord") ?? "discord");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [url, setUrl] = useState("");

  useEffect(() => {
    setName(initial?.name ?? "");
    setRefId(initial?.ref_id ?? "");
    setType((initial?.type as "discord") ?? "discord");
    setEnabled(initial?.enabled ?? true);
    setUrl("");
  }, [initial]);

  const upsertMut = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          key: tenantKey,
          webhook: {
            id: initial?.id,
            ref_id: refId,
            name,
            type,
            enabled,
            url: url.trim() || undefined,
          },
        },
      }),
    onSuccess: () => {
      toast.success(t("messages.saved"));
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t("messages.name")}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <RefIdField value={refId} onChange={setRefId} name={name} />
      <div className="space-y-1">
        <Label>{t("messages.type")}</Label>
        <Tabs value={type} onValueChange={(v) => setType(v as "discord")}>
          <TabsList>
            <TabsTrigger value="discord">{t("messages.type.discord")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="space-y-1">
        <Label>{t("messages.url")}</Label>
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            initial?.has_url ? t("messages.urlSaved") : "https://discord.com/api/webhooks/…"
          }
        />
        {initial?.has_url ? (
          <p className="text-xs text-muted-foreground">{t("messages.urlHint")}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="webhook-enabled"
          checked={enabled}
          onCheckedChange={(c) => setEnabled(c === true)}
        />
        <Label htmlFor="webhook-enabled" className="text-sm font-normal">
          {t("messages.enabled")}
        </Label>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>
          {t("entries.cancel")}
        </Button>
        <Button disabled={!name.trim() || upsertMut.isPending} onClick={() => upsertMut.mutate()}>
          {t("messages.save")}
        </Button>
      </div>
    </div>
  );
}

function DirectMessagePanel({
  tenantKey,
  webhooks,
  schemes,
  defaultColor,
}: {
  tenantKey: string;
  webhooks: WebhookListItem[];
  schemes: { id: string; ref_id?: string | null; name: string; color: string }[];
  defaultColor: string;
}) {
  const { t } = useI18n();
  const sendFn = useServerFn(sendWebhookMessage);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [schemeId, setSchemeId] = useState("");

  const activeCount = webhooks.filter((w) => w.enabled).length;

  const sendMut = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          key: tenantKey,
          message: {
            title: title.trim(),
            description: description.trim(),
            color: schemes.find((s) => s.id === schemeId)?.color ?? defaultColor,
          },
        },
      }),
    onSuccess: (res) => {
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success(t("messages.sent"));
      } else {
        toast.error(failed.map((f) => `${f.name}: ${f.error ?? ""}`).join("\n"));
      }
      setTitle("");
      setDescription("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-4 space-y-4">
      <h2 className="text-lg font-medium">{t("messages.sendTitle")}</h2>
      <p className="text-sm text-muted-foreground">
        {activeCount === 0 ? t("messages.noActive") : t("messages.sendHint")}
      </p>
      <div className="space-y-1">
        <Label>{t("entries.form.title")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("messages.sendTitlePh")}
        />
      </div>
      <div className="space-y-1">
        <Label>{t("entries.form.description")}</Label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("messages.sendDescriptionPh")}
          className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm"
        />
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
      </div>
      <div className="flex justify-end">
        <Button
          disabled={!title.trim() || activeCount === 0 || sendMut.isPending}
          onClick={() => sendMut.mutate()}
        >
          {t("messages.send")}
        </Button>
      </div>
    </Card>
  );
}
