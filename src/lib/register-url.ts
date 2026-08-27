import { roomTokenVariant } from "@/lib/registration";

/**
 * Replaces the base registration token of `register` entries with the
 * room-specific variant, so each display shows its own code and the server can
 * recalculate the scanned room. The overview room keeps the base token.
 */
export async function withRoomRegisterTokens<
  T extends { kind?: string | null; register_token?: string | null },
>(entries: T[], roomId: string, isOverview: boolean): Promise<T[]> {
  return Promise.all(
    entries.map(async (e) => {
      if (e.kind !== "register" || !e.register_token) return e;
      if (isOverview) return e;
      return { ...e, register_token: await roomTokenVariant(e.register_token, roomId) };
    }),
  );
}
