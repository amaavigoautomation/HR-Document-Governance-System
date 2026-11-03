import React, { useEffect, useState } from 'react';
import { pipelineService } from '../../services/pipelineService';
import { SCORE_LABEL, SCORE_PARTS } from '../../../shared/hiringScore';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, useLoad } from '../common/loadUi';

/** The six weights that make up a candidate's score out of 100. They must add up to 100. */
export const ScoringTab: React.FC = () => {
  const s = useLoad(() => pipelineService.scoreSettings(), []);
  const [w, setW] = useState<Record<string, string>>({});
  const { run, busy, note } = useRunner();
  useEffect(() => { if (s.data) setW(Object.fromEntries(SCORE_PARTS.map((p) => [p, String(s.data.weights[p])]))); }, [s.data]);
  const total = SCORE_PARTS.reduce((a, p) => a + (Number(w[p]) || 0), 0);

  return (
    <Card title="Candidate score weights" subtitle="A candidate is scored out of 100 from these six parts. A part nobody has judged yet shows as pending and is left out, never counted as zero.">
      <Loading error={s.error} loading={s.loading} />
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        {SCORE_PARTS.map((p) => <Field key={p} label={SCORE_LABEL[p]}><input className={input} type="number" min={0} max={100} value={w[p] ?? ''} onChange={(e) => setW({ ...w, [p]: e.target.value })} /></Field>)}
      </div>
      <div className={`mt-3 text-xs font-bold ${Math.abs(total - 100) < 0.01 ? 'text-emerald-700' : 'text-rose-700'}`}>Total: {Math.round(total * 100) / 100} (must be 100)</div>
      <div className="mt-3 flex gap-2">
        <button className={btnPrimary} disabled={busy || Math.abs(total - 100) > 0.01} onClick={() => run(async () => { await pipelineService.scoreSettingsSave(Object.fromEntries(SCORE_PARTS.map((p) => [p, Number(w[p])]))); await s.reload(); }, 'Weights saved. New scores use them straight away.')}>Save weights</button>
        <button className={btnGhost} onClick={() => s.data && setW(Object.fromEntries(SCORE_PARTS.map((p) => [p, String(s.data.defaults[p])])))}>Reset to defaults</button>
      </div>
    </Card>
  );
};
