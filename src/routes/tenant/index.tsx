import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { setStoredTenantKey, getStoredTenantKey } from "@/lib/tenant-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/tenant/")({
  component: TenantGate,
});

function TenantGate() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [key, setKey] = useState(() =>
    typeof window !== "undefined" ? getStoredTenantKey() ?? "" : "",
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold">{t("tenant.gate.title")}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = key.trim();
            if (!trimmed) return;
            setStoredTenantKey(trimmed);
            navigate({ to: "/tenant/$tenantKey", params: { tenantKey: trimmed } });
          }}
          className="space-y-3"
        >
          <Input
            placeholder={t("tenant.gate.placeholder")}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
          <Button type="submit" className="w-full" disabled={!key.trim()}>
            {t("home.open")}
          </Button>
        </form>
        <div className="text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:underline">
            {t("nav.back")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
