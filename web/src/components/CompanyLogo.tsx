import { COMPANY_ICONS, COMPANY_LOGOS } from "../domain/constants";
import { initials } from "../domain/format";
import type { Company } from "../domain/types";

// Shared by CompanyPicker's picker cards and Shell's sidebar brand mark —
// same three-tier fallback both used to duplicate inline (a real logo file,
// then a hardcoded icon SVG, then company.logo as raw SVG markup the DB
// might hold for a company added without either of the first two) — plus a
// fourth tier this didn't have: colored initials, same pattern as
// .lead-avatar elsewhere in the app. Without it, any company with none of
// the above rendered its .logo box completely empty — just the tinted
// background, no mark at all.
export default function CompanyLogo({ company }: { company: Company }) {
  const file = COMPANY_LOGOS[company.id];
  if (file) {
    return <img src={file} alt={company.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
  }
  const markup = COMPANY_ICONS[company.id] || company.logo;
  if (markup) return <span dangerouslySetInnerHTML={{ __html: markup }} />;
  return <span className="logo-initials">{initials(company.name)}</span>;
}
