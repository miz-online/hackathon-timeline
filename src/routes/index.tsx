import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createTenant } from "@/lib/board.functions";
import { setStoredTenantKey, getStoredTenantKey } from "@/lib/tenant-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

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
  const create = useServerFn(createTenant);
  const [key, setKey] = useState(() => (typeof window !== "undefined" ? getStoredTenantKey() ?? "" : ""));
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await create();
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
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Room Board</h1>
          <p className="text-sm text-muted-foreground">
            Live time-based entries on display screens, no accounts needed.
          </p>
        </div>

        {newKey ? (
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Your tenant key</h2>
            <p className="text-sm text-muted-foreground">
              Save this somewhere safe. Anyone with the key can manage entries and rooms. It will not
              be shown again.
            </p>
            <div className="font-mono text-sm break-all rounded-md border bg-muted px-3 py-2">
              {newKey}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void navigator.clipboard?.writeText(newKey)}
              >
                Copy
              </Button>
              <Button
                className="flex-1"
                onClick={() => navigate({ to: "/tenant/$tenantKey", params: { tenantKey: newKey } })}
              >
                Continue
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">Open existing tenant</h2>
              <form onSubmit={handleEnter} className="space-y-3">
                <Input
                  placeholder="Enter your tenant key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                />
                <Button type="submit" className="w-full" disabled={!key.trim()}>
                  Open
                </Button>
              </form>
            </Card>

            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">Create new tenant</h2>
              <p className="text-sm text-muted-foreground">
                Generates a random key. Share it with anyone who should administer this org.
              </p>
              <Button onClick={handleCreate} disabled={creating} className="w-full">
                {creating ? "Creating…" : "Create tenant"}
              </Button>
            </Card>
          </>
        )}

        <div className="text-center text-xs text-muted-foreground">
          <Link to="/" className="underline-offset-2 hover:underline">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
