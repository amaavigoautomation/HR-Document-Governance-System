import React, { useEffect, useState } from 'react';
import { ChevronRight, ExternalLink, FileX } from 'lucide-react';
import { User } from '../../types';
import { peopleNav } from '../lifecycle/peopleNav';
import { EMPLOYEE_ENTRIES, employeeNav, employeeNavItems } from './employeeNav';
import { EmployeeProfilePage } from './EmployeeProfilePage';
import { EmployeeIdentityPage } from './EmployeeIdentityPage';
import { PersonalInfoPage } from './PersonalInfoPage';
import { FamilyDetailsPage } from './FamilyDetailsPage';
import { QualificationPage } from './QualificationPage';
import { SeparationPage } from './SeparationPage';
import { WeekoffReportPage } from './WeekoffReportPage';
import { ExitClearanceReportPage } from './ExitClearanceReportPage';
import { Employee360Page } from './Employee360Page';
import { EmployeePicker } from './EmployeePicker';
import type { HRAgentModule } from '../HRAgentShell';

/** Screens that already exist elsewhere in the app. The rest show a "not set up yet" page until they are built. */
const EXISTING: Record<string, { label: string; open: (go: (m: HRAgentModule) => void) => void }> = {
  acknowledgement: { label: 'Open my policies', open: (go) => go('policies') },
};

export const EmployeeModule: React.FC<{ currentUser: User; canPick?: boolean; onOpenModule: (m: HRAgentModule) => void }> = ({ canPick = false, onOpenModule }) => {
  const { section } = employeeNav.useNav();
  const [pickedUid, setPickedUid] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<'Transaction' | 'Reports'>('Transaction');
  useEffect(() => { employeeNav.publish(employeeNavItems(canPick)); }, [canPick]);
  useEffect(() => () => employeeNav.publish([]), []);

  const active = employeeNav.resolve(section, employeeNavItems(canPick));
  const entry = EMPLOYEE_ENTRIES.find((e) => e.key === active);
  const link = entry ? EXISTING[entry.key] : undefined;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400" aria-label="You are here">
          <span>Employee</span><ChevronRight className="w-3.5 h-3.5" /><span className="text-slate-700">{entry ? entry.label : 'Overview'}</span>
        </div>

        {!entry && (
          <div>
            <div className="flex gap-4 border-b border-slate-200 mb-4" role="tablist">
              {(['Transaction', 'Reports'] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`px-1 py-2 text-sm font-black uppercase tracking-wide border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t}</button>
              ))}
            </div>
            <h2 className="text-sm font-black text-slate-800 uppercase pb-1 border-b border-slate-500 max-w-md">{tab === 'Transaction' ? 'All' : 'Employees'}</h2>
            <ul className="max-w-md divide-y divide-slate-200">
              {EMPLOYEE_ENTRIES.filter((e) => e.group === tab && (canPick || e.key !== 'all360')).map((e) => (
                <li key={e.key}>
                  <button type="button" onClick={() => employeeNav.setSection(e.key)} className="w-full text-left py-3 hover:bg-slate-50 px-1">
                    <span className="block text-sm font-bold text-slate-800">{e.label}</span>
                    <span className="block text-[11px] text-slate-500">{e.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canPick && (entry?.key === 'master' || entry?.key === 'identity' || entry?.key === 'personal' || entry?.key === 'family' || entry?.key === 'qualification' || entry?.key === 'separation') && <EmployeePicker current={pickedUid} onPick={setPickedUid} />}
        {entry?.key === 'master' && <EmployeeProfilePage uid={pickedUid} />}
        {entry?.key === 'identity' && <EmployeeIdentityPage uid={pickedUid} />}
        {entry?.key === 'personal' && <PersonalInfoPage uid={pickedUid} />}
        {entry?.key === 'family' && <FamilyDetailsPage uid={pickedUid} />}
        {entry?.key === 'qualification' && <QualificationPage uid={pickedUid} />}
        {entry?.key === 'all360' && canPick && <Employee360Page />}
        {entry?.key === 'weekoff' && <WeekoffReportPage />}
        {entry?.key === 'exitclearance' && <ExitClearanceReportPage />}
        {entry?.key === 'separation' && <SeparationPage uid={pickedUid} onOpenModule={onOpenModule} />}

        {entry && !['master', 'identity', 'personal', 'family', 'qualification', 'separation', 'weekoff', 'exitclearance', 'all360'].includes(entry.key) && (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
            <h2 className="text-base font-black text-slate-800">{entry.label}</h2>
            <p className="text-xs text-slate-500 mt-1">{entry.hint}</p>
            {link ? (
              <button type="button" onClick={() => link.open(onOpenModule)} className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-[#FA7014] text-white text-xs font-bold px-4 py-2">
                {link.label}<ExternalLink className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="mt-5 flex flex-col items-center text-slate-400"><FileX className="w-10 h-10 mb-2 opacity-60" aria-hidden /><p className="text-xs font-medium">This screen is not set up yet</p></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
