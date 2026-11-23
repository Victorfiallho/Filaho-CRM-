import { useBookingRequests, useConsentRecords, useConsentStatuses } from "../data/hooks";
import { formatDateTime, formatDay } from "../domain/format";
import { useT } from "../i18n/I18nContext";
import { en, type MessageKey } from "../i18n/messages";
import type { ConsentState } from "../domain/types";
import { leadOrigin, type LeadOrigin } from "../domain/leadOrigin";

// Where the person came from, what they asked for on the booking page, and
// their marketing consent with its full history. Read-only: consent records
// can't be edited or deleted by anyone.
const PILL: Record<ConsentState, string> = { opted_in: "status-active", not_opted_in: "status-draft", suppressed: "status-lost" };

export default function ConsentPanel({ companyId, kind, record }: {
  companyId: string;
  kind: "lead" | "customer";
  record: { id: string; customer_id?: string | null; source?: string };
}) {
  const { t, locale } = useT();
  const badge = (channel: "sms" | "email", state: ConsentState | undefined) =>
    t(channel === "sms" ? "consent.badge.sms" : "consent.badge.email", { state: t(`consent.${state || "not_opted_in"}` as MessageKey) });
  const contactId = kind === "customer" ? record.id : record.customer_id || null;
  const { data: requests = [] } = useBookingRequests(companyId, kind === "lead" ? { leadId: record.id } : { customerId: record.id });
  const { data: history = [] } = useConsentRecords(companyId, contactId);
  const { data: statuses = [] } = useConsentStatuses(companyId);
  const status = statuses.find(s => s.contact_id === contactId);

  // A deal comes from one request (newest first, so a re-booked client's
  // latest visit request); a client shows each request's origin in its card.
  const origin = kind === "lead" ? leadOrigin(requests[0]) : null;

  return (
    <div className="record-consent">
      {kind === "lead" && (
        <div className="field">
          <label>{t("origin.title")}</label>
          {origin ? <OriginList origin={origin} /> : <p className="sub">{t("origin.unknown")}</p>}
        </div>
      )}
      <div className="field">
        <label>{t("consent.origin")}</label>
        <p className="sub">{t("consent.source")}: <b>{record.source || "—"}</b></p>
        {requests.map(b => (
          <div className="record-note" key={b.id}>
            <p><b>{t("consent.bookingRequest")}</b> · {formatDateTime(b.created_at, locale)}</p>
            <dl className="booking-dl">
              {b.services.length > 0 && <Row label={t("consent.services")} value={b.services.join(", ")} />}
              {(Array.isArray(b.details) ? b.details : Object.entries(b.details || {}).map(([label, value]) => ({ label, value: String(value) })))
                .map((d, i) => <Row key={i} label={d.label} value={d.value} />)}
              {(b.preferred_date || b.preferred_period) && <Row label={t("consent.preferred")} value={[formatDay(b.preferred_date, undefined, locale), b.preferred_period && t(`period.${b.preferred_period}` as MessageKey)].filter(Boolean).join(", ")} />}
              {b.notes && <Row label={t("consent.notes")} value={b.notes} />}
              {b.heard_from && <Row label={t("consent.heardFrom")} value={b.heard_from} />}
            </dl>
            {kind === "customer" && (() => {
              const o = leadOrigin(b);
              return o ? <OriginList origin={o} /> : <p className="sub">{t("origin.source")}: {t("origin.unknown")}</p>;
            })()}
          </div>
        ))}
      </div>

      <div className="field">
        <label>{t("consent.marketing")}</label>
        {contactId ? (
          <>
            <div className="inline-actions">
              <span className={`pill ${PILL[status?.sms_state || "not_opted_in"]}`}>{badge("sms", status?.sms_state)}</span>
              <span className={`pill ${PILL[status?.email_state || "not_opted_in"]}`}>{badge("email", status?.email_state)}</span>
            </div>
            {history.length === 0 ? (
              <p className="sub">{t("consent.noneOnRecord")}</p>
            ) : (
              <details>
                <summary className="sub">{t("consent.history", { count: history.length })}</summary>
                <div className="table-wrap">
                  <table className="consent-table">
                    <thead><tr><th>{t("consent.col.when")}</th><th>{t("consent.col.channel")}</th><th>{t("consent.col.agreed")}</th><th>{t("consent.col.source")}</th><th>{t("consent.col.text")}</th><th>{t("consent.col.ip")}</th></tr></thead>
                    <tbody>
                      {history.map(c => (
                        <tr key={c.id}>
                          <td>{formatDateTime(c.created_at, locale)}</td>
                          <td>{c.channel === "sms" ? "SMS" : t("act.field.email")}</td>
                          <td>{c.granted ? t("consent.yes") : t("consent.no")}</td>
                          <td>{`consentSource.${c.source}` in en ? t(`consentSource.${c.source}` as MessageKey) : c.source}</td>
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
          <p className="sub">{t("consent.noClient")}</p>
        )}
      </div>
    </div>
  );
}

// "Instagram · Paid traffic", then whatever else the ad link carried.
function OriginList({ origin: o }: { origin: LeadOrigin }) {
  const { t } = useT();
  const medium = o.medium ? t(`origin.medium.${o.medium}` as MessageKey) : o.mediumRaw;
  const source = [o.platform, medium].filter(Boolean).join(" · ");
  return (
    <dl className="booking-dl">
      {source && <Row label={t("origin.source")} value={source} />}
      {o.campaign && <Row label={t("origin.campaign")} value={o.campaign} />}
      {o.ad && <Row label={t("origin.ad")} value={o.ad} />}
      {o.adId && <Row label={t("origin.adId")} value={o.adId} />}
      {o.placement && <Row label={t("origin.placement")} value={o.placement} />}
    </dl>
  );
}

// <div> grouping inside <dl> is valid HTML and keeps each pair together.
function Row({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
