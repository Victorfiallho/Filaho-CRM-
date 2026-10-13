import { useBookingRequests, useConsentRecords, useConsentStatuses } from "../data/hooks";
import { CONSENT_SOURCE_LABELS, consentBadge } from "../domain/consent";
import { formatDay } from "../domain/format";
import type { ConsentState } from "../domain/types";

// Lead/client record section: where the person came from, what they asked
// for on the booking page, and their marketing-consent state + full history.
// Read-only on purpose — consent_records can't be edited or deleted by
// anyone (RLS has no write policy, and a trigger refuses UPDATE/DELETE).
const PILL: Record<ConsentState, string> = { opted_in: "status-active", not_opted_in: "status-draft", suppressed: "status-lost" };

export default function ConsentPanel({ companyId, kind, record }: {
  companyId: string;
  kind: "lead" | "customer";
  record: { id: string; customer_id?: string | null; source?: string };
}) {
  const contactId = kind === "customer" ? record.id : record.customer_id || null;
  const { data: requests = [] } = useBookingRequests(companyId, kind === "lead" ? { leadId: record.id } : { customerId: record.id });
  const { data: history = [] } = useConsentRecords(companyId, contactId);
  const { data: statuses = [] } = useConsentStatuses(companyId);
  const status = statuses.find(s => s.contact_id === contactId);

  return (
    <div className="record-consent">
      <div className="field">
        <label>Origin</label>
        <p className="sub">Source: <b>{record.source || "—"}</b></p>
        {requests.map(b => (
          <div className="record-note" key={b.id}>
            <p><b>Booking request</b> · {new Date(b.created_at).toLocaleString()}</p>
            <dl className="booking-dl">
              {b.services.length > 0 && <Row label="Services" value={b.services.join(", ")} />}
              {Object.entries(b.details || {}).map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
              {(b.preferred_date || b.preferred_period) && <Row label="Preferred" value={[formatDay(b.preferred_date), b.preferred_period].filter(Boolean).join(", ")} />}
              {b.notes && <Row label="Notes" value={b.notes} />}
              {b.heard_from && <Row label="Heard from" value={b.heard_from} />}
              {(b.utm_source || b.utm_campaign) && <Row label="Campaign" value={[b.utm_source, b.utm_medium, b.utm_campaign].filter(Boolean).join(" / ")} />}
            </dl>
          </div>
        ))}
      </div>

      <div className="field">
        <label>Marketing consent</label>
        {contactId ? (
          <>
            <div className="inline-actions">
              <span className={`pill ${PILL[status?.sms_state || "not_opted_in"]}`}>{consentBadge("sms", status?.sms_state)}</span>
              <span className={`pill ${PILL[status?.email_state || "not_opted_in"]}`}>{consentBadge("email", status?.email_state)}</span>
            </div>
            {history.length === 0 ? (
              <p className="sub">No consent on record — marketing texts are blocked for this contact.</p>
            ) : (
              <details>
                <summary className="sub">Consent history ({history.length}) — read-only</summary>
                <div className="table-wrap">
                  <table className="consent-table">
                    <thead><tr><th>When</th><th>Channel</th><th>Agreed</th><th>Source</th><th>Text shown</th><th>IP</th></tr></thead>
                    <tbody>
                      {history.map(c => (
                        <tr key={c.id}>
                          <td>{new Date(c.created_at).toLocaleString()}</td>
                          <td>{c.channel === "sms" ? "SMS" : "Email"}</td>
                          <td>{c.granted ? "Yes" : "No"}</td>
                          <td>{CONSENT_SOURCE_LABELS[c.source] || c.source}</td>
                          <td>{c.text_version ? <span className="sub">v{c.text_version} · </span> : null}{c.text_shown}</td>
                          <td>{c.ip || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        ) : (
          <p className="sub">This lead isn't linked to a client, so it has no consent on record.</p>
        )}
      </div>
    </div>
  );
}

// <div> grouping inside <dl> is valid HTML and keeps each pair together.
function Row({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
