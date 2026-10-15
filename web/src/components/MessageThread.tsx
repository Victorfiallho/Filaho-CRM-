import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Mail, MessageSquare, Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMessagingStatus, useThread } from "../data/hooks";
import { markThreadRead, sendMessage, syncThread } from "../data/messages";
import { formatDateTime } from "../domain/format";
import type { Customer, Message, MessageChannel } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import { errorMessage } from "../lib/errorMessage";
import { toastError } from "../lib/toast";

const SMS_SEGMENT = 160;

// One client's conversation over SMS and email, newest at the bottom, with a
// composer that switches between the two. The address always comes from the
// client record; the server sends and stores every message.
export default function MessageThread({ companyId, customer }: { companyId: string; customer: Customer }) {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const { data: messages = [], isLoading } = useThread(companyId, customer.id);
  const { data: setup, isError: setupUnknown } = useMessagingStatus(companyId);
  const listRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

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

  return (
    <div className="msg-thread">
      <div className="msg-list" ref={listRef} aria-live="polite">
        {isLoading ? null : messages.length === 0 ? (
          <p className="sub msg-empty">{t("msg.empty")}</p>
        ) : messages.map(m => <Bubble key={m.id} m={m} locale={locale} />)}
      </div>

      <form className="msg-composer" onSubmit={submit}>
        <div className="msg-composer-top">
          <div className="seg" role="group" aria-label={t("msg.channel")}>
            <button type="button" className={channel === "sms" ? "active" : ""} aria-pressed={channel === "sms"} onClick={() => pick("sms")} disabled={!hasPhone}>
              <MessageSquare aria-hidden="true" />SMS
            </button>
            <button type="button" className={channel === "email" ? "active" : ""} aria-pressed={channel === "email"} onClick={() => pick("email")} disabled={!hasEmail}>
              <Mail aria-hidden="true" />{t("msg.email")}
            </button>
          </div>
          {address && (
            <span className="sub msg-to">
              {channel === "email" && setup?.email_account ? t("msg.toVia", { address, account: setup.email_account }) : t("msg.to", { address })}
            </span>
          )}
        </div>
        {notice && <p className="msg-notice"><AlertTriangle aria-hidden="true" />{notice}</p>}
        {channel === "email" && (
          <input className="msg-subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder={t("msg.subject")} aria-label={t("msg.subject")} maxLength={200} />
        )}
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={3}
          placeholder={t(channel === "sms" ? "msg.placeholderSms" : "msg.placeholderEmail")}
          aria-label={t("msg.message")}
          maxLength={channel === "sms" ? 1600 : 10000}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e); }}
        />
        <div className="msg-composer-bottom">
          <span className="sub">{channel === "sms" && body ? t("msg.segments", { chars: body.length, segments }) : t("msg.shortcut")}</span>
          <button className="btn" type="submit" disabled={!canSend}>
            <Send aria-hidden="true" />{sending ? t("msg.sending") : t("msg.send")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ m, locale }: { m: Message; locale: string }) {
  const { t } = useT();
  const Icon = m.channel === "sms" ? MessageSquare : Mail;
  return (
    <div className={`msg msg-${m.direction}${m.status === "failed" ? " msg-failed" : ""}`}>
      {m.subject && <b className="msg-subject-line">{m.subject}</b>}
      <p>{m.body}</p>
      <span className="msg-meta">
        <Icon aria-hidden="true" />
        {formatDateTime(m.created_at, locale)}
        {m.status === "failed" && <> · <span className="msg-error">{t("msg.failed")}{m.error ? `: ${m.error}` : ""}</span></>}
      </span>
    </div>
  );
}
