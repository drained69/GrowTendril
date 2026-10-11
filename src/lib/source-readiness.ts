type Source = { provider: { audiences?: readonly string[] } };

/** Match the audience restriction used by the market scanner. */
export function sourceAppliesTo(source: Source, audience: string | null | undefined): boolean {
  return !source.provider.audiences || source.provider.audiences.includes(audience ?? "businesses");
}

export function sourceAudienceLabel(source: Source): string {
  const nouns: Record<string, string> = { developers: "Developer", businesses: "Business", consumers: "Consumer" };
  return `${(source.provider.audiences ?? []).map((a) => nouns[a] ?? a).join(" / ")} products only`;
}
