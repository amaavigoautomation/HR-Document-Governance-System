import React, { useState } from 'react';
import { Smile } from 'lucide-react';
import { MOODS, type Mood } from '../../../../shared/home';
import { homeService } from '../../../services/homeService';
import { HomeCard } from '../parts';
import { useLoad } from '../useLoad';

/** Managers see counts only (never who felt what), so this stays honest. */
const MoodSummary: React.FC = () => {
  const load = useLoad(() => homeService.moodSummary(7), []);
  const d = load.data;
  if (!d || d.responses === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Company mood, last 7 days · {d.responses} check-ins</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        {MOODS.map((m) => <span key={m.value} title={m.label}>{m.emoji} <b className="tabular-nums">{d.totals[m.value] || 0}</b></span>)}
      </div>
    </div>
  );
};

export const MoodCard: React.FC<{ showSummary: boolean }> = ({ showSummary }) => {
  const load = useLoad(() => homeService.mood(), []);
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState<Mood | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const current = picked ?? load.data?.today ?? null;

  const choose = async (m: Mood) => {
    setSaving(true);
    setErr(null);
    try {
      await homeService.saveMood(m);
      setPicked(m);
    } catch (e: any) {
      setErr(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <HomeCard title="How is your mood today?" icon={<Smile className="w-4 h-4 text-[#FA7014]" />} loading={load.loading && !load.data} error={load.error} onRetry={load.reload}>
      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Your mood today">
        {MOODS.map((m) => {
          const on = current === m.value;
          return (
            <button
              key={m.value} type="button" role="radio" aria-checked={on} disabled={saving} onClick={() => void choose(m.value)}
              className={`flex flex-col items-center gap-1 rounded-xl border py-2 transition-colors disabled:opacity-60 ${on ? 'border-[#FA7014] bg-orange-50' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}
            >
              <span className="text-2xl" aria-hidden>{m.emoji}</span>
              <span className="text-[10px] font-semibold text-slate-600">{m.label}</span>
            </button>
          );
        })}
      </div>
      {current && !err && <p className="mt-2 text-[11px] text-slate-400">Saved for today. You can change it until midnight.</p>}
      {err && <p className="mt-2 text-xs text-rose-700" role="alert">{err}</p>}
      {showSummary && <MoodSummary />}
    </HomeCard>
  );
};
