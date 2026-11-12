import { createModuleNav, NavItem } from '../moduleNav';

export type Section =
  | 'dash' | 'org' | 'map' | 'talent' | 'kpi' | 'pip' | 'retention' | 'succ' | 'needs' | 'paths' | 'certs' | 'surveysAdmin' | 'wellAdmin'
  | 'pos' | 'transfer' | 'bunits' | 'probation' | 'okr' | 'promo' | 'quarterly' | 'me' | 'learning' | 'pulse' | 'recog' | 'well';

type Entry = { key: Section; label: string };

const CYCLE: Entry[] = [{ key: 'okr', label: 'OKRs' }, { key: 'probation', label: 'Probation' }, { key: 'promo', label: 'Promotions' }];
const SELF: Entry[] = [
  { key: 'me', label: 'My HRBP' }, { key: 'learning', label: 'My learning' }, { key: 'pulse', label: 'Pulse surveys' }, { key: 'recog', label: 'Recognition' }, { key: 'well', label: 'Wellness' },
];
const VIEW: Entry[] = [{ key: 'dash', label: 'Leadership dashboard' }, { key: 'org', label: 'Org & resources' }];
const MANAGE: Entry[] = [
  { key: 'map', label: 'People mapping' }, { key: 'bunits', label: 'Business units' }, { key: 'pos', label: 'Positions' }, { key: 'transfer', label: 'Transfers' }, { key: 'talent', label: 'Talent review' }, { key: 'kpi', label: 'KPIs' }, { key: 'pip', label: 'Improvement plans' },
  { key: 'retention', label: 'Retention' }, { key: 'succ', label: 'Succession' }, { key: 'needs', label: 'Training needs' }, { key: 'paths', label: 'Learning paths' },
  { key: 'certs', label: 'Certificates' }, { key: 'surveysAdmin', label: 'Survey admin' }, { key: 'wellAdmin', label: 'Wellness admin' },
];

const ALL_KEYS: string[] = [...VIEW, ...MANAGE, ...CYCLE, { key: 'quarterly', label: '' }, ...SELF].map((e) => e.key);

/** Sections of the HR Business Partner module. Each `group` is a collapsible dropdown in the app sidebar. */
export const hrbpNav = createModuleNav('amaavigo_hrbp_tab', ALL_KEYS, 'dash', {});

/** What this person may open. People without leadership access start on "My HRBP", so "For everyone" comes first for them. */
export const hrbpNavItems = (view: boolean, manage: boolean): NavItem[] => {
  const tag = (group: string, list: Entry[]): NavItem[] => list.map((e) => ({ key: e.key, label: e.label, group }));
  const everyone = tag('For everyone', SELF);
  if (!view) return [...everyone, ...tag('Probation & growth', CYCLE)];
  return [
    ...tag('Leadership', VIEW),
    ...(manage ? [...tag('HRBP toolkit', MANAGE), ...tag('Probation & growth', [...CYCLE, { key: 'quarterly', label: 'Quarterly round' }])] : tag('Probation & growth', CYCLE)),
    ...everyone,
  ];
};
