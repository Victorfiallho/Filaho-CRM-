import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, Copy, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import PageSkeleton from "../components/PageSkeleton";
import { createBookingPage, fetchBookingPreview, publishConsentText, updateBookingPage } from "../data/bookingPages";
import { useBookingPage, useConsentTextVersions, usePermissions } from "../data/hooks";
import {
  DEFAULT_CONSENT_TEXTS,
  activationProblems,
  isSafeLogoUrl,
  parseList,
  parseZipPrefixes,
  renderConsentText,
  slugify
} from "../domain/consent";
import { formatDateTime, formatShortDate, uid } from "../domain/format";
import type { BookingFaq, BookingPage as BookingPageRow, BookingReview, BookingService, ConsentTextKind, ConsentTextVersion } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";

// The public /book/<slug> page's settings for the active company. The page
// itself is rendered server-side by web/api/book.js (always in English, for
// US customers); this screen edits the booking_pages row and publishes
// consent-text versions.
//
// Layout: collapsible sections on the left, the live (saved) preview in a
// sticky column on the right on wide screens, and a save bar fixed to the
// bottom of the viewport whenever there are unsaved changes.
//
// Consent texts are deliberately NOT part of the Save button: each one is
// published on its own as a new, immutable version (publish_consent_text),
// so a consent_record can always point at the exact wording it was given
// under.

type Draft = BookingPageRow & { cities_text: string; zips_text: string };

const toDraft = (p: BookingPageRow): Draft => ({ ...p, cities_text: p.service_cities.join("\n"), zips_text: p.zip_prefixes.join(", ") });

const KINDS: ConsentTextKind[] = ["sms", "email", "transactional"];

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export default function BookingPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { session } = useAuth();
  const { t } = useT();
  const { has } = usePermissions();
  const canEdit = has("edit");
  const queryClient = useQueryClient();
  const { data: page, isLoading } = useBookingPage(activeCompanyId);
  const { data: versions = [] } = useConsentTextVersions(activeCompanyId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => { setDraft(page ? toDraft(page) : null); }, [page]);

  if (isLoading || !activeCompanyId) return <PageSkeleton cards={3} rows={[6, 6, 4]} />;

  const companyId = activeCompanyId;
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["booking_page", companyId] });
    queryClient.invalidateQueries({ queryKey: ["consent_text_versions", companyId] });
  };

  if (!page || !draft) {
    async function handleCreate() {
      setCreating(true);
      try {
        const name = activeCompany?.name || "";
        await createBookingPage({
          company_id: companyId, slug: slugify(name) || companyId.replace(/_/g, "-"), active: false, business_name: name,
          hero_title: "", hero_subtitle: "", primary_color: /^#[0-9a-f]{6}$/i.test(activeCompany?.color || "") ? activeCompany!.color! : "#f97316",
          logo_url: "", phone: "", email: "", address_line: "", address_city: "", address_state: "", address_zip: "",
          service_cities: [], zip_prefixes: [], services: [], faq: [], reviews: [], seo_title: name, seo_description: ""
        });
        for (const kind of KINDS) await publishConsentText(companyId, kind, DEFAULT_CONSENT_TEXTS[kind]);
        invalidate();
        toast(t("bp.created"));
      } catch (err) {
        toastError(errorMessage(err, t("bp.createError")));
      } finally {
        setCreating(false);
      }
    }
    return (
      <section className="card view-enter">
        <div className="card-b">
          <p className="sub">{t("bp.none", { company: activeCompany?.name || "" })}</p>
          {canEdit && <button className="btn" style={{ marginTop: 12 }} onClick={handleCreate} disabled={creating}><Plus aria-hidden="true" />{creating ? t("bp.creating") : t("bp.create")}</button>}
        </div>
      </section>
    );
  }

  const d = draft;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => (prev ? { ...prev, [key]: value } : prev));
  const zips = parseZipPrefixes(d.zips_text);
  const cities = parseList(d.cities_text);
  const problems = activationProblems({ ...d, zip_prefixes: zips.prefixes });
  const problemText = problems.map(p => t(`bp.missing.${p}` as MessageKey)).join(", ");
  const publicUrl = `${window.location.origin}/book/${page.slug}`;
  const dirty = JSON.stringify(toDraft(page)) !== JSON.stringify(d);

  const setService = (i: number, patch: Partial<BookingService>) => set("services", d.services.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setFaq = (i: number, patch: Partial<BookingFaq>) => set("faq", d.faq.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setReview = (i: number, patch: Partial<BookingReview>) => set("reviews", d.reviews.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function handleSave() {
    if (zips.invalid.length) { toastError(t("bp.badZip", { list: zips.invalid.join(", ") })); return; }
    if (!isSafeLogoUrl(d.logo_url.trim())) { toastError(t("bp.badLogo")); return; }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)) { toastError(t("bp.badSlug")); return; }
    if (d.active && problems.length) { toastError(t("bp.notReady", { list: problemText })); return; }
    const services = d.services
      .filter(s => s.name.trim())
      .map((s, position) => ({
        ...s, name: s.name.trim(), description: s.description.trim(), detail_label: s.detail_label?.trim() || undefined, position,
        from_price: s.from_price === null || String(s.from_price).trim() === "" ? null : Number(s.from_price)
      }));
    if (services.some(s => s.from_price !== null && !(Number.isFinite(s.from_price) && s.from_price >= 0))) { toastError(t("bp.badPrice")); return; }
    setSaving(true);
    try {
      await updateBookingPage(companyId, {
        slug: d.slug, active: d.active, business_name: d.business_name.trim(), hero_title: d.hero_title.trim(), hero_subtitle: d.hero_subtitle.trim(),
        primary_color: d.primary_color, logo_url: d.logo_url.trim(), phone: d.phone.trim(), email: d.email.trim(),
        address_line: d.address_line.trim(), address_city: d.address_city.trim(), address_state: d.address_state.trim().toUpperCase(), address_zip: d.address_zip.trim(),
        service_cities: cities, zip_prefixes: zips.prefixes, services,
        faq: d.faq.filter(f => f.question.trim() && f.answer.trim()).map(f => ({ question: f.question.trim(), answer: f.answer.trim() })),
        reviews: d.reviews.filter(r => r.text.trim()).map(r => ({ author: r.author.trim(), text: r.text.trim(), source: r.source.trim() })),
        seo_title: d.seo_title.trim(), seo_description: d.seo_description.trim()
      });
      invalidate();
      toast(t("bp.saved"));
    } catch (err) {
      const msg = errorMessage(err, t("bp.saveError"));
      toastError(/booking_pages_slug_key|duplicate key/.test(msg) ? t("bp.slugTaken") : msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`booking-admin${dirty ? " has-savebar" : ""}`}>
      <div className="booking-columns">
        <div className="booking-form-col">
          <section className="card">
            <div className="card-h">
              <h3>{t("bp.publicPage")}</h3>
              <span className={`badge-tone tone-${page.active ? "green" : "slate"}`}>{page.active ? t("bp.live") : t("bp.off")}</span>
            </div>
            <div className="card-b">
              <div className="copy-row">
                <input readOnly value={publicUrl} aria-label={t("bp.publicLink")} onFocus={e => e.target.select()} />
                <button className="btn ghost slim" type="button" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast(t("bp.copied")), () => toastError(t("bp.copyError")))}><Copy aria-hidden="true" />{t("bp.copy")}</button>
                {page.active && <a className="btn ghost slim" href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{t("bp.open")}</a>}
              </div>
              <label className="switch-row" style={{ marginTop: 12 }}>
                <input type="checkbox" role="switch" checked={d.active} disabled={!canEdit} onChange={e => set("active", e.target.checked)} />
                <span className="switch" aria-hidden="true" />
                <span>{t("bp.isLive")}</span>
              </label>
              {problems.length > 0 && <p className="notice-inline">{t("bp.missingList", { list: problemText })}</p>}
              {!canEdit && <p className="sub" style={{ marginTop: 8 }}>{t("bp.viewOnly")}</p>}
            </div>
          </section>

          <fieldset disabled={!canEdit || saving} className="booking-fields">
            <Section title={t("bp.business")} open>
              <div className="form-row">
                <TextField label={t("bp.businessName")} value={d.business_name} onChange={v => set("business_name", v)} />
                <TextField label={t("bp.slug")} value={d.slug} onChange={v => set("slug", slugify(v))} hint={`/book/${d.slug || "…"}`} />
              </div>
              <div className="form-row">
                <TextField label={t("bp.phone")} value={d.phone} onChange={v => set("phone", v)} />
                <TextField label={t("bp.email")} value={d.email} onChange={v => set("email", v)} type="email" />
              </div>
              <TextField label={t("bp.street")} value={d.address_line} onChange={v => set("address_line", v)} />
              <div className="form-row three">
                <TextField label={t("bp.city")} value={d.address_city} onChange={v => set("address_city", v)} />
                <TextField label={t("bp.state")} value={d.address_state} onChange={v => set("address_state", v)} />
                <TextField label={t("bp.zip")} value={d.address_zip} onChange={v => set("address_zip", v)} />
              </div>
            </Section>

            <Section title={t("bp.look")}>
              <div className="form-row">
                <TextField label={t("bp.headline")} value={d.hero_title} onChange={v => set("hero_title", v)} />
                <TextField label={t("bp.subheadline")} value={d.hero_subtitle} onChange={v => set("hero_subtitle", v)} />
              </div>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="bp-color">{t("bp.color")}</label>
                  <div className="color-row">
                    <input id="bp-color" type="color" value={d.primary_color} onChange={e => set("primary_color", e.target.value)} />
                    <input aria-label={t("bp.colorHex")} value={d.primary_color} onChange={e => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && set("primary_color", e.target.value)} />
                  </div>
                </div>
                <TextField label={t("bp.logo")} value={d.logo_url} onChange={v => set("logo_url", v)} hint={t("bp.logoHint")} />
              </div>
              <div className="form-row">
                <TextField label={t("bp.seoTitle")} value={d.seo_title} onChange={v => set("seo_title", v)} hint={`${d.seo_title.length}/60`} />
                <TextField label={t("bp.seoDescription")} value={d.seo_description} onChange={v => set("seo_description", v)} hint={`${d.seo_description.length}/160`} />
              </div>
            </Section>

            <Section title={t("bp.area")}>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="bp-cities">{t("bp.cities")}</label>
                  <textarea id="bp-cities" rows={5} value={d.cities_text} onChange={e => set("cities_text", e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="bp-zips">{t("bp.zips")}</label>
                  <textarea id="bp-zips" rows={5} value={d.zips_text} onChange={e => set("zips_text", e.target.value)} placeholder="300, 3006, 30339" />
                  <span className="sub">{t("bp.zipsHelp")}{zips.invalid.length ? ` ${t("bp.notValid", { list: zips.invalid.join(", ") })}` : ""}</span>
                </div>
              </div>
            </Section>

            <Section title={t("bp.services")} count={d.services.length}
              action={<button className="btn ghost slim" type="button" onClick={() => set("services", [...d.services, { id: uid("svc"), name: "", description: "", from_price: null, position: d.services.length, active: true }])}><Plus aria-hidden="true" />{t("bp.addService")}</button>}>
              {d.services.length === 0 && <p className="sub">{t("bp.noServices")}</p>}
              {d.services.map((s, i) => (
                <div className="booking-row" key={s.id}>
                  <div className="form-row">
                    <TextField label={t("bp.serviceName")} value={s.name} onChange={v => setService(i, { name: v })} />
                    <TextField label={t("bp.startingAt")} value={s.from_price === null ? "" : String(s.from_price)} onChange={v => setService(i, { from_price: v === "" ? null : (v as unknown as number) })} type="number" hint={t("bp.startingAtHint")} />
                  </div>
                  <div className="form-row">
                    <TextField label={t("bp.description")} value={s.description} onChange={v => setService(i, { description: v })} />
                    <TextField label={t("bp.detailField")} value={s.detail_label || ""} onChange={v => setService(i, { detail_label: v })} hint={t("bp.detailHint")} />
                  </div>
                  <RowActions index={i} count={d.services.length} onMove={delta => set("services", move(d.services, i, delta))} onRemove={() => set("services", d.services.filter((_, j) => j !== i))}>
                    <label className="check-row"><input type="checkbox" checked={s.active} onChange={e => setService(i, { active: e.target.checked })} /><span>{t("bp.shown")}</span></label>
                  </RowActions>
                </div>
              ))}
            </Section>

            <Section title={t("bp.faq")} count={d.faq.length}
              action={<button className="btn ghost slim" type="button" onClick={() => set("faq", [...d.faq, { question: "", answer: "" }])}><Plus aria-hidden="true" />{t("bp.addQuestion")}</button>}>
              {d.faq.length === 0 && <p className="sub">{t("bp.noFaq")}</p>}
              {d.faq.map((f, i) => (
                <div className="booking-row" key={i}>
                  <TextField label={t("bp.question")} value={f.question} onChange={v => setFaq(i, { question: v })} />
                  <TextArea label={t("bp.answer")} value={f.answer} onChange={v => setFaq(i, { answer: v })} />
                  <RowActions index={i} count={d.faq.length} onMove={delta => set("faq", move(d.faq, i, delta))} onRemove={() => set("faq", d.faq.filter((_, j) => j !== i))} />
                </div>
              ))}
            </Section>

            <Section title={t("bp.reviews")} count={d.reviews.length}
              action={<button className="btn ghost slim" type="button" onClick={() => set("reviews", [...d.reviews, { author: "", text: "", source: "" }])}><Plus aria-hidden="true" />{t("bp.addReview")}</button>}>
              <p className="sub">{t("bp.reviewsHelp")}</p>
              {d.reviews.map((r, i) => (
                <div className="booking-row" key={i}>
                  <div className="form-row">
                    <TextField label={t("bp.reviewAuthor")} value={r.author} onChange={v => setReview(i, { author: v })} />
                    <TextField label={t("bp.reviewSource")} value={r.source} onChange={v => setReview(i, { source: v })} hint={t("bp.reviewSourceHint")} />
                  </div>
                  <TextArea label={t("bp.reviewText")} value={r.text} onChange={v => setReview(i, { text: v })} />
                  <RowActions index={i} count={d.reviews.length} onMove={delta => set("reviews", move(d.reviews, i, delta))} onRemove={() => set("reviews", d.reviews.filter((_, j) => j !== i))} />
                </div>
              ))}
            </Section>
          </fieldset>

          <Section title={t("bp.consentTexts")}>
            <p className="sub">{t("bp.consentHelp")}</p>
            {KINDS.map(kind => (
              <ConsentTextEditor
                key={kind}
                kind={kind}
                companyId={companyId}
                businessName={page.business_name}
                versions={versions.filter(v => v.kind === kind)}
                canEdit={canEdit}
                onPublished={invalidate}
              />
            ))}
          </Section>
        </div>

        <div className="booking-preview-col">
          <PreviewCard companyId={companyId} accessToken={session?.access_token} version={`${page.updated_at}|${versions.length}`} />
        </div>
      </div>

      {dirty && (
        <div className="booking-savebar" role="region" aria-label={t("bp.unsaved")}>
          <span className="sub">{t("bp.unsaved")}</span>
          <button className="btn ghost" type="button" onClick={() => setDraft(toDraft(page))} disabled={saving}>{t("bp.discard")}</button>
          <button className="btn" type="button" onClick={handleSave} disabled={!canEdit || saving}>{saving ? t("bp.saving") : t("bp.save")}</button>
        </div>
      )}
    </div>
  );
}

// Collapsible card section (closed by default except the first), with an
// optional count and a header action that doesn't toggle it.
function Section({ title, count, action, open = false, children }: { title: string; count?: number; action?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="card booking-section" open={open}>
      <summary className="card-h">
        <span className="booking-section-title">
          <ChevronDown className="booking-section-chevron" aria-hidden="true" />
          <h3>{title}</h3>
          {count !== undefined && count > 0 && <span className="badge-tone tone-slate">{count}</span>}
        </span>
        {action && <span onClick={e => e.preventDefault()}>{action}</span>}
      </summary>
      <div className="card-b">{children}</div>
    </details>
  );
}

function TextField({ label, value, onChange, type = "text", hint }: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} />
      {hint && <span className="sub">{hint}</span>}
    </div>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={2} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function RowActions({ index, count, onMove, onRemove, children }: { index: number; count: number; onMove: (delta: number) => void; onRemove: () => void; children?: ReactNode }) {
  const { t } = useT();
  return (
    <div className="row-actions">
      {children}
      <span style={{ marginLeft: "auto" }} />
      <button className="round-btn" type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t("bp.moveUp")}><ArrowUp aria-hidden="true" /></button>
      <button className="round-btn" type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t("bp.moveDown")}><ArrowDown aria-hidden="true" /></button>
      <button className="round-btn" type="button" onClick={onRemove} aria-label={t("bp.remove")}><Trash2 aria-hidden="true" /></button>
    </div>
  );
}

function ConsentTextEditor({ kind, companyId, businessName, versions, canEdit, onPublished }: {
  kind: ConsentTextKind; companyId: string; businessName: string; versions: ConsentTextVersion[]; canEdit: boolean; onPublished: () => void;
}) {
  const current = versions[0];
  const { t, locale } = useT();
  const id = useId();
  const [text, setText] = useState(current?.template || "");
  const [publishing, setPublishing] = useState(false);
  useEffect(() => { setText(current?.template || ""); }, [current?.template]);
  const changed = text.trim() !== (current?.template || "") && text.trim() !== "";
  const label = t(`bp.kind.${kind}` as MessageKey);

  async function handlePublish() {
    setPublishing(true);
    try {
      const v = await publishConsentText(companyId, kind, text);
      onPublished();
      toast(t("bp.published", { version: v }));
    } catch (err) {
      toastError(errorMessage(err, t("bp.publishError")));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="booking-row">
      <div className="between">
        <label htmlFor={id}><b>{label}</b></label>
        {current && <span className="badge-tone tone-slate">v{current.version} · {formatShortDate(current.created_at, locale)}</span>}
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <textarea id={id} rows={kind === "sms" ? 4 : 2} value={text} disabled={!canEdit || publishing} onChange={e => setText(e.target.value)} />
      </div>
      <p className="sub" style={{ marginTop: 6 }}>{t("bp.shownAs", { text: renderConsentText(text, businessName) })}</p>
      {canEdit && (
        <div className="inline-actions" style={{ marginTop: 8 }}>
          <button className="btn slim" type="button" onClick={handlePublish} disabled={!changed || publishing}>{publishing ? t("bp.publishing") : t("bp.publish", { version: (current?.version || 0) + 1 })}</button>
          {changed && <button className="btn ghost slim" type="button" onClick={() => setText(current?.template || "")}>{t("bp.undo")}</button>}
        </div>
      )}
      {versions.length > 1 && (
        <details style={{ marginTop: 10 }}>
          <summary className="sub">{t("bp.earlier", { count: versions.length - 1 })}</summary>
          {versions.slice(1).map(v => (
            <div className="record-note" key={v.version}>
              <p>{v.template}</p>
              <span className="sub">v{v.version} · {formatDateTime(v.created_at, locale)}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function PreviewCard({ companyId, accessToken, version }: { companyId: string; accessToken?: string; version: string }) {
  const { t } = useT();
  const [which, setWhich] = useState<"" | "privacy" | "sms-terms">("");
  const [mobile, setMobile] = useState(true);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setError("");
    fetchBookingPreview(accessToken, companyId, which)
      .then(h => { if (!cancelled) setHtml(h); })
      .catch(() => { if (!cancelled) setError(t("bp.pv.unavailable")); });
    return () => { cancelled = true; };
  }, [accessToken, companyId, which, version, nonce, t]);

  return (
    <section className="card booking-preview-card">
      <div className="card-h">
        <h3>{t("bp.preview")}</h3>
        <button type="button" className="round-btn" onClick={() => setNonce(n => n + 1)} aria-label={t("bp.pv.refresh")}><RefreshCw aria-hidden="true" /></button>
      </div>
      <div className="card-b">
        <div className="preview-tabs">
          <div className="seg" role="group" aria-label={t("bp.preview")}>
            {(["", "privacy", "sms-terms"] as const).map(p => (
              <button key={p || "page"} type="button" className={which === p ? "active" : ""} aria-pressed={which === p} onClick={() => setWhich(p)}>
                {p === "" ? t("bp.pv.page") : p === "privacy" ? t("bp.pv.privacy") : t("bp.pv.sms")}
              </button>
            ))}
          </div>
          <button type="button" className="btn ghost slim" onClick={() => setMobile(m => !m)}>{mobile ? t("bp.pv.desktop") : t("bp.pv.phone")}</button>
        </div>
        <div className="booking-preview">
          {error ? <p className="sub">{error} {t("bp.pv.local")}</p> : (
            <iframe title={t("bp.preview")} srcDoc={html} sandbox="allow-same-origin" style={{ width: mobile ? 375 : "100%" }} />
          )}
        </div>
      </div>
    </section>
  );
}
