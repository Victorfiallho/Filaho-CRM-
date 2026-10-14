// Every company has a public booking page at /book/<slug>, always on
// (migration 2026-10-14_12). Same slug rule as booking_slug() in SQL:
// "peach_state_flooring" -> "peach-state-flooring".
export function bookingSlug(companyId: string): string {
  return companyId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function bookingPath(companyId: string): string {
  return `/book/${bookingSlug(companyId)}`;
}
