/** Preserve the website through sign-up and verification without starting paid work. */
export function websiteSetupPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300) throw new Error("Enter your business website.");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Enter a valid website, such as yourbusiness.com.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")) {
    throw new Error("Use a public HTTP or HTTPS website without login details.");
  }
  return `/onboarding?${new URLSearchParams({ new: "1", website: url.href })}`;
}
