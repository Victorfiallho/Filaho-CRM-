import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import PageSkeleton from "../components/PageSkeleton";
import { createBookingPage, fetchBookingPreview, publishConsentText, updateBookingPage } from "../data/bookingPages";
import { useBookingPage, useConsentTextVersions, usePermissions } from "../data/hooks";
import {
  CONSENT_TEXT_LABELS,
  DEFAULT_CONSENT_TEXTS,
  activationProblems,
  isSafeLogoUrl,
  parseList,
  parseZipPrefixes,
  renderConsentText,
  slugify
} from "../domain/consent";
import { uid } from "../domain/format";
import type { BookingFaq, BookingPage as BookingPageRow, BookingReview, BookingService, ConsentTextKind, ConsentTextVersion } from "../domain/types";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";

// The public /book/<slug> page's settings for the active company. The page
// itself is rendered server-side by web/api/book.js; this screen only edits
// the booking_pages row and publishes consent-text versions.
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
        toast("Booking page created — fill it in and switch it on when ready.");
      } catch (err) {
        toastError(errorMessage(err, "Could not create the booking page."));
      } finally {
        setCreating(false);
      }
    }
    return (
      <section className="card view-enter">
        <div className="card-h"><h3>Booking page</h3></div>
        <div className="card-b">
          <p className="sub">{activeCompany?.name} doesn't have a public booking page yet.</p>
          {canEdit && <button className="btn" style={{ marginTop: 12 }} onClick={handleCreate} disabled={creating}><Plus />{creating ? "Creating..." : "Create booking page"}</button>}
        </div>
      </section>
    );
  }

  const d = draft;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => (prev ? { ...prev, [key]: value } : prev));
  const zips = parseZipPrefixes(d.zips_text);
  const cities = parseList(d.cities_text);
  const problems = activationProblems({ ...d, zip_prefixes: zips.prefixes });
  const publicUrl = `${window.location.origin}/book/${page.slug}`;
  const dirty = JSON.stringify(toDraft(page)) !== JSON.stringify(d);

  const setService = (i: number, patch: Partial<BookingService>) => set("services", d.services.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setFaq = (i: number, patch: Partial<BookingFaq>) => set("faq", d.faq.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setReview = (i: number, patch: Partial<BookingReview>) => set("reviews", d.reviews.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function handleSave() {
    if (zips.invalid.length) { toastError(`Not a ZIP prefix: ${zips.invalid.join(", ")}`); return; }
    if (!isSafeLogoUrl(d.logo_url.trim())) { toastError("Logo URL must start with https:// (or be a path on this site, like /logos/logo.png)."); return; }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)) { toastError("The link name can only use lowercase letters, numbers and dashes."); return; }
    if (d.active && problems.length) { toastError(`Before turning the page on, add: ${problems.join(", ")}.`); return; }
    const services = d.services
      .filter(s => s.name.trim())
      .map((s, position) => ({
        ...s, name: s.name.trim(), description: s.description.trim(), detail_label: s.detail_label?.trim() || undefined, position,
        from_price: s.from_price === null || String(s.from_price).trim() === "" ? null : Number(s.from_price)
      }));
    if (services.some(s => s.from_price !== null && !(Number.isFinite(s.from_price) && s.from_price >= 0))) { toastError("\"Starting at\" must be a number, or empty."); return; }
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
      toast("Booking page saved.");
    } catch (err) {
      const msg = errorMessage(err, "Could not save the booking page.");
      toastError(/booking_pages_slug_key|duplicate key/.test(msg) ? "That link name is already used by another company." : msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view-enter booking-admin">
      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <h3>Public page</h3>
          <span className={`pill ${page.active ? "status-active" : "status-draft"}`}>{page.active ? "Live" : "Off"}</span>
        </div>
        <div className="card-b">
          <div className="inline-actions">
            <input readOnly value={publicUrl} aria-label="Public link" onFocus={e => e.target.select()} />
            <button className="btn ghost slim" type="button" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast("Link copied."), () => toastError("Could not copy — select the link and copy it by hand."))}><Copy />Copy link</button>
            {page.active && <a className="btn ghost slim" href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink />Open</a>}
          </div>
          <label className="check-row" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={d.active} disabled={!canEdit} onChange={e => set("active", e.target.checked)} />
            <span>Page is live (anyone with the link can book)</span>
          </label>
          {problems.length > 0 && <p className="sub" style={{ marginTop: 8 }}>Before it can go live, add: {problems.join(", ")}.</p>}
          {!canEdit && <p className="sub" style={{ marginTop: 8 }}>You can view these settings; editing needs the "edit" permission.</p>}
        </div>
      </section>

      <fieldset disabled={!canEdit || saving} className="booking-fields">
        <section className="card" style={{ marginBottom: 14 }}>
          <div className="card-h"><h3>Business details</h3></div>
          <div className="card-b">
            <div className="form-row">
              <TextField label="Business name (shown on the page)" value={d.business_name} onChange={v => set("business_name", v)} />
              <TextField label="Link name" value={d.slug} onChange={v => set("slug", slugify(v))} hint={`/book/${d.slug || "…"}`} />
            </div>
            <div className="form-row">
              <TextField label="Phone" value={d.phone} onChange={v => set("phone", v)} />
              <TextField label="Email" value={d.email} onChange={v => set("email", v)} type="email" />
            </div>
            <TextField label="Street address (printed in the footer — required by CAN-SPAM)" value={d.address_line} onChange={v => set("address_line", v)} />
            <div className="form-row three">
              <TextField label="City" value={d.address_city} onChange={v => set("address_city", v)} />
              <TextField label="State" value={d.address_state} onChange={v => set("address_state", v)} />
              <TextField label="ZIP" value={d.address_zip} onChange={v => set("address_zip", v)} />
            </div>
          </div>
        </section>

        <section className="card" style={{ marginBottom: 14 }}>
          <div className="card-h"><h3>Look &amp; search</h3></div>
          <div className="card-b">
            <div className="form-row">
              <TextField label="Headline" value={d.hero_title} onChange={v => set("hero_title", v)} />
              <TextField label="Sub-headline" value={d.hero_subtitle} onChange={v => set("hero_subtitle", v)} />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="bp-color">Primary color</label>
                <div className="inline-actions">
                  <input id="bp-color" type="color" value={d.primary_color} onChange={e => set("primary_color", e.target.value)} style={{ width: 56, padding: 4, flex: "0 0 auto" }} />
                  <input aria-label="Primary color hex" value={d.primary_color} onChange={e => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && set("primary_color", e.target.value)} />
                </div>
              </div>
              <TextField label="Logo URL" value={d.logo_url} onChange={v => set("logo_url", v)} hint="https://… or a path on this site, e.g. /logos/peach_fresh.png" />
            </div>
            <div className="form-row">
              <TextField label="Search title" value={d.seo_title} onChange={v => set("seo_title", v)} hint={`${d.seo_title.length}/60`} />
              <TextField label="Search description" value={d.seo_description} onChange={v => set("seo_description", v)} hint={`${d.seo_description.length}/160`} />
            </div>
          </div>
        </section>

        <section className="card" style={{ marginBottom: 14 }}>
          <div className="card-h"><h3>Service area</h3></div>
          <div className="card-b">
            <div className="form-row">
              <div className="field">
                <label htmlFor="bp-cities">Cities served (one per line)</label>
                <textarea id="bp-cities" rows={5} value={d.cities_text} onChange={e => set("cities_text", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="bp-zips">Accepted ZIP prefixes</label>
                <textarea id="bp-zips" rows={5} value={d.zips_text} onChange={e => set("zips_text", e.target.value)} placeholder="300, 3006, 30339" />
                <span className="sub">A ZIP is accepted if it starts with any of these. Others see "We don't serve this area yet".{zips.invalid.length ? ` Not valid: ${zips.invalid.join(", ")}` : ""}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <h3>Services</h3>
            <button className="btn ghost slim" type="button" onClick={() => set("services", [...d.services, { id: uid("svc"), name: "", description: "", from_price: null, position: d.services.length, active: true }])}><Plus />Add service</button>
          </div>
          <div className="card-b">
            {d.services.length === 0 && <p className="sub">No services yet.</p>}
            {d.services.map((s, i) => (
              <div className="booking-row" key={s.id}>
                <div className="form-row">
                  <TextField label="Name" value={s.name} onChange={v => setService(i, { name: v })} />
                  <TextField label="Starting at ($, optional)" value={s.from_price === null ? "" : String(s.from_price)} onChange={v => setService(i, { from_price: v === "" ? null : (v as unknown as number) })} type="number" hint="Leave empty to show no price" />
                </div>
                <div className="form-row">
                  <TextField label="Description" value={s.description} onChange={v => setService(i, { description: v })} />
                  <TextField label="Extra number field (optional)" value={s.detail_label || ""} onChange={v => setService(i, { detail_label: v })} hint='e.g. "Number of rooms"' />
                </div>
                <RowActions
                  index={i}
                  count={d.services.length}
                  onMove={delta => set("services", move(d.services, i, delta))}
                  onRemove={() => set("services", d.services.filter((_, j) => j !== i))}
                >
                  <label className="check-row"><input type="checkbox" checked={s.active} onChange={e => setService(i, { active: e.target.checked })} /><span>Shown on the page</span></label>
                </RowActions>
              </div>
            ))}
          </div>
        </section>

        <section className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <h3>FAQ</h3>
            <button className="btn ghost slim" type="button" onClick={() => set("faq", [...d.faq, { question: "", answer: "" }])}><Plus />Add question</button>
          </div>
          <div className="card-b">
            {d.faq.length === 0 && <p className="sub">No questions yet — the section is hidden until you add one.</p>}
            {d.faq.map((f, i) => (
              <div className="booking-row" key={i}>
                <TextField label="Question" value={f.question} onChange={v => setFaq(i, { question: v })} />
                <div className="field"><label>Answer</label><textarea rows={2} value={f.answer} onChange={e => setFaq(i, { answer: e.target.value })} /></div>
                <RowActions index={i} count={d.faq.length} onMove={delta => set("faq", move(d.faq, i, delta))} onRemove={() => set("faq", d.faq.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
        </section>

        <section className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <h3>Reviews</h3>
            <button className="btn ghost slim" type="button" onClick={() => set("reviews", [...d.reviews, { author: "", text: "", source: "" }])}><Plus />Add review</button>
          </div>
          <div className="card-b">
            <p className="sub">Only real reviews, copied word for word (e.g. from Google or Thumbtack). The section stays hidden while this list is empty.</p>
            {d.reviews.map((r, i) => (
              <div className="booking-row" key={i}>
                <div className="form-row">
                  <TextField label="Customer name as shown on the review" value={r.author} onChange={v => setReview(i, { author: v })} />
                  <TextField label="Where it was posted" value={r.source} onChange={v => setReview(i, { source: v })} hint="e.g. Google" />
                </div>
                <div className="field"><label>Review text</label><textarea rows={2} value={r.text} onChange={e => setReview(i, { text: e.target.value })} /></div>
                <RowActions index={i} count={d.reviews.length} onMove={delta => set("reviews", move(d.reviews, i, delta))} onRemove={() => set("reviews", d.reviews.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
        </section>
      </fieldset>

      <div className="booking-savebar">
        <span className="sub">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <button className="btn ghost" type="button" onClick={() => setDraft(toDraft(page))} disabled={!dirty || saving}>Discard</button>
        <button className="btn" type="button" onClick={handleSave} disabled={!canEdit || !dirty || saving}>{saving ? "Saving..." : "Save changes"}</button>
      </div>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-h"><h3>Consent texts</h3></div>
        <div className="card-b">
          <p className="sub">Changing a text publishes a new version. Earlier versions are never edited, and every consent record keeps the exact text the person saw. Use {"{Business}"} for the business name.</p>
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
        </div>
      </section>

      <PreviewCard companyId={companyId} accessToken={session?.access_token} version={`${page.updated_at}|${versions.length}`} />
    </div>
  );
}

function TextField({ label, value, onChange, type = "text", hint }: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string }) {
  const [id] = useState(() => uid("bpf"));
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} />
      {hint && <span className="sub">{hint}</span>}
    </div>
  );
}

function RowActions({ index, count, onMove, onRemove, children }: { index: number; count: number; onMove: (delta: number) => void; onRemove: () => void; children?: React.ReactNode }) {
  return (
    <div className="inline-actions" style={{ marginTop: 10 }}>
      {children}
      <span style={{ marginLeft: "auto" }} />
      <button className="btn ghost slim" type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up"><ArrowUp /></button>
      <button className="btn ghost slim" type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down"><ArrowDown /></button>
      <button className="btn ghost slim" type="button" onClick={onRemove} aria-label="Remove"><Trash2 /></button>
    </div>
  );
}

function ConsentTextEditor({ kind, companyId, businessName, versions, canEdit, onPublished }: {
  kind: ConsentTextKind; companyId: string; businessName: string; versions: ConsentTextVersion[]; canEdit: boolean; onPublished: () => void;
}) {
  const current = versions[0];
  const [text, setText] = useState(current?.template || "");
  const [publishing, setPublishing] = useState(false);
  useEffect(() => { setText(current?.template || ""); }, [current?.template]);
  const changed = text.trim() !== (current?.template || "") && text.trim() !== "";

  async function handlePublish() {
    setPublishing(true);
    try {
      const v = await publishConsentText(companyId, kind, text);
      onPublished();
      toast(`Published version ${v}.`);
    } catch (err) {
      toastError(errorMessage(err, "Could not publish the new version."));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="booking-row">
      <div className="between">
        <b>{CONSENT_TEXT_LABELS[kind]}</b>
        {current && <span className="pill">v{current.version} · {new Date(current.created_at).toLocaleDateString()}</span>}
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <textarea rows={kind === "sms" ? 4 : 2} value={text} disabled={!canEdit || publishing} onChange={e => setText(e.target.value)} aria-label={CONSENT_TEXT_LABELS[kind]} />
      </div>
      <p className="sub" style={{ marginTop: 6 }}>Shown as: “{renderConsentText(text, businessName)}”</p>
      {canEdit && (
        <div className="inline-actions" style={{ marginTop: 8 }}>
          <button className="btn slim" type="button" onClick={handlePublish} disabled={!changed || publishing}>{publishing ? "Publishing..." : `Publish as version ${(current?.version || 0) + 1}`}</button>
          {changed && <button className="btn ghost slim" type="button" onClick={() => setText(current?.template || "")}>Undo</button>}
        </div>
      )}
      {versions.length > 1 && (
        <details style={{ marginTop: 10 }}>
          <summary className="sub">Earlier versions ({versions.length - 1})</summary>
          {versions.slice(1).map(v => (
            <div className="record-note" key={v.version}>
              <p>{v.template}</p>
              <span className="sub">v{v.version} · {new Date(v.created_at).toLocaleString()}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function PreviewCard({ companyId, accessToken, version }: { companyId: string; accessToken?: string; version: string }) {
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
      .catch(err => { if (!cancelled) setError(errorMessage(err, "Preview unavailable.")); });
    return () => { cancelled = true; };
  }, [accessToken, companyId, which, version, nonce]);

  return (
    <section className="card">
      <div className="card-h">
        <h3>Preview (saved version)</h3>
        <div className="inline-actions">
          {(["", "privacy", "sms-terms"] as const).map(p => (
            <button key={p || "page"} type="button" className={`btn slim ${which === p ? "" : "ghost"}`} onClick={() => setWhich(p)}>{p === "" ? "Page" : p === "privacy" ? "Privacy" : "SMS terms"}</button>
          ))}
          <button type="button" className="btn ghost slim" onClick={() => setMobile(m => !m)}>{mobile ? "Desktop width" : "Phone width"}</button>
          <button type="button" className="btn ghost slim" onClick={() => setNonce(n => n + 1)} aria-label="Refresh preview"><RefreshCw /></button>
        </div>
      </div>
      <div className="card-b booking-preview">
        {error ? <p className="sub">{error} (The preview runs on the deployed site — locally it needs `vercel dev` for /api.)</p> : (
          <iframe title="Booking page preview" srcDoc={html} sandbox="allow-same-origin" style={{ width: mobile ? 375 : "100%" }} />
        )}
      </div>
    </section>
  );
}
