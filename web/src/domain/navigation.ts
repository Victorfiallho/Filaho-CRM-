// Which screens get a direct button and which go under "More". The daily
// screens are one click away; everything else keeps its NAV_GROUPS section
// inside the "More" menu. Pure, so permissions and order are testable.
import { NAV_GROUPS } from "./constants";

// Top bar on a computer, after Dashboard.
export const PRIMARY_NAV = ["pipeline", "customers", "jobs", "calendar"];
// Bottom bar on a phone; the last slot is always "More".
export const BOTTOM_NAV = ["dashboard", "pipeline", "jobs", "calendar"];

export interface NavSplit {
  primary: string[];
  more: [group: string, ids: string[]][];
}

export function splitNav(canSee: (id: string) => boolean, primaryIds: string[] = PRIMARY_NAV): NavSplit {
  const primary = primaryIds.filter(canSee);
  const taken = new Set(["dashboard", ...primary]);
  const more = NAV_GROUPS
    .map(([name, ids]) => [name, ids.filter(id => !taken.has(id) && canSee(id))] as [string, string[]])
    .filter(([, ids]) => ids.length > 0);
  return { primary, more };
}
