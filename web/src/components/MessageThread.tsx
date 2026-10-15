import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Mail, MessageSquare, Send } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useMessagingStatus, useThread } from "../data/hooks";
import { markThreadRead, sendMessage, syncThread } from "../data/messages";
import { clockTime, dayKey, dayLabel } from "../domain/messages";
import type { Customer, Message, MessageChannel } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import { errorMessage } from "../lib/errorMessage";
import { toastError } from "../lib/toast";

const SMS_SEGMENT = 160;

// One client's conversation over SMS and email, newest at the bottom, with a
// composer that switches between the two. The address always comes from the
// client record; the server sends and stores every message.
export default function MessageThread({ companyId, customer, fill = false }: { companyId: string; customer: Customer; fill?: boolean }) {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const { data: messages = [], isLoading } = useThread(companyId, customer.id);
  const { data: setup, isError: setupUnknown } = useMessagingStatus(companyId);
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const hasPhone = Boolean(customer.phone);
  const hasEmail = Boolean(customer.email);
  const lastChannel = messages.length ? messages[messages.length - 1].channel : null;
  const [channel, setChannel] = useState<MessageChannel>(() => (hasPhone ? "sms" : "email"));
  const [touched, setTouched] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // Follow the conversation: answer on the channel the last message used,
  // until the user picks one.
  useEffect(() => {
    if (!touched && lastChannel) setChannel(lastChannel);
  }, [lastChannel, touched]);

  // Stay pinned to the newest message while the user is at the bottom, also
  // when the list resizes (composer grows, notices appear, fonts load).
  const atBottom = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const toBottom = () => { if (atBottom.current) el.scrollTop = el.scrollHeight; };
    const onScroll = () => { atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; };
    el.addEventListener("scroll", onScroll);
    const observer = new ResizeObserver(toBottom);
    observer.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); observer.disconnect(); };
  }, []);
  useEffect(() => {
    atBottom.current = true;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, isLoading]);

  // Grow the box with the text, up to a few lines.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [body]);

  // Pull this client's latest Gmail emails in when the conversation opens,
  // instead of waiting for the 15-minute background sync.
  const gmail = setup?.email_via === "gmail";
  useEffect(() => {
    if (!gmail || !customer.email) return;
    syncThread(companyId, customer.id)
      .then(r => { if (r.synced) queryClient.invalidateQueries({ queryKey: ["messages", companyId] }); })
      .catch(() => { /* the background sync catches up */ });
  }, [gmail, companyId, customer.id, customer.email, queryClient]);

  const unread = messages.some(m => m.direction === "in" && !m.read_at);
  useEffect(() => {
    if (!unread) return;
    markThreadRead(companyId, customer.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ["messages", companyId] }))
      .catch(() => { /* read marks are best effort */ });
  }, [unread, companyId, customer.id, queryClient]);

  const address = channel === "sms" ? customer.phone : customer.email;
  const configured = setup ? setup[channel] : false;
  const segments = Math.max(1, Math.ceil(body.length / SMS_SEGMENT));
  const canSend = Boolean(address) && configured && body.trim().length > 0 && !sending;

  const notice = !address
    ? t(channel === "sms" ? "msg.noPhone" : "msg.noEmail")
    : setupUnknown
      ? t("msg.setupUnknown")
      : setup && !configured
        ? t(channel === "sms" ? "msg.smsNotSetUp" : "msg.emailNotSetUp")
        : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    try {
      await sendMessage({ companyId, customerId: customer.id, channel, subject: channel === "email" ? subject : undefined, body });
      setBody("");
      setSubject("");
    } catch (error) {
      toastError(errorMessage(error, t("msg.sendFailed")));
    } finally {
      setSending(false);
      queryClient.invalidateQueries({ queryKey: ["messages", companyId] });
    }
  }

  const pick = (next: MessageChannel) => { setTouched(true); setChannel(next); };
  const words = { today: t("msg.today"), yesterday: t("msg.yesterday") };

  return (
    <div className={`msg-thread${fill ? " msg-thread-fill" : ""}`}>
      <div className="msg-list" ref={listRef} aria-live="polite">
        {isLoading ? null : messages.length === 0 ? (
          <div className="msg-empty">
            <span className="msg-empty-icon" aria-hidden="true"><MessageSquare /></span>
            <p className="sub">{t("msg.empty")}</p>
          </div>
        ) : messages.map((m, i) => {
          const newDay = i === 0 || dayKey(messages[i - 1].created_at) !== dayKey(m.created_at);
          const grouped = !newDay && messages[i - 1].direction === m.direction && messages[i - 1].channel === m.channel;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="msg-day"><span>{dayLabel(m.created_at, locale, words)}</span></div>}
              <Bubble m={m} locale={locale} grouped={grouped} />
            </Fragment>
          );
        })}
      </div>

      <form className="msg-compose" onSubmit={submit}>
        <div className="msg-compose-head">
          <div className="msg-tabs" role="tablist" aria-label={t("msg.channel")}>
            <button type="button" role="tab" aria-selected={channel === "sms"} className={channel === "sms" ? "active" : ""} onClick={() => pick("sms")} disabled={!hasPhone} title={hasPhone ? undefined : t("msg.noPhone")}>
              <MessageSquare aria-hidden="true" />SMS
            </button>
            <button type="button" role="tab" aria-selected={channel === "email"} className={channel === "email" ? "active" : ""} onClick={() => pick("email")} disabled={!hasEmail} title={hasEmail ? undefined : t("msg.noEmail")}>
              <Mail aria-hidden="true" />{t("msg.email")}
            </button>
          </div>
          {address && (
            <span className="msg-route">
              {channel === "email" && setup?.email_account ? t("msg.toVia", { address, account: setup.email_account }) : t("msg.to", { address })}
            </span>
          )}
        </div>
        {notice && <p className="msg-notice"><AlertTriangle aria-hidden="true" />{notice}</p>}
        <div className="msg-box">
          {channel === "email" && (
            <input className="msg-subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder={t("msg.subjectOptional")} aria-label={t("msg.subject")} maxLength={200} />
          )}
          <textarea
            ref={bodyRef}
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={2}
            placeholder={t(channel === "sms" ? "msg.placeholderSms" : "msg.placeholderEmail")}
            aria-label={t("msg.message")}
            maxLength={channel === "sms" ? 1600 : 10000}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e); }}
          />
          <div className="msg-box-foot">
            <span className="msg-hint">{channel === "sms" && body ? t("msg.segments", { chars: body.length, segments }) : t("msg.shortcut")}</span>
            <button className="msg-send" type="submit" disabled={!canSend} aria-label={t("msg.send")}>
              <Send aria-hidden="true" /><span>{sending ? t("msg.sending") : t("msg.send")}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Bubble({ m, locale, grouped }: { m: Message; locale: string; grouped: boolean }) {
  const { t } = useT();
  return (
    <div className={`msg msg-${m.direction} msg-${m.channel}${m.status === "failed" ? " msg-failed" : ""}${grouped ? " msg-grouped" : ""}`}>
      {m.channel === "email" && m.subject && <span className="msg-subject-line"><Mail aria-hidden="true" />{m.subject}</span>}
      <p>{m.body}</p>
      <span className="msg-meta">
        {m.channel === "sms" ? <MessageSquare aria-hidden="true" /> : <Mail aria-hidden="true" />}
        {clockTime(m.created_at, locale)}
        {m.status === "failed" && <span className="msg-error"> · {t("msg.failed")}{m.error ? `: ${m.error}` : ""}</span>}
      </span>
    </div>
  );
}
