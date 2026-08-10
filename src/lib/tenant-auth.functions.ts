import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function tenantByKey(key: string) {
  const supabase = await getAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, pin_hash")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unknown tenant key");
  return data;
}

const keyInput = (data: { key: string }) => z.object({ key: z.string().min(1) }).parse(data);

export const getTenantAccess = createServerFn({ method: "GET" })
  .inputValidator(keyInput)
  .handler(async ({ data }) => {
    const tenant = await tenantByKey(data.key);
    const { isTenantUnlocked } = await import("@/lib/tenant-auth.server");
    const isProtected = !!tenant.pin_hash;
    const unlocked = isProtected ? await isTenantUnlocked(tenant.id) : true;
    return { protected: isProtected, unlocked };
  });

export const unlockTenantAccess = createServerFn({ method: "POST" })
  .inputValidator((data: { key: string; pin: string }) =>
    z.object({ key: z.string().min(1), pin: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const tenant = await tenantByKey(data.key);
    const { verifyPin, markTenantUnlocked } = await import("@/lib/tenant-auth.server");
    if (!tenant.pin_hash) return { ok: true as const };
    const ok = await verifyPin(data.pin, tenant.pin_hash);
    if (!ok) return { ok: false as const };
    await markTenantUnlocked(tenant.id);
    return { ok: true as const };
  });

export const lockTenantAccess = createServerFn({ method: "POST" })
  .inputValidator(keyInput)
  .handler(async ({ data }) => {
    const tenant = await tenantByKey(data.key);
    const { lockTenant } = await import("@/lib/tenant-auth.server");
    await lockTenant(tenant.id);
    return { ok: true as const };
  });

export const setTenantPin = createServerFn({ method: "POST" })
  .inputValidator((data: { key: string; currentPin?: string; newPin: string }) =>
    z
      .object({
        key: z.string().min(1),
        currentPin: z.string().optional(),
        newPin: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const tenant = await tenantByKey(data.key);
    const { verifyPin, hashPin, isTenantUnlocked, markTenantUnlocked, lockTenant } = await import(
      "@/lib/tenant-auth.server"
    );

    if (tenant.pin_hash) {
      const unlocked = await isTenantUnlocked(tenant.id);
      const currentOk =
        (data.currentPin ? await verifyPin(data.currentPin, tenant.pin_hash) : false) || unlocked;
      if (!currentOk) throw new Error("Invalid PIN");
    }

    const supabase = await getAdmin();
    const next = data.newPin.trim() ? await hashPin(data.newPin) : null;
    const { error } = await supabase.from("tenants").update({ pin_hash: next }).eq("id", tenant.id);
    if (error) throw new Error(error.message);

    if (next) await markTenantUnlocked(tenant.id);
    else await lockTenant(tenant.id);
    return { protected: !!next };
  });
