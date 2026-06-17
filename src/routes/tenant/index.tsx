import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { setStoredTenantKey, getStoredTenantKey } from "@/lib/tenant-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/tenant/")({
  component: TenantGate,
});

function TenantGate() {
  const navigate = useNavigate();
  const [key, setKey] = useState(() => (typeof window !== "undefined" ? getStoredTenantKey() ?? "" : ""));

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold">Enter tenant key</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = key.trim();
            if (!t) return;
            setStoredTenantKey(t);
            navigate({ to: "/tenant/$tenantKey", params: { tenantKey: t } });
          }}
          className="space-y-3"
        >
          <Input
            placeholder="Tenant key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
          <Button type="submit" className="w-full" disabled={!key.trim()}>
            Open
          </Button>
        </form>
        <div className="text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:underline">
            Back
          </Link>
        </div>
      </Card>
    </div>
  );
}
