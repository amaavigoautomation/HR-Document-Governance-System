import React from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { pmNav, type Section } from './pmNav';
import { Loading, useLoad } from '../common/loadUi';
import { Card, btnBig, btnGhost } from '../leave/ui';
import { Explain, Intro } from './common';

export interface Go { review: (id: string) => void; targets: (planId: string) => void }

/** The first screen for everyone: one list of what is waiting for you. The first item gets the big button. */
export const Home: React.FC<{ go: Go }> = ({ go }) => {
  const { data: d, error, loading } = useLoad(() => pmService.get('home'), []);
  if (!d) return <Loading error={error} loading={loading} />;
  const open = (t: any) => { if (t.go === 'review') go.review(t.id); else if (t.go === 'targets') go.targets(t.id); else pmNav.setSection(t.go as Section); };
  const groups: [string, string][] = [['me', 'For you'], ['team', 'For your team'], ['hr', 'For HR']];
  let n = 0;
  return (
    <div>
      <Intro title={`To do${d.name ? `, ${d.name.split(' ')[0]}` : ''}`} what="Everything waiting for you in Performance. When this list is empty, you have nothing to do." />
      {d.todo.length === 0 ? (
        <Card><div className="flex items-center gap-2 text-emerald-700 text-sm font-bold"><CheckCircle2 className="w-5 h-5" />You are all caught up.</div></Card>
      ) : groups.map(([key, label]) => {
        const items = d.todo.filter((t: any) => t.who === key);
        if (!items.length) return null;
        return (
          <div key={key} className="mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{label}</h3>
            <div className="space-y-2">
              {items.map((t: any, i: number) => {
                const first = n++ === 0;
                return (
                  <div key={i} className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
                    <span className="text-sm font-semibold text-slate-800">{t.text}</span>
                    <button className={first ? btnBig : btnGhost} onClick={() => open(t)}>Open <ArrowRight className="w-4 h-4" /></button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <Explain title="How does Performance work? (1 minute)">
        <p>You are reviewed on three things: your <b>results</b> (KPIs with targets, 60%), your <b>behaviour</b> (25%) and whether you follow your department's <b>SOPs</b> (15%).</p>
        <p>Your manager sets your targets, HR approves them, and you acknowledge them. During the quarter you and your manager record the work you do, and you have a short check-in each month.</p>
        <p>At the end of each quarter: you rate yourself, your manager rates you and talks it through with you, HR approves, and you read it and agree or record that you disagree. Nobody is scored on missing information: "Not observed" is left out, never counted as zero.</p>
      </Explain>
    </div>
  );
};
