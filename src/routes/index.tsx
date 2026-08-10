import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createTenant } from "@/lib/board.functions";
import { setStoredTenantKey, getStoredTenantKey } from "@/lib/tenant-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Room Board" },
      { name: "description", content: "Time-based entries shown live on room display screens." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const create = useServerFn(createTenant);
  const [key, setKey] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  useEffect(() => {
    const stored = getStoredTenantKey();
    if (stored) setKey((k) => (k ? k : stored));
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await create({ data: { pin: pin.trim() || undefined } });
      setStoredTenantKey(res.key);
      setNewKey(res.key);
    } finally {
      setCreating(false);
    }
  };

  const handleEnter = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setStoredTenantKey(trimmed);
    navigate({ to: "/tenant/$tenantKey", params: { tenantKey: trimmed } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{t("app.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("app.tagline")}</p>
        </div>

        {newKey ? (
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">{t("home.keyTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("home.keyBlurb")}</p>
            <div className="font-mono text-sm break-all rounded-md border bg-muted px-3 py-2">
              {newKey}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void navigator.clipboard?.writeText(newKey)}
              >
                {t("home.copy")}
              </Button>
              <Button
                className="flex-1"
                onClick={() =>
                  navigate({ to: "/tenant/$tenantKey", params: { tenantKey: newKey } })
                }
              >
                {t("home.continue")}
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">{t("home.openTitle")}</h2>
              <form onSubmit={handleEnter} className="space-y-3">
                <Input
                  placeholder={t("home.openPlaceholder")}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                />
                <Button type="submit" className="w-full" disabled={!key.trim()}>
                  {t("home.open")}
                </Button>
              </form>
            </Card>

            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">{t("home.createTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("home.createBlurb")}</p>
              <div className="space-y-1 text-left">
                <label className="text-sm font-medium">{t("home.pin")}</label>
                <Input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <Button onClick={handleCreate} disabled={creating} className="w-full">
                {creating ? t("home.creating") : t("home.create")}
              </Button>
            </Card>
          </>
        )}

        <div className="text-center text-xs text-muted-foreground">
          <Link to="/" className="underline-offset-2 hover:underline">
            {t("nav.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
