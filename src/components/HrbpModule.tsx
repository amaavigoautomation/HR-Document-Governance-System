import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { hasAnyPerm } from '../../shared/permissions';
import { GenericManager, FieldSpec } from './hrbp/GenericManager';
import { DashboardView, OrgView } from './hrbp/Views';
import { Pips } from './hrbp/Pips';
import { Transfers } from './hrbp/Transfers';
import { Surveys } from './hrbp/Surveys';
import { Okrs, Probation, Promotions, Quarterly } from './hrbp/TalentCycle';
import { MyHrbp, MyLearning, Recognition, WellnessList } from './hrbp/SelfService';
import { hrbpService } from '../services/hrbpService';
import { hrbpNav, hrbpNavItems, type Section } from './hrbp/hrbpNav';
import { useLoad } from './common/loadUi';
import { Card, Field, Notice, btnPrimary, input, useRunner } from './leave/ui';

const RISK = ['LOW', 'MEDIUM', 'HIGH'];
const riskTone = (r: string) => (r === 'HIGH' ? 'red' : r === 'MEDIUM' ? 'amber' : 'green') as 'red' | 'amber' | 'green';

// "Client 60" per line <-> allocations
const allocParse = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(.*?)[\s:,-]+(\d+)\s*%?$/); return m ? { client: m[1].trim(), percent: Number(m[2]) } : { client: l, percent: 0 }; });
const allocFormat = (v: any[]) => (v || []).map((a) => `${a.client} ${a.percent}`).join('\n');
// "Title | TYPE | hours" per line <-> learning steps
const stepsParse = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, type, hours] = l.split('|').map((x) => x.trim()); return { title, type: (type || 'COURSE').toUpperCase(), hours: Number(hours) || 0 }; });
const stepsFormat = (v: any[]) => (v || []).map((s) => `${s.title} | ${s.type} | ${s.hours}`).join('\n');
// "employee id | READINESS" per line is awkward, so successors are entered as "Name | READY_NOW" and matched by name on the client
const makeSuccParse = (users: User[]) => (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [name, readiness] = l.split('|').map((x) => x.trim());
  const u = users.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return { employeeUid: u?.id || name, readiness: (readiness || 'THREE_PLUS_YEARS').toUpperCase() };
});
const succFormat = (v: any[]) => (v || []).map((s) => `${s.employeeName} | ${s.readiness}`).join('\n');

/** HR Business Partner: self-service for everyone (my HRBP, learning, pulse surveys, recognition, wellness) and the HRBP toolkit for HR. */
export const HrbpModule: React.FC<{ currentUser: User; users: User[] }> = ({ currentUser, users }) => {
  const manage = !!currentUser.isCompanyAdmin || hasAnyPerm(currentUser.perms, ['hrbp.manage']);
  const view = manage || hasAnyPerm(currentUser.perms, ['hrbp.view']);
  const items = hrbpNavItems(view, manage);
  const { section: chosen } = hrbpNav.useNav();
  // The sections live in the app sidebar (like Payroll and Employee); this page publishes which ones this person may open.
  const itemsKey = items.map((i) => i.key).join(',');
  useEffect(() => { hrbpNav.publish(items); }, [itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => hrbpNav.publish([]), []);
  const section = hrbpNav.resolve(chosen, items) as Section;
  const sectionLabel = items.find((i) => i.key === section)?.label || '';

  const Body = () => {
    switch (section) {
      case 'dash': return <DashboardView />;
      case 'org': return <OrgView />;
      case 'map': return (
        <GenericManager key="map" title="People mapping" subtitle="Business unit, cost centre, client allocation, billable status and HRBP for every employee. Drafts made when someone joins or is confirmed show here until you complete them." prefix="map" users={users}
          fields={[
            { key: 'employeeUid', label: 'Employee', type: 'person' }, { key: 'businessUnit', label: 'Business unit', type: 'text' }, { key: 'costCentre', label: 'Cost centre', type: 'text' },
            { key: 'hrbpUid', label: 'HR business partner', type: 'person' }, { key: 'employmentStatus', label: 'Employment status', type: 'select', options: ['PROBATION', 'CONFIRMED', 'NOTICE', 'CONTRACT'] },
            { key: 'billable', label: 'Billable', type: 'checkbox' }, { key: 'clientAllocation', label: 'Client allocation', type: 'lines', hint: 'One per line, like: Acme 60', parse: allocParse, format: allocFormat, wide: true },
          ] as FieldSpec[]}
          blank={{ employmentStatus: 'CONFIRMED' }}
          row={(m) => ({ title: m.employeeName, sub: `${m.businessUnit || 'No business unit'}${m.costCentre ? ` - ${m.costCentre}` : ''} - HRBP: ${m.hrbpName || 'none'}${m.clientAllocation?.length ? ` - ${m.clientAllocation.map((a: any) => `${a.client} ${a.percent}%`).join(', ')}` : ''}`, pill: m.draft ? { text: 'needs completing', tone: 'amber' } : { text: m.billable ? 'billable' : 'non-billable', tone: m.billable ? 'green' : 'slate' } })} />
      );
      case 'bunits': return (
        <GenericManager key="bunits" title="Business units" subtitle="The head and default HRBP of each unit. A mapping saved without an HRBP gets its unit's default." prefix="bu" users={users}
          fields={[
            { key: 'name', label: 'Name', type: 'text' }, { key: 'headUid', label: 'Head of the unit', type: 'person' },
            { key: 'defaultHrbpUid', label: 'Default HR business partner', type: 'person' }, { key: 'description', label: 'Description', type: 'textarea' },
          ] as FieldSpec[]}
          row={(u) => ({ title: u.name, sub: `${u.headName ? `Head: ${u.headName}` : 'No head set'}${u.defaultHrbpName ? ` - HRBP: ${u.defaultHrbpName}` : ''}` })} />
      );
      case 'pos': return (
        <GenericManager key="pos" title="Positions" subtitle="Roles in the organisation, filled or vacant. Vacant ones show as dashed boxes on the org chart." prefix="pos" users={users}
          fields={[
            { key: 'title', label: 'Position', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'businessUnit', label: 'Business unit', type: 'text' },
            { key: 'reportsToUid', label: 'Reports to', type: 'person' }, { key: 'status', label: 'Status', type: 'select', options: ['VACANT', 'FILLED'] },
            { key: 'incumbentUid', label: 'Person in the role (if filled)', type: 'person' }, { key: 'critical', label: 'Critical role', type: 'checkbox' },
            { key: 'requisitionRef', label: 'Hiring requisition (optional)', type: 'text', hint: 'The requisition number, if one is open.' }, { key: 'notes', label: 'Notes', type: 'textarea' },
          ] as FieldSpec[]}
          blank={{ status: 'VACANT' }}
          row={(p) => ({ title: p.title, sub: `${p.department || 'No department'}${p.reportsToName ? ` - reports to ${p.reportsToName}` : ''}${p.status === 'FILLED' && p.incumbentName ? ` - ${p.incumbentName}` : ''}${p.requisitionRef ? ` - ${p.requisitionRef}` : ''}`, pill: { text: `${p.critical ? 'critical, ' : ''}${p.status.toLowerCase()}`, tone: p.status === 'VACANT' ? (p.critical ? 'red' : 'amber') : 'green' } })} />
      );
      case 'transfer': return <Transfers users={users} />;
      case 'talent': return (
        <GenericManager key="talent" title="Quarterly talent review" subtitle="Rate performance and potential from 1 to 3 to place each person on the 9-box grid." prefix="talent" users={users} allowDelete={false}
          fields={[
            { key: 'employeeUid', label: 'Employee', type: 'person' }, { key: 'quarter', label: 'Quarter', type: 'text', hint: 'Like 2026-Q4. Empty = this quarter.' },
            { key: 'performance', label: 'Performance (1-3)', type: 'number' }, { key: 'potential', label: 'Potential (1-3)', type: 'number' },
            { key: 'flightRisk', label: 'Flight risk', type: 'select', options: RISK }, { key: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          row={(t) => ({ title: `${t.employeeName} - ${t.quarter}`, sub: `${t.box?.label || ''}${t.notes ? ` - ${t.notes}` : ''}`, pill: { text: `${t.flightRisk.toLowerCase()} risk`, tone: riskTone(t.flightRisk) } })} />
      );
      case 'kpi': return (
        <GenericManager key="kpi" title="KPI governance" subtitle="Green is 90% of target or more, amber 70%, red below." prefix="kpi" users={users}
          fields={[
            { key: 'scope', label: 'For', type: 'select', options: ['EMPLOYEE', 'DEPARTMENT'] }, { key: 'employeeUid', label: 'Employee (if for a person)', type: 'person' }, { key: 'department', label: 'Department (if for a team)', type: 'text' },
            { key: 'name', label: 'KPI', type: 'text' }, { key: 'unit', label: 'Unit', type: 'text' }, { key: 'direction', label: 'Better when', type: 'select', options: [{ value: 'HIGHER', label: 'Higher is better' }, { value: 'LOWER', label: 'Lower is better' }] },
            { key: 'target', label: 'Target', type: 'number' }, { key: 'actual', label: 'Actual so far', type: 'number' }, { key: 'period', label: 'Period', type: 'text', hint: 'Like 2026-Q4' },
          ]}
          blank={{ scope: 'EMPLOYEE', direction: 'HIGHER' }}
          row={(k) => ({ title: `${k.name} - ${k.employeeName || k.department}`, sub: `${k.period} - target ${k.target}${k.unit ? ` ${k.unit}` : ''}, actual ${k.actual ?? 'not entered'}${k.attainment !== null ? ` (${k.attainment}%)` : ''}`, pill: { text: k.status.replace('_', ' ').toLowerCase(), tone: k.status === 'GREEN' ? 'green' : k.status === 'AMBER' ? 'amber' : k.status === 'RED' ? 'red' : 'slate' } })} />
      );
      case 'pip': return <Pips users={users} />;
      case 'probation': return <Probation users={users} />;
      case 'okr': return <Okrs users={users} />;
      case 'promo': return <Promotions users={users} />;
      case 'quarterly': return <Quarterly />;
      case 'retention': return (
        <GenericManager key="ret" title="Retention planning" subtitle="One plan per person. High-risk people from the talent review belong here." prefix="retention" users={users}
          fields={[
            { key: 'employeeUid', label: 'Employee', type: 'person' }, { key: 'risk', label: 'Risk', type: 'select', options: RISK }, { key: 'reasons', label: 'Why might they leave?', type: 'textarea' },
            { key: 'actions', label: 'What will we do?', type: 'textarea' }, { key: 'ownerUid', label: 'Owner', type: 'person' }, { key: 'status', label: 'Status', type: 'select', options: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'LEFT'] }, { key: 'reviewOn', label: 'Review on', type: 'date' },
          ]}
          blank={{ risk: 'MEDIUM', status: 'OPEN' }}
          row={(r) => ({ title: r.employeeName, sub: `${r.actions || r.reasons || ''}${r.ownerName ? ` - owner ${r.ownerName}` : ''}`, pill: { text: `${r.risk.toLowerCase()} - ${r.status.toLowerCase().replace('_', ' ')}`, tone: riskTone(r.risk) } })} />
      );
      case 'succ': return (
        <GenericManager key="succ" title="Succession planning" subtitle="A critical role needs at least one person who is ready now." prefix="succ" users={users}
          fields={[
            { key: 'role', label: 'Role', type: 'text' }, { key: 'incumbentUid', label: 'Current holder', type: 'person' }, { key: 'critical', label: 'Critical role', type: 'checkbox' },
            { key: 'successors', label: 'Successors', type: 'lines', hint: 'One per line: Name | READY_NOW, ONE_TO_TWO_YEARS or THREE_PLUS_YEARS', parse: makeSuccParse(users), format: succFormat, wide: true },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          row={(s) => ({ title: `${s.role}${s.incumbentName ? ` - ${s.incumbentName}` : ''}`, sub: (s.successors || []).map((x: any) => `${x.employeeName} (${x.readiness.toLowerCase().replace(/_/g, ' ')})`).join(', ') || 'No successor named', pill: { text: s.gap === 'NO_SUCCESSOR' ? 'no ready successor' : s.gap === 'THIN' ? 'thin cover' : s.gap === 'COVERED' ? 'covered' : 'ok', tone: s.gap === 'NO_SUCCESSOR' ? 'red' : s.gap === 'THIN' ? 'amber' : 'green' } })} />
      );
      case 'needs': return (
        <GenericManager key="needs" title="Training needs" prefix="need" users={users}
          fields={[
            { key: 'employeeUid', label: 'Employee', type: 'person' }, { key: 'skill', label: 'Skill or topic', type: 'text' },
            { key: 'source', label: 'Where it came from', type: 'select', options: ['REVIEW', 'MANAGER', 'SELF', 'PIP', 'OTHER'] }, { key: 'priority', label: 'Priority', type: 'select', options: RISK },
            { key: 'status', label: 'Status', type: 'select', options: ['OPEN', 'PLANNED', 'DONE'] }, { key: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          blank={{ source: 'MANAGER', priority: 'MEDIUM', status: 'OPEN' }}
          row={(n) => ({ title: `${n.employeeName}: ${n.skill}`, sub: `from ${n.source.toLowerCase()}`, pill: { text: n.status.toLowerCase(), tone: n.status === 'DONE' ? 'green' : 'blue' } })} />
      );
      case 'paths': return <PathsAdmin users={users} />;
      case 'certs': return (
        <GenericManager key="certs" title="Certification and compliance tracker" subtitle="Expired items are flagged red; items expiring in 60 days amber." prefix="cert" users={users}
          fields={[
            { key: 'employeeUid', label: 'Employee', type: 'person' }, { key: 'name', label: 'Certificate or compliance item', type: 'text' }, { key: 'issuer', label: 'Issued by', type: 'text' },
            { key: 'issuedOn', label: 'Issued on', type: 'date' }, { key: 'expiresOn', label: 'Expires on', type: 'date' }, { key: 'mandatory', label: 'Mandatory', type: 'checkbox' },
          ]}
          row={(c) => ({ title: `${c.employeeName}: ${c.name}`, sub: `${c.issuer || ''}${c.expiresOn ? ` - expires ${c.expiresOn}` : ' - no expiry'}`, pill: { text: c.status.replace('_', ' ').toLowerCase(), tone: c.status === 'EXPIRED' ? 'red' : c.status === 'EXPIRING' ? 'amber' : 'green' } })} />
      );
      case 'surveysAdmin': return <Surveys manage />;
      case 'wellAdmin': return (
        <GenericManager key="well" title="Wellness programs" prefix="well" users={users}
          fields={[
            { key: 'title', label: 'Title', type: 'text' }, { key: 'type', label: 'Type', type: 'select', options: ['EVENT', 'PROGRAM', 'CHALLENGE'] }, { key: 'date', label: 'Date', type: 'date' },
            { key: 'description', label: 'Description', type: 'textarea' }, { key: 'active', label: 'Open for joining', type: 'checkbox' },
          ]}
          blank={{ type: 'EVENT', active: true }}
          row={(w) => ({ title: w.title, sub: `${w.type.toLowerCase()}${w.date ? ` - ${w.date}` : ''} - ${w.participantCount} joined`, pill: { text: w.active ? 'open' : 'closed', tone: w.active ? 'green' : 'slate' } })} />
      );
      case 'me': return <MyHrbp />;
      case 'learning': return <MyLearning />;
      case 'pulse': return <Surveys manage={false} />;
      case 'recog': return <Recognition users={users} me={currentUser} />;
      default: return <WellnessList />;
    }
  };

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-400">HR Business Partner{sectionLabel ? <> <span aria-hidden>&gt;</span> <span className="text-slate-700">{sectionLabel}</span></> : null}</div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">HR Business Partner</h1>
          <p className="text-xs text-slate-500 sm:text-sm">Organisation, talent, performance governance, engagement, learning and succession in one place.</p>
        </div>
        <div className="min-w-0"><Body /></div>
      </div>
    </div>
  );
};

/** Learning paths (HRBP-012): build a path of steps, assign it to people, and follow progress. */
const PathsAdmin: React.FC<{ users: User[] }> = ({ users }) => {
  const [pathId, setPathId] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [due, setDue] = useState('');
  return (
    <div className="space-y-6">
      <GenericManager key="paths" title="Learning paths" subtitle="A path is an ordered list of steps." prefix="path" users={users}
        fields={[
          { key: 'name', label: 'Name', type: 'text' }, { key: 'role', label: 'For role (optional)', type: 'text' },
          { key: 'steps', label: 'Steps', type: 'lines', hint: 'One per line: Title | COURSE, READING, PROJECT or CERTIFICATION | hours', parse: stepsParse, format: stepsFormat, wide: true },
        ]}
        row={(p) => ({ title: p.name, sub: `${p.steps.length} steps${p.role ? ` - for ${p.role}` : ''}` })} />
      <AssignPath users={users} pathId={pathId} setPathId={setPathId} who={who} setWho={setWho} due={due} setDue={setDue} />
    </div>
  );
};

const AssignPath: React.FC<{ users: User[]; pathId: string; setPathId: (v: string) => void; who: string[]; setWho: (v: string[]) => void; due: string; setDue: (v: string) => void }> = ({ users, pathId, setPathId, who, setWho, due, setDue }) => {
  const paths = useLoad(() => hrbpService.get('path-list'), []);
  const { run, busy, note } = useRunner();
  const staff = users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Card title="Assign a path" subtitle="People are emailed and can tick off steps in My learning.">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Path"><select className={input} value={pathId} onChange={(e) => setPathId(e.target.value)}><option value="">Choose</option>{(paths.data?.items || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Due date (optional)"><input className={input} type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="People (Ctrl or Cmd to pick several)"><select multiple className={`${input} h-24`} value={who} onChange={(e) => setWho(Array.from(e.target.selectedOptions).map((o) => o.value))}>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      </div>
      <button className={`${btnPrimary} mt-3`} disabled={busy || !pathId || who.length === 0} onClick={() => run(async () => { await hrbpService.post('path-assign', { pathId, employeeUids: who, dueOn: due }); setWho([]); }, 'Assigned.')}>Assign and email</button>
    </Card>
  );
};
