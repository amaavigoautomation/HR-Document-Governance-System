import React, { useEffect, useState } from 'react';
import {
  BellRing,
  Briefcase,
  CalendarCheck,
  Check,
  FileText,
  IndianRupee,
  KanbanSquare,
  Lock,
  MessageSquare,
  Network,
  ScrollText,
  Sparkles,
  Target,
  Users,
  Video,
  X,
} from 'lucide-react';
import { CountUp, Reveal, prefersReducedMotion, useInView, useParallax } from './hooks';
import { MODULES, type IconType } from './data';
import type { ModuleKey } from './routes';

const HUES = ['#6d4cf0', '#2f9e77', '#d98324', '#3b82c4', '#d4577c', '#1f9aa3', '#64748b'];

export const Avatar: React.FC<{ name: string; size?: number; i?: number }> = ({ name, size = 28, i = 0 }) => {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const hue = HUES[(name.length + i) % HUES.length];
  return (
    <span className="lp-avatar" style={{ width: size, height: size, background: `${hue}1f`, color: hue, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
};

export const MockWindow: React.FC<{ title: string; badge?: string; className?: string; children: React.ReactNode }> = ({
  title,
  badge = 'SAMPLE VIEW',
  className = '',
  children,
}) => {
  // Bars, rings and cards animate in only once the window is actually on screen.
  const [ref, seen] = useInView<HTMLDivElement>(0.2);
  return (
    <div ref={ref} className={`lp-window ${seen ? 'lp-live' : ''} ${className}`}>
      <div className="lp-window-top">
        <span className="lp-window-dots"><i /><i /><i /></span>
        <span className="lp-window-title">{title}</span>
        <span className="lp-window-badge"><i /> {badge}</span>
      </div>
      <div className="lp-window-body">{children}</div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Hero scene                                                          */
/* ------------------------------------------------------------------ */

const TOASTS: { icon: IconType; tone: string; title: string; sub: string }[] = [
  { icon: Check, tone: 'green', title: 'Offer accepted', sub: 'Joining checklist created' },
  { icon: CalendarCheck, tone: 'violet', title: 'Leave approved', sub: 'Manager approved 2 days' },
  { icon: IndianRupee, tone: 'amber', title: 'Payslips ready', sub: 'Monthly run is locked' },
  { icon: Video, tone: 'blue', title: 'Interview booked', sub: 'Meet link sent to 3 people' },
  { icon: Sparkles, tone: 'rose', title: 'Skills test marked', sub: 'Scored automatically' },
  { icon: ScrollText, tone: 'teal', title: 'Policy published', sub: '62 of 70 acknowledged' },
];

export const ToastFeed: React.FC = () => {
  const [n, setN] = useState(2);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = window.setInterval(() => setN((v) => v + 1), 2600);
    return () => window.clearInterval(id);
  }, []);
  const items = [0, 1, 2]
    .map((offset) => n - offset)
    .filter((abs) => abs >= 0)
    .map((abs) => ({ abs, ...TOASTS[abs % TOASTS.length] }));
  return (
    <div className="lp-toasts" aria-hidden="true">
      {items.map((t, i) => {
        const Icon = t.icon;
        return (
          <div key={t.abs} className={`lp-toast tone-${t.tone}`} style={{ ['--o' as string]: i }}>
            <span className="lp-toast-icon"><Icon size={15} /></span>
            <span><b>{t.title}</b><small>{t.sub}</small></span>
          </div>
        );
      })}
    </div>
  );
};

const FUNNEL = [
  { label: 'Applied', v: 100 },
  { label: 'Tested', v: 72 },
  { label: 'Interview', v: 44 },
  { label: 'Offer', v: 18 },
];

export const HeroScene: React.FC = () => {
  const ref = useParallax<HTMLDivElement>();
  return (
    <div className="lp-hero-scene" ref={ref} aria-label="Illustration of the Amaavigo workspace">
      <div className="lp-blob lp-blob-a" />
      <div className="lp-blob lp-blob-b" />
      <div className="lp-ring lp-ring-1" />
      <div className="lp-ring lp-ring-2" />

      <div className="lp-layer lp-layer-main">
        <MockWindow title="WORKSPACE OVERVIEW">
          <div className="lp-dash-head">
            <div><small>GOOD MORNING</small><h4>People operations</h4></div>
            <div className="lp-avatars"><Avatar name="Hema R" i={0} /><Avatar name="Omar K" i={1} /><Avatar name="Priya S" i={2} /><span>+4</span></div>
          </div>
          <div className="lp-tiles">
            <div className="lp-tile"><span className="lp-tile-icon tone-violet"><Briefcase size={15} /></span><small>Open roles</small><strong><CountUp value={6} /></strong></div>
            <div className="lp-tile"><span className="lp-tile-icon tone-green"><CalendarCheck size={15} /></span><small>Leave pending</small><strong><CountUp value={4} /></strong></div>
            <div className="lp-tile"><span className="lp-tile-icon tone-blue"><Users size={15} /></span><small>People</small><strong><CountUp value={246} /></strong></div>
          </div>
          <div className="lp-funnel">
            <div className="lp-funnel-head"><b>Hiring funnel</b><span>This month</span></div>
            {FUNNEL.map((f, i) => (
              <div className="lp-funnel-row" key={f.label}>
                <small>{f.label}</small>
                <div className="lp-funnel-bar"><i style={{ ['--w' as string]: `${f.v}%`, ['--i' as string]: i }} /></div>
                <em>{f.v}</em>
              </div>
            ))}
          </div>
        </MockWindow>
      </div>

      <div className="lp-layer lp-layer-front"><ToastFeed /></div>

      <div className="lp-layer lp-layer-chip lp-chip-a">
        <span className="lp-chip"><span className="lp-chip-icon tone-violet"><Sparkles size={14} /></span><span><b>Ask HR</b><small>“How many leave days do I have?”</small></span></span>
      </div>
      <div className="lp-layer lp-layer-chip lp-chip-b">
        <span className="lp-chip"><span className="lp-chip-icon tone-green"><Check size={14} /></span><span><b>All approvals up to date</b><small>Nothing waiting on you</small></span></span>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Module visuals                                                      */
/* ------------------------------------------------------------------ */

const Kanban: React.FC = () => {
  const cols = [
    { name: 'Applied', items: [{ n: 'Ananya Rao', r: 'Product designer', s: 82 }, { n: 'Karan Shah', r: 'Product designer', s: 76 }] },
    { name: 'Interview', items: [{ n: 'Meera Patel', r: 'Product designer', s: 91 }, { n: 'Rohan Das', r: 'Backend engineer', s: 85 }] },
    { name: 'Offer', items: [{ n: 'Dev Thomas', r: 'Backend engineer', s: 88 }] },
  ];
  return (
    <MockWindow title="HIRING PIPELINE">
      <div className="lp-kanban">
        {cols.map((c, ci) => (
          <div className="lp-kcol" key={c.name}>
            <div className="lp-kcol-head">{c.name}<span>{c.items.length}</span></div>
            {c.items.map((it, ii) => (
              <div className="lp-kcard" key={it.n} style={{ ['--i' as string]: ci * 2 + ii }}>
                <Avatar name={it.n} i={ci + ii} size={26} />
                <div><b>{it.n}</b><small>{it.r}</small></div>
                <span className="lp-score">{it.s}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="lp-meta-row"><span><Sparkles size={13} /> Ranked against the job description</span><span><Video size={13} /> Meet links created for you</span></div>
    </MockWindow>
  );
};

const LeaveVisual: React.FC = () => {
  const cells = Array.from({ length: 35 }, (_, i) => {
    const d = i - 2;
    if (d < 1 || d > 30) return { d: '', cls: 'is-empty' };
    const weekend = i % 7 === 5 || i % 7 === 6;
    let cls = weekend ? 'is-off' : '';
    if ([9, 10].includes(d)) cls = 'is-leave';
    if (d === 14) cls = 'is-holiday';
    if ([22, 23, 24].includes(d)) cls = 'is-leave';
    if (d === 17) cls = 'is-today';
    return { d: String(d), cls };
  });
  const balances = [
    { n: 'Annual leave', v: 11, t: 18 },
    { n: 'Sick leave', v: 6, t: 8 },
    { n: 'Casual leave', v: 4, t: 6 },
  ];
  return (
    <MockWindow title="LEAVE & ATTENDANCE">
      <div className="lp-split">
        <div>
          <div className="lp-cal-head"><b>November</b><span>Team calendar</span></div>
          <div className="lp-cal">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <small key={i}>{d}</small>)}
            {cells.map((c, i) => <span key={i} className={`lp-cal-cell ${c.cls}`}>{c.d}</span>)}
          </div>
        </div>
        <div className="lp-balances">
          <b>Your balances</b>
          {balances.map((b, i) => (
            <div key={b.n} className="lp-balance">
              <div><small>{b.n}</small><em>{b.v} / {b.t}</em></div>
              <div className="lp-bar"><i style={{ ['--w' as string]: `${(b.v / b.t) * 100}%`, ['--i' as string]: i }} /></div>
            </div>
          ))}
          <div className="lp-approval"><Avatar name="Sana Iqbal" size={24} /><span><b>Sana</b><small>2 days · waiting</small></span><button type="button" tabIndex={-1}><Check size={13} /> Approve</button></div>
        </div>
      </div>
    </MockWindow>
  );
};

const PayrollVisual: React.FC = () => {
  const bars = [52, 61, 58, 70, 66, 78];
  const rows = [
    ['Basic', '₹ 52,000'],
    ['House rent allowance', '₹ 26,000'],
    ['Provident fund', '− ₹ 6,240'],
    ['Professional tax', '− ₹ 200'],
    ['Income tax (TDS)', '− ₹ 4,100'],
  ];
  return (
    <MockWindow title="PAYROLL RUN">
      <div className="lp-split">
        <div className="lp-payslip">
          <div className="lp-payslip-head"><b>Payslip</b><span>Sample</span></div>
          {rows.map(([a, b]) => (
            <div key={a} className="lp-pay-row"><span>{a}</span><b className={b.startsWith('−') ? 'is-minus' : ''}>{b}</b></div>
          ))}
          <div className="lp-pay-net"><span>Net pay</span><strong>₹ <CountUp value={66960} format /></strong></div>
        </div>
        <div className="lp-chart">
          <b>Payroll cost, last six months</b>
          <div className="lp-bars">
            {bars.map((h, i) => (
              <div key={i} className="lp-vbar"><i style={{ ['--h' as string]: `${h}%`, ['--i' as string]: i }} /><small>{['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'][i]}</small></div>
            ))}
          </div>
          <div className="lp-lock"><Lock size={13} /> Review, approve, then lock the month</div>
        </div>
      </div>
    </MockWindow>
  );
};

const Ring: React.FC<{ pct: number; label: string; tone: string; i: number }> = ({ pct, label, tone, i }) => (
  <div className={`lp-ringstat tone-${tone}`}>
    <svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true">
      <circle cx="40" cy="40" r="32" className="lp-ring-bg" />
      <circle cx="40" cy="40" r="32" className="lp-ring-fg" style={{ ['--p' as string]: pct, ['--i' as string]: i }} />
    </svg>
    <strong><CountUp value={pct} suffix="%" /></strong>
    <small>{label}</small>
  </div>
);

const PerformanceVisual: React.FC = () => (
  <MockWindow title="REVIEW CYCLE">
    <div className="lp-rings">
      <Ring pct={86} label="Goal progress" tone="violet" i={0} />
      <Ring pct={64} label="Evidence logged" tone="green" i={1} />
      <Ring pct={92} label="Reviews on time" tone="rose" i={2} />
    </div>
    <div className="lp-timeline-h">
      {['Self review', 'Manager review', 'HR sign-off'].map((s, i) => (
        <div key={s} className={`lp-tstep ${i < 2 ? 'is-done' : ''}`} style={{ ['--i' as string]: i }}>
          <span>{i < 2 ? <Check size={12} /> : i + 1}</span>{s}
        </div>
      ))}
    </div>
  </MockWindow>
);

const PeopleVisual: React.FC = () => {
  const lines = ['M180 50 L70 96', 'M180 50 L180 96', 'M180 50 L290 96', 'M70 126 L34 172', 'M70 126 L106 172', 'M180 126 L160 172', 'M180 126 L214 172', 'M290 126 L262 172', 'M290 126 L322 172'];
  const nodes: [number, number, string, number][] = [
    [180, 34, 'Asha Menon', 14], [70, 110, 'Vikram Rao', 11], [180, 110, 'Nisha Jain', 11], [290, 110, 'Farah Ali', 11],
    [34, 188, 'Tara N', 9], [106, 188, 'Ishan B', 9], [160, 188, 'Leo D', 9], [214, 188, 'Zoya K', 9], [262, 188, 'Raj P', 9], [322, 188, 'Mina G', 9],
  ];
  return (
    <MockWindow title="ORG CHART">
      <svg className="lp-org" viewBox="0 0 360 220" role="img" aria-label="Sample organisation chart">
        {lines.map((d, i) => <path key={d} d={d} className="lp-draw" style={{ ['--i' as string]: i }} />)}
        {nodes.map(([x, y, n, r], i) => (
          <g key={n} className="lp-node-pop" style={{ ['--i' as string]: i }}>
            <circle cx={x} cy={y} r={r + 4} className="lp-org-halo" />
            <circle cx={x} cy={y} r={r} className="lp-org-node" />
            <text x={x} y={y + 3} textAnchor="middle">{n.split(' ').map((p) => p[0]).join('')}</text>
          </g>
        ))}
      </svg>
      <div className="lp-meta-row"><span><Network size={13} /> Span of control, per manager</span><span><Users size={13} /> 10 shown of 246</span></div>
    </MockWindow>
  );
};

const PoliciesVisual: React.FC = () => (
  <MockWindow title="POLICY VERSIONS">
    <div className="lp-doc">
      <div className="lp-doc-head"><FileText size={16} /><b>Leave policy</b><span className="lp-vchip">v1.7</span><span className="lp-varrow">→</span><span className="lp-vchip is-new">v1.8</span></div>
      <div className="lp-diff">
        <p className="is-ctx">Employees may carry forward unused annual leave to the next year.</p>
        <p className="is-del">− Carry forward is limited to 5 days.</p>
        <p className="is-add">+ Carry forward is limited to 8 days.</p>
        <p className="is-ctx">Leave beyond the limit lapses on the last day of the leave year.</p>
      </div>
      <div className="lp-ack">
        <div><b>Acknowledged</b><em><CountUp value={62} /> of 70</em></div>
        <div className="lp-bar"><i style={{ ['--w' as string]: '88%' }} /></div>
        <div className="lp-avatars"><Avatar name="Hema R" i={0} size={24} /><Avatar name="Omar K" i={1} size={24} /><Avatar name="Priya S" i={2} size={24} /><span>+59</span></div>
      </div>
    </div>
  </MockWindow>
);

const TasksVisual: React.FC = () => {
  const cols = [
    { name: 'To do', cards: ['Update onboarding checklist', 'Collect Q3 evidence'] },
    { name: 'In progress', cards: ['Draft remote work policy'] },
    { name: 'Done', cards: ['Publish holiday calendar', 'Close October attendance'] },
  ];
  return (
    <MockWindow title="TASK BOARD">
      <div className="lp-kanban">
        {cols.map((c, ci) => (
          <div className="lp-kcol" key={c.name}>
            <div className="lp-kcol-head">{c.name}<span>{c.cards.length}</span></div>
            {c.cards.map((t, ii) => (
              <div key={t} className={`lp-tcard ${ci === 0 && ii === 0 ? 'is-moving' : ''}`} style={{ ['--i' as string]: ci * 2 + ii }}>
                <b>{t}</b>
                <span><Avatar name={['Hema R', 'Omar K', 'Priya S'][(ci + ii) % 3]} size={20} i={ci} /><small>{ci === 2 ? 'Done' : 'Due Fri'}</small></span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </MockWindow>
  );
};

export const ModuleVisual: React.FC<{ k: ModuleKey }> = ({ k }) => {
  switch (k) {
    case 'hiring': return <Kanban />;
    case 'leave': return <LeaveVisual />;
    case 'payroll': return <PayrollVisual />;
    case 'performance': return <PerformanceVisual />;
    case 'people': return <PeopleVisual />;
    case 'policies': return <PoliciesVisual />;
    case 'tasks': return <TasksVisual />;
    default: return null;
  }
};

/* ------------------------------------------------------------------ */
/* Module hub (modules index)                                          */
/* ------------------------------------------------------------------ */

export const OrbitHub: React.FC = () => (
  <div className="lp-hub" aria-hidden="true">
    <div className="lp-hub-ring lp-hub-ring-1" />
    <div className="lp-hub-ring lp-hub-ring-2" />
    <div className="lp-hub-core"><b>One record</b><small>per person</small></div>
    <div className="lp-hub-spin">
      {MODULES.map((m, i) => {
        const Icon = m.icon;
        return (
          <div key={m.key} className="lp-hub-item" style={{ ['--a' as string]: `${(360 / MODULES.length) * i}deg` }}>
            <span className={`lp-hub-badge tone-${m.tone}`}><Icon size={18} /></span>
          </div>
        );
      })}
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/* Automation flow                                                     */
/* ------------------------------------------------------------------ */

const FLOW_STEPS: { icon: IconType; label: string }[] = [
  { icon: Briefcase, label: 'Request approved' },
  { icon: FileText, label: 'Job posted' },
  { icon: Sparkles, label: 'Applicants ranked' },
  { icon: Target, label: 'Test sent and marked' },
  { icon: Video, label: 'Interview booked' },
  { icon: Check, label: 'Offer sent' },
];

export const AutomationFlow: React.FC = () => (
  <div className="lp-flow" aria-label="A hiring flow that moves from step to step on its own">
    <div className="lp-flow-line"><i /></div>
    {FLOW_STEPS.map((s, i) => {
      const Icon = s.icon;
      return (
        <div key={s.label} className="lp-flow-node" style={{ ['--i' as string]: i }}>
          <span><Icon size={18} /></span>
          <small>{s.label}</small>
        </div>
      );
    })}
  </div>
);

/* ------------------------------------------------------------------ */
/* Ask HR demo (types its answers)                                     */
/* ------------------------------------------------------------------ */

const QA = [
  { q: 'How many leave days do I have left?', a: 'You have 11 days of annual leave and 6 days of sick leave left this year.' },
  { q: 'What is my notice period?', a: 'Your notice period is 60 days, as per the employment policy you acknowledged.' },
  { q: 'When is payday this month?', a: 'Salary is credited on the last working day of the month, which is the 28th.' },
];

export const ChatDemo: React.FC = () => {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const [qi, setQi] = useState(0);
  const [phase, setPhase] = useState<'ask' | 'think' | 'answer'>('ask');
  const [typed, setTyped] = useState(0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (!seen || reduced) return;
    let cancelled = false;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(() => !cancelled && fn(), ms));
    const run = (i: number) => {
      setQi(i);
      setPhase('ask');
      setTyped(0);
      later(() => setPhase('think'), 1100);
      later(() => {
        setPhase('answer');
        const full = QA[i].a.length;
        let c = 0;
        const id = window.setInterval(() => {
          c += 2;
          setTyped(Math.min(full, c));
          if (c >= full) window.clearInterval(id);
        }, 28);
        timers.push(id);
      }, 2200);
      later(() => run((i + 1) % QA.length), 2200 + QA[i].a.length * 14 + 3200);
    };
    run(0);
    return () => {
      cancelled = true;
      timers.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    };
  }, [seen, reduced]);

  const qa = QA[qi];
  const answerText = reduced ? qa.a : qa.a.slice(0, typed);
  return (
    <div className="lp-chatdemo" ref={ref}>
      <div className="lp-chat-head"><span><MessageSquare size={14} /></span><b>Ask HR</b><small>Answers from your own record and policies</small></div>
      <div className="lp-chat-body">
        <div className="lp-bubble lp-bubble-q" key={`q${qi}`}>{qa.q}</div>
        {!reduced && phase === 'think' && <div className="lp-bubble lp-bubble-a lp-dots"><i /><i /><i /></div>}
        {(reduced || phase === 'answer') && <div className="lp-bubble lp-bubble-a" key={`a${qi}`}>{answerText}{!reduced && typed < qa.a.length && <span className="lp-caret" />}</div>}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Flags demo (clickable)                                              */
/* ------------------------------------------------------------------ */

const FLAGS = [
  { t: 'Late marks above usual', s: '3 people in Support this month', tone: 'amber' },
  { t: 'Payroll input changed 18%', s: 'Overtime vs last month, Operations', tone: 'rose' },
  { t: 'Unusual leave pattern', s: 'Repeated Monday and Friday leave, 1 person', tone: 'violet' },
];

export const FlagsDemo: React.FC = () => {
  const [done, setDone] = useState<Record<number, boolean>>({});
  return (
    <div className="lp-flagsdemo">
      <div className="lp-chat-head"><span><BellRing size={14} /></span><b>Flags for HR</b><small>Nothing is decided automatically</small></div>
      {FLAGS.map((f, i) => (
        <div key={f.t} className={`lp-flagrow tone-${f.tone} ${done[i] ? 'is-done' : ''}`}>
          <i />
          <span><b>{f.t}</b><small>{f.s}</small></span>
          <button type="button" onClick={() => setDone((d) => ({ ...d, [i]: !d[i] }))}>{done[i] ? <><Check size={13} /> Reviewed</> : 'Review'}</button>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Security visuals                                                    */
/* ------------------------------------------------------------------ */

export const IsolationDiagram: React.FC = () => (
  <div className="lp-iso" aria-label="Each company's data stays separate">
    {['Company A', 'Company B', 'Company C'].map((c, i) => (
      <div key={c} className="lp-iso-box" style={{ ['--i' as string]: i }}>
        <span className="lp-iso-lock"><Lock size={14} /></span>
        <b>{c}</b>
        <div className="lp-avatars"><Avatar name={`${c} One`} i={i} size={24} /><Avatar name={`${c} Two`} i={i + 2} size={24} /><Avatar name={`${c} Three`} i={i + 4} size={24} /></div>
        <small>People · Payroll · Documents</small>
        <span className="lp-iso-x"><X size={13} /> other companies</span>
      </div>
    ))}
  </div>
);

export const AuditTimeline: React.FC = () => {
  const items = [
    ['Version 1.8 submitted for review', 'Hema R · HR', 'violet'],
    ['Changes requested on section 3', 'Omar K · Reviewer', 'amber'],
    ['Version 1.8 approved', 'Priya S · Founder', 'green'],
    ['Published to 70 people', 'System', 'blue'],
  ];
  return (
    <div className="lp-audit">
      {items.map(([t, who, tone], i) => (
        <Reveal key={t} delay={i * 160} variant="left" className={`lp-audit-row tone-${tone}`}>
          <i /><span><b>{t}</b><small>{who}</small></span>
        </Reveal>
      ))}
    </div>
  );
};

export const PermissionChips: React.FC = () => {
  const roles = ['Company Admin', 'Head HR', 'HR', 'Approver / Founder', 'Department Head', 'Employee'];
  return (
    <div className="lp-chips">
      {roles.map((r, i) => <span key={r} style={{ ['--i' as string]: i }}>{r}</span>)}
      <span className="is-add" style={{ ['--i' as string]: roles.length }}>+ your own roles</span>
    </div>
  );
};

/* Small icon used for the "Policies & documents" and similar nav chips. */
export const ModuleIconBadge: React.FC<{ k: ModuleKey; size?: number }> = ({ k, size = 18 }) => {
  const m = MODULES.find((x) => x.key === k);
  if (!m) return <KanbanSquare size={size} />;
  const Icon = m.icon;
  return <span className={`lp-iconbadge tone-${m.tone}`}><Icon size={size} /></span>;
};
