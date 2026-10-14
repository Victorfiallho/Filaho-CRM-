import { COMPANY_ICONS, COMPANY_LOGOS } from "../domain/constants";
import { initials } from "../domain/format";
import type { Company } from "../domain/types";

// A company's mark: its logo file, else a built-in icon, else SVG markup
// stored on the company, else colored initials.
export default function CompanyLogo({ company }: { company: Company }) {
  const file = COMPANY_LOGOS[company.id];
  if (file) {
    return <img src={file} alt={company.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
  }
  const markup = COMPANY_ICONS[company.id] || company.logo;
  if (markup) return <span dangerouslySetInnerHTML={{ __html: markup }} />;
  return <span className="logo-initials">{initials(company.name)}</span>;
}
