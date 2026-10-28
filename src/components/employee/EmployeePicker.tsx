import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import { input } from '../leave/ui';

/** HR's "find an employee" box. Shows who is currently open and lets HR switch. */
export const EmployeePicker: React.FC<{ current?: string; onPick: (uid: string | undefined) => void }> = ({ current, onPick }) => {
  const [people, setPeople] = useState<{ uid: string; name: string; empId: string }[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { lifecycleService.directory(true).then((d) => setPeople(d.people)).catch(() => undefined); }, []);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? people.filter((p) => `${p.name} ${p.empId}`.toLowerCase().includes(n)).slice(0, 8) : [];
  }, [q, people]);
  const open = people.find((p) => p.uid === current);
  return (
    <div className="relative max-w-sm">
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden />
      <input className={`${input} pl-9`} placeholder="Find an employee by name or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an employee" />
      {open && !q && <p className="mt-1 text-[11px] text-slate-500">Showing {open.name}{open.empId ? ` (${open.empId})` : ''}. <button type="button" className="font-bold text-[#FA7014]" onClick={() => onPick(undefined)}>Back to me</button></p>}
      {matches.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          {matches.map((m) => (
            <li key={m.uid}><button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { onPick(m.uid); setQ(''); }}>{m.name}<span className="text-xs text-slate-400 ml-2">{m.empId}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
};
