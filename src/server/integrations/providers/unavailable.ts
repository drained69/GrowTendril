import type { MarketProvider, ProviderId } from "@/server/integrations/providers/types";

/**
 * Declared provider interfaces for platforms where GrowTendril has no reliable, permitted
 * read access. They are listed so the gap is visible — they never return made-up data.
 */
function restricted(id: ProviderId, name: string, category: MarketProvider["category"], docsUrl: string, reason: string): MarketProvider {
  return { id, name, description: reason, category, docsUrl, access: "restricted", restrictedReason: reason, credentialFields: [], envFallback: {}, isReady: () => false, search: async () => [] };
}

export const tiktok = restricted("tiktok", "TikTok", "video", "https://developers.tiktok.com/products/research-api/", "TikTok's Research API is limited to approved researchers. GrowTendril does not scrape.");
export const discord = restricted("discord", "Discord", "community", "https://discord.com/developers/docs", "Requires a bot that server admins invite; only those channels may be read. Not yet supported.");
export const telegram = restricted("telegram", "Telegram", "community", "https://core.telegram.org/bots/api", "The Bot API only sees chats the bot was added to. Not yet supported.");
