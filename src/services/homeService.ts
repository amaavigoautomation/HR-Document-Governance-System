import { apiJson } from './apiClient';
import type { WidgetTarget } from '../../shared/dashboard';
import type { AnnouncementKind, Celebrant, Mood, QuickLink, QuickReport } from '../../shared/home';

// The Home cards share the leave serverless function: /api/leave/home-<action>
const get = <T = any>(action: string, params: Record<string, string | number | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return apiJson<T>(`/api/leave/home-${action}${qs ? `?${qs}` : ''}`);
};
const post = <T = any>(action: string, body: unknown = {}) => apiJson<T>(`/api/leave/home-${action}`, body);

export type CardId =
  | 'mood' | 'calendar' | 'attendance' | 'quick-links' | 'quick-reports' | 'on-leave' | 'celebrations' | 'files'
  | 'ceo-speak' | 'announcements' | 'login-summary' | 'acknowledgements';

export interface HomeLayout {
  success: boolean;
  today: string;
  hiddenCards: string[];
  quickLinks: QuickLink[];
  quickReports: QuickReport[];
  can: { announce: boolean; manageHome: boolean; people: boolean; loginSummary: boolean; moodSummary: boolean; acknowledge: boolean };
}

export type PersonStatus = 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';

export interface HomeProfile {
  found: boolean;
  name?: string;
  title?: string;
  department?: string;
  empId?: string;
  joinDate?: string;
  reportingManager?: { name: string; title: string; status: PersonStatus } | null;
  approvingManager?: { name: string; title: string; status: PersonStatus; covering: boolean } | null;
}

export interface CalendarDay { date: string; status: string; pending?: boolean; holiday?: string; optional?: boolean }
export interface HomeCalendar {
  configured: boolean;
  month: string;
  today?: string;
  days?: CalendarDay[];
  legend?: { absent: number; leave: number; holiday: number; halfDay: number; unapproved: number; weekOff: number; optional: number };
}

export interface PunchRow { date: string; time: string; kind: 'IN' | 'OUT'; note: string }
export interface HomePunches { rows: PunchRow[]; total: number; page: number; pages: number; pageSize: number }

export interface OnLeaveRow { name: string; department: string; from: string; to: string; half: boolean }

export interface HomeWishes { range: string; today: string; birthdays: Celebrant[]; work: Celebrant[]; marriage: Celebrant[] }

export interface OrgFile { id: string; documentId: string; title: string; category: string; versionNumber: string; date: string; fileName: string; fileUrl: string }
export interface MyFile { id: string; kind: 'LETTER' | 'PAYSLIP'; title: string; date: string; month?: string; target: WidgetTarget }

export interface AckRow { documentId: string; title: string; versionNumber: string; at: string }
export interface HomeAcks {
  allowed: boolean;
  active?: { count: number; items: AckRow[] };
  completed?: { count: number; items: AckRow[] };
}

export interface AnnouncementRow { id: string; title: string; body: string; authorName: string; authorTitle: string; pinned: boolean; publishAt: string }

export interface ManagedAnnouncement {
  id: string; kind: AnnouncementKind; title: string; body: string; authorName: string; authorTitle: string;
  departmentIds: string[]; pinned: boolean; publishAt: string; expireAt: string; active: boolean; live: boolean;
}

export interface PersonDates {
  uid: string; name: string; email: string; empId: string; department: string;
  dob: string; marriageDate: string; showCelebrations: boolean; showMarriage: boolean;
}

export interface HomeSettingsView {
  hiddenCards: string[];
  quickLinks: QuickLink[];
  custom: boolean;
  onLeaveVisibility: 'COMPANY' | 'DEPARTMENT';
}

export const homeService = {
  layout: () => get<HomeLayout>('layout'),
  profile: () => get<HomeProfile>('profile'),
  calendar: (month?: string) => get<HomeCalendar>('calendar', { month }),
  punches: (page = 1) => get<HomePunches>('punches', { page }),
  onLeave: (scope: 'today' | 'future') => get<{ scope: string; count: number; rows: OnLeaveRow[] }>('on-leave', { scope }),
  wishes: (range: 'today' | 'week' | 'month') => get<HomeWishes>('wishes', { range }),
  orgFiles: () => get<{ items: OrgFile[] }>('files', { tab: 'org' }),
  myFiles: () => get<{ items: MyFile[] }>('files', { tab: 'employee' }),
  acks: () => get<HomeAcks>('acks'),
  announcements: (kind: AnnouncementKind) => get<{ kind: string; items: AnnouncementRow[] }>('announcements', { kind }),
  announcementsAll: (kind: AnnouncementKind) => get<{ kind: string; today: string; items: ManagedAnnouncement[]; departments: { id: string; name: string }[] }>('announcements-all', { kind }),
  saveAnnouncement: (b: unknown) => post<{ id: string }>('save-announcement', b),
  deleteAnnouncement: (id: string) => post('delete-announcement', { id }),
  mood: () => get<{ today: Mood | null }>('mood'),
  saveMood: (mood: Mood) => post<{ today: Mood }>('mood', { mood }),
  moodSummary: (days = 7) => get<{ days: number; responses: number; totals: Record<string, number> }>('mood-summary', { days }),
  loginEvent: () => post('login-event'),
  loginSummary: (days = 5) => get<{ days: number; series: { date: string; web: number; mobile: number }[] }>('login-summary', { days }),
  myDates: () => get<{ dob: string; marriageDate: string; showCelebrations: boolean; showMarriage: boolean }>('my-dates'),
  saveMyDates: (b: unknown) => post('my-dates', b),
  peopleDates: () => get<{ people: PersonDates[] }>('people-dates'),
  savePeopleDates: (rows: unknown[]) => post<{ saved: number; skipped: string[] }>('save-people-dates', { rows }),
  settings: () => get<{ settings: HomeSettingsView; cards: string[] }>('settings'),
  saveSettings: (b: unknown) => post('save-settings', b),
};
