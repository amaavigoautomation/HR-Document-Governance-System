import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, ThumbsUp, ThumbsDown, RotateCcw, Mail, FileText, Database } from 'lucide-react';
import { assistantService, type AssistantSource } from '../../services/assistantService';

interface Msg { role: 'user' | 'assistant'; content: string; id?: string; sources?: AssistantSource[]; unsure?: boolean; rated?: boolean | null; sent?: string; question?: string }

/** Other parts of the app (the Ctrl+K search) open the panel with a question by firing this event. */
export const ASK_HR_EVENT = 'ask-hr:open';
export const openAskHr = (question?: string) => window.dispatchEvent(new CustomEvent(ASK_HR_EVENT, { detail: { question } }));

const SUGGESTIONS = ['How many casual leaves do I have?', 'What is the notice period?', 'What are the upcoming holidays?', 'What is the leave carry forward rule?'];
const KEY = (uid: string) => `ask-hr-chat:${uid}`;

export const AskHrPanel: React.FC<{ userId: string }> = ({ userId }) => {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(KEY(userId)) || '[]'); return Array.isArray(v) ? v.slice(-20) : []; } catch { return []; }
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;

  useEffect(() => { try { localStorage.setItem(KEY(userId), JSON.stringify(msgs.slice(-20))); } catch { /* storage full or blocked */ } }, [msgs, userId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const history = msgsRef.current.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setText('');
    setBusy(true);
    try {
      const r = await assistantService.ask(question, history);
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, id: r.id, sources: r.sources || [], unsure: r.unsure, question }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: e?.message || 'Something went wrong. Please try again.', unsure: true, question }]);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const h = (e: Event) => {
      const q = String((e as CustomEvent).detail?.question || '').trim();
      setOpen(true);
      if (q) void send(q);
    };
    window.addEventListener(ASK_HR_EVENT, h);
    return () => window.removeEventListener(ASK_HR_EVENT, h);
  });

  const rate = (i: number, helpful: boolean) => {
    const m = msgs[i];
    if (!m?.id) return;
    setMsgs((all) => all.map((x, j) => (j === i ? { ...x, rated: helpful } : x)));
    void assistantService.feedback(m.id, helpful).catch(() => undefined);
  };
  const askHr = async (i: number) => {
    const m = msgs[i];
    if (!m?.question) return;
    setMsgs((all) => all.map((x, j) => (j === i ? { ...x, sent: 'Sending to HR...' } : x)));
    try {
      const r = await assistantService.askHr(m.question, m.id);
      setMsgs((all) => all.map((x, j) => (j === i ? { ...x, sent: r.message } : x)));
    } catch (e: any) {
      setMsgs((all) => all.map((x, j) => (j === i ? { ...x, sent: e?.message || 'Could not send. Please try again.' } : x)));
    }
  };

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Open Ask HR" className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[#6d4cf0] px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-[#5b3be0] cursor-pointer">
          <MessageCircle className="h-4 w-4" /> Ask HR
        </button>
      )}
      {open && (
        <aside role="dialog" aria-label="Ask HR" className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-200 bg-white shadow-2xl sm:w-[400px]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Ask HR</p>
              <p className="text-[11px] text-slate-500">Answers from your own data and company policies</p>
            </div>
            <div className="flex items-center gap-1">
              {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} title="New chat" aria-label="New chat" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 cursor-pointer"><RotateCcw className="h-4 w-4" /></button>}
              <button type="button" onClick={() => setOpen(false)} title="Close" aria-label="Close" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {msgs.length === 0 && (
              <div>
                <p className="text-sm text-slate-700">Hi, ask me about your leave, holidays, notice period, payslips or company policies.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:border-orange-300 hover:text-[#FA7014] cursor-pointer">{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#FA7014] px-3 py-2 text-sm text-white">{m.content}</p></div>
            ) : (
              <div key={i} className="max-w-[92%]">
                <p className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">{m.content}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.sources.map((s, k) => (
                      <span key={k} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${s.kind === 'data' ? 'bg-emerald-50 text-emerald-700' : 'border border-slate-300 text-slate-600'}`}>
                        {s.kind === 'data' ? <Database className="h-3 w-3" /> : <FileText className="h-3 w-3" />}{s.label}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  {m.id && (
                    <>
                      <button type="button" onClick={() => rate(i, true)} aria-label="Helpful" className={`rounded p-1 hover:bg-slate-200 cursor-pointer ${m.rated === true ? 'text-emerald-600' : ''}`}><ThumbsUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => rate(i, false)} aria-label="Not helpful" className={`rounded p-1 hover:bg-slate-200 cursor-pointer ${m.rated === false ? 'text-red-600' : ''}`}><ThumbsDown className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                  {m.question && !m.sent && <button type="button" onClick={() => void askHr(i)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 cursor-pointer ${m.unsure || m.rated === false ? 'border-orange-300 text-[#FA7014]' : 'border-slate-200 hover:border-orange-300'}`}><Mail className="h-3 w-3" /> Ask HR instead</button>}
                  {m.sent && <span>{m.sent}</span>}
                </div>
              </div>
            ))}
            {busy && <p className="text-xs text-slate-500">Looking that up...</p>}
            <div ref={end} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="border-t border-slate-200 bg-white p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef} value={text} rows={1} maxLength={500} placeholder="Type your question..."
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
                className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#FA7014] focus:outline-none focus:ring-2 focus:ring-[#FA7014]/20"
              />
              <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FA7014] text-white disabled:opacity-40 cursor-pointer"><Send className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">Ask HR can make mistakes. For anything important, confirm with HR.</p>
          </form>
        </aside>
      )}
    </>
  );
};
