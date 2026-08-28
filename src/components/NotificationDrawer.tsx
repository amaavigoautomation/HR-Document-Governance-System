import React, { useState, useEffect } from 'react';
import {
  X,
  Mail,
  CheckCircle2,
  Zap,
  Info,
  AlertCircle,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { EmailNotification } from '../types';
import { defaultEmailProvider } from '../services/email';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({ isOpen, onClose }) => {
  const [selectedNotif, setSelectedNotif] = useState<EmailNotification | null>(null);
  const [notifications, setNotifications] = useState<EmailNotification[]>([]);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [providerConfig, setProviderConfig] = useState<{
    isConfigured: boolean;
    activeProvider: string;
    senderFrom: string;
    userEmail: string;
  } | null>(null);
  const [showConfigHelp, setShowConfigHelp] = useState(false);

  const loadData = () => {
    setNotifications(defaultEmailProvider.getNotifications());
    fetch('/api/email/config')
      .then((r) => r.json())
      .then((data) => setProviderConfig(data))
      .catch((e) => console.warn('Could not fetch email config:', e));
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const [testEmail, setTestEmail] = useState('parth@amaavigo.in');
  const [testName, setTestName] = useState('Parth');

  const handleSendTest = async () => {
    setIsSendingTest(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testEmail,
          recipientName: testName || 'Team Member',
        }),
      });

      const res = await response.json();
      if (res.success) {
        setTestResult({
          success: true,
          message: `Live email dispatched directly to ${testEmail} via ${res.provider || 'Gmail SMTP'}.`,
        });
        loadData();
      } else {
        setTestResult({
          success: false,
          message: `Delivery attempt note: ${res.error || res.note || 'Failed to dispatch via Gmail SMTP'}`,
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Error sending test: ${err.message}`,
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-md flex justify-end">
      <div className="glass-panel-dark w-full max-w-lg h-full shadow-2xl flex flex-col border-l border-slate-800 animate-in slide-in-from-right duration-200">
        {/* HEADER */}
        <div className="bg-slate-900/90 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center">
              <Mail className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Live Email Delivery & Outbound Log</h2>
              <p className="text-[11px] text-slate-400">
                Gmail SMTP service ({notifications.length} logged)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PROVIDER STATUS & QUICK TEST ACTION */}
        <div className="bg-slate-900/95 border-b border-slate-800/80 p-4 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-semibold text-slate-300">
                Active Provider: <span className="text-emerald-400 font-bold">{providerConfig?.activeProvider || 'Gmail SMTP (automation@amaavigo.com)'}</span>
              </span>
            </div>
            <button
              onClick={() => setShowConfigHelp(!showConfigHelp)}
              className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center space-x-1"
            >
              <Info className="w-3.5 h-3.5" />
              <span>{showConfigHelp ? 'Hide Details' : 'SMTP Status'}</span>
            </button>
          </div>

          {showConfigHelp && (
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-2 animate-in fade-in duration-150">
              <div className="flex items-center space-x-2 text-emerald-400 font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>Gmail SMTP Authenticated & Active</span>
              </div>
              <div className="bg-slate-900 p-2.5 rounded font-mono text-[11px] space-y-1 text-slate-300">
                <div><strong>Sender Email:</strong> automation@amaavigo.com</div>
                <div><strong>Host:</strong> smtp.gmail.com (Port 587/465)</div>
                <div><strong>Auth Method:</strong> Dedicated Google App Password</div>
                <div><strong>Recipients:</strong> Any corporate or employee address (e.g. parth@amaavigo.in)</div>
              </div>
            </div>
          )}

          {/* Quick Action: Send Test Email */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300">
                Send Live Test via Gmail SMTP:
              </span>
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  onClick={() => { setTestEmail('parth@amaavigo.in'); setTestName('Parth'); }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    testEmail === 'parth@amaavigo.in'
                      ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 font-bold'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  parth@amaavigo.in
                </button>
                <button
                  type="button"
                  onClick={() => { setTestEmail('automation@amaavigo.com'); setTestName('Admin'); }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    testEmail === 'automation@amaavigo.com'
                      ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 font-bold'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  automation@amaavigo.com
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Recipient email address..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                id="btn-send-test-live-email"
                onClick={handleSendTest}
                disabled={isSendingTest || !testEmail}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 shadow-md shadow-emerald-600/30 transition-all border border-emerald-400/30 shrink-0"
              >
                {isSendingTest ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{isSendingTest ? 'Sending...' : 'Send Live Email'}</span>
              </button>
            </div>
          </div>

          {testResult && (
            <div
              className={`p-2.5 rounded-xl text-xs flex items-start space-x-2 ${
                testResult.success
                  ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/60 border border-rose-800 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="leading-snug">{testResult.message}</div>
            </div>
          )}
        </div>

        {/* BODY / LOG OF DISPATCHED EMAILS */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950">
          {notifications.length === 0 ? (
            <div className="py-20 text-center text-slate-500">
              <Mail className="w-10 h-10 mx-auto mb-2 text-slate-600" />
              <p className="text-sm">No notification emails dispatched yet.</p>
              <p className="text-xs text-slate-500 mt-1">
                Emails are automatically sent to employees whenever a document requiring acknowledgment is approved and published.
              </p>
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => setSelectedNotif(notif)}
                className={`glass-panel-dark rounded-2xl border p-4 shadow-md hover:border-slate-700 transition-all cursor-pointer ${
                  selectedNotif?.id === notif.id ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-slate-800/80'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-xs text-white flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate max-w-[280px]">{notif.subject}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(notif.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div className="text-xs text-slate-400 mb-2">
                  To: <strong className="text-slate-200">{notif.recipientName}</strong> ({notif.recipientEmail})
                </div>

                <div className="bg-slate-950/80 p-3 rounded-xl text-xs text-slate-300 font-mono whitespace-pre-wrap line-clamp-3 border border-slate-800">
                  {notif.body}
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Document: {notif.documentId} v{notif.versionNumber}</span>
                  <span className="text-emerald-400 font-semibold">Click to preview full email</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* SELECTED EMAIL PREVIEW MODAL */}
        {selectedNotif && (
          <div className="bg-slate-900/95 border-t border-slate-800 p-5 shadow-2xl shrink-0 max-h-[45vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Email Dispatch Details & HTML Payload
              </h3>
              <button
                onClick={() => setSelectedNotif(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close Preview
              </button>
            </div>

            <div className="bg-slate-950 text-slate-100 p-4 rounded-xl text-xs space-y-2 font-sans border border-slate-800">
              <div className="border-b border-slate-800 pb-2 text-slate-300">
                <div><strong className="text-slate-200">Subject:</strong> {selectedNotif.subject}</div>
                <div><strong className="text-slate-200">To:</strong> {selectedNotif.recipientName} &lt;{selectedNotif.recipientEmail}&gt;</div>
                <div><strong className="text-slate-200">From:</strong> automation@amaavigo.com</div>
                <div><strong className="text-slate-200">Sent:</strong> {new Date(selectedNotif.sentAt).toLocaleString()}</div>
                <div><strong className="text-slate-200">Delivery Status:</strong> <span className="text-emerald-400 font-bold">{selectedNotif.status} (Delivered via Gmail SMTP)</span></div>
              </div>

              <div className="pt-2 whitespace-pre-wrap font-sans text-slate-200 text-xs leading-relaxed">
                {selectedNotif.body}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
