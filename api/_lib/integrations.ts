/**
 * Outside connections (Microsoft Teams, WhatsApp). Each one is OFF until its credentials are set in Vercel, and everything
 * works without them: HR pastes a meeting link and sends the message by hand. Google Meet is connected per company (see
 * googleCalendar.ts); ClickUp is manual (HR ticks the task).
 *
 *   Teams:    MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_ORGANIZER_UPN  (app permission OnlineMeetings.ReadWrite.All)
 *   WhatsApp: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID  (WhatsApp Cloud API; first messages need an approved template)
 */
const env = (k: string) => (process.env[k] || '').trim();
export const teamsOn = () => !!(env('MS_TENANT_ID') && env('MS_CLIENT_ID') && env('MS_CLIENT_SECRET') && env('MS_ORGANIZER_UPN'));
export const whatsappOn = () => !!(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_ID'));

export function integrationStatus(google?: { platformReady: boolean; connected: boolean; needsReconnect: boolean; email: string } | null) {
  const gOn = !!google?.connected;
  const gManual = !google?.platformReady ? 'Manual: paste the Meet link when scheduling. (The platform owner has not set up Google yet.)'
    : google.needsReconnect ? 'Manual until a Company Admin connects Google Calendar again (the old connection stopped working).'
    : 'Manual until a Company Admin connects Google Calendar (Administration > Integrations).';
  return [
    { key: 'teams', label: 'Microsoft Teams meeting links', on: teamsOn(), manual: 'HR pastes the meeting link when scheduling.' },
    { key: 'whatsapp', label: 'WhatsApp reminders', on: whatsappOn(), manual: 'Reminders go by email only.' },
    { key: 'google_meet', label: gOn ? `Google Meet / Calendar (${google!.email || 'connected'})` : 'Google Meet / Calendar', on: gOn, manual: gManual },
    { key: 'clickup', label: 'ClickUp tasks', on: false, manual: 'Manual: tick the setup task on the joining board.' },
  ];
}

async function withTimeout(url: string, init: any, ms = 10000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}

/** Creates a Teams meeting and returns its join link, or null when Teams is off or the call fails (the caller keeps the manual link). */
export async function createTeamsMeeting(subject: string, startIso: string, endIso: string): Promise<string | null> {
  if (!teamsOn()) return null;
  try {
    const tr = await withTimeout(`https://login.microsoftonline.com/${encodeURIComponent(env('MS_TENANT_ID'))}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env('MS_CLIENT_ID'), client_secret: env('MS_CLIENT_SECRET'), scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(),
    });
    const tj: any = await tr.json();
    if (!tj.access_token) return null;
    const mr = await withTimeout(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env('MS_ORGANIZER_UPN'))}/onlineMeetings`, {
      method: 'POST', headers: { Authorization: `Bearer ${tj.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, startDateTime: startIso, endDateTime: endIso }),
    });
    const mj: any = await mr.json();
    return typeof mj.joinWebUrl === 'string' ? mj.joinWebUrl : null;
  } catch { return null; }
}

/** Sends a WhatsApp text. Returns false when WhatsApp is off or the send fails. */
export async function sendWhatsApp(toMobile: string, text: string): Promise<boolean> {
  if (!whatsappOn()) return false;
  const digits = String(toMobile || '').replace(/\D/g, '');
  const to = digits.length === 10 ? `91${digits}` : digits;
  if (to.length < 11) return false;
  try {
    const r = await withTimeout(`https://graph.facebook.com/v20.0/${encodeURIComponent(env('WHATSAPP_PHONE_ID'))}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 1000) } }),
    });
    return r.ok;
  } catch { return false; }
}
