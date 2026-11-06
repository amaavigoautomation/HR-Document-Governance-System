/**
 * HR setup, done once per company with a 4-step wizard: weights, behaviours, SOPs, KRA/KPI templates.
 * Nothing invalid can be saved: every save is checked and the error says exactly what to fix.
 */
import { aiEnabled, aiJson } from './openaiHelper.js';
import { syncPlans } from './pmPlans.js';
import {
  DEFAULT_COMPETENCIES, KPI_SUGGESTIONS, kpiProblem, unsupportedInference, vagueKpi, weightsProblem,
  type Competency, type KpiDef,
} from '../../shared/pmEngine.js';
import {
  active, audit, bad, clean, db, del, get, list, lc, managerOf, notFound, num, ok, put, raise, settingsOf, slug, str,
  type C, type Doc, type Result, type Route, type Settings, type SopDef,
} from './pmCore.js';

const intIn = (v: unknown, lo: number, hi: number, dflt: number) => { const n = num(v); return n === null ? dflt : Math.max(lo, Math.min(hi, Math.round(n))); };

/** Published documents from Document Governance that can be used as SOPs. */
export async function publishedDocs(cid: string): Promise<Map<string, { documentId: string; title: string; department: string; versionId: string; versionNumber: string }>> {
  const snap = await db().collection('documents').where('companyId', '==', cid).get();
  const out = new Map<string, any>();
  for (const d of snap.docs) {
    const x = d.data() as any;
    if (!x.currentPublishedVersionId) continue;
    const documentId = str(x.documentId, 80) || d.id;
    out.set(documentId, { documentId, title: str(x.title, 200), department: str(x.departmentName, 80), versionId: str(x.currentPublishedVersionId, 80), versionNumber: str(x.currentPublishedVersionNumber, 20) || '1' });
  }
  return out;
}

export const templateId = (cid: string, designation: string) => `${cid}__${slug(designation)}`;

/** The "Not ready yet" checklist HR sees. `block` items stop plans from starting. */
export function readiness(c: C, s: Settings, templates: Doc[]) {
  const items: { ok: boolean; block: boolean; step: string; text: string }[] = [];
  const w = weightsProblem(s.weights);
  items.push({ ok: !w, block: true, step: 'weights', text: w || 'Weights add up to 100.' });
  items.push({ ok: s.competencies.length > 0, block: true, step: 'behaviours', text: s.competencies.length ? `${s.competencies.length} behaviours chosen.` : 'Choose at least one behaviour.' });
  const depts = Array.from(new Set(active(c).map((p) => p.department).filter(Boolean)));
  const noSop = depts.filter((d) => !s.sops.some((x) => x.departments.length === 0 || x.departments.includes(d)));
  items.push({ ok: noSop.length === 0, block: false, step: 'sops', text: noSop.length ? `No SOP applies to: ${noSop.join(', ')}. People there will have nothing to acknowledge (allowed, but check).` : 'Every department has at least one SOP.' });
  const titles = Array.from(new Set(active(c).map((p) => p.title).filter(Boolean)));
  const missing = titles.filter((t) => !templates.some((x) => lc(x.designation) === lc(t)));
  items.push({ ok: missing.length === 0, block: false, step: 'templates', text: missing.length ? `No KRA/KPI template yet for: ${missing.join(', ')}. Those people wait until one is added.` : 'Every designation has a KRA/KPI template.' });
  items.push({ ok: templates.length > 0, block: true, step: 'templates', text: templates.length ? `${templates.length} template(s) saved.` : 'Add at least one KRA/KPI template.' });
  const noMgr = active(c).filter((p) => !managerOf(c, p.uid));
  items.push({ ok: noMgr.length === 0, block: false, step: 'people', text: noMgr.length ? `${noMgr.length} people have no manager (${noMgr.slice(0, 5).map((p) => p.name).join(', ')}${noMgr.length > 5 ? '…' : ''}). Set one in People; until then their plan waits.` : 'Everyone has a manager.' });
  return { items, canFinish: items.every((i) => i.ok || !i.block) };
}

async function setupGet(c: C): Promise<Result> {
  const [s, templates, docs] = await Promise.all([settingsOf(c.cid), list(c.cid, 'templates'), publishedDocs(c.cid)]);
  const people = active(c);
  const designations = Array.from(new Set(people.map((p) => p.title).filter(Boolean))).sort().map((t) => ({
    designation: t, people: people.filter((p) => p.title === t).length, hasTemplate: templates.some((x) => lc(x.designation) === lc(t)),
  }));
  const departments = Array.from(new Set(people.map((p) => p.department).filter(Boolean))).sort();
  return ok({
    settings: s, templates: templates.sort((a, b) => String(a.designation).localeCompare(String(b.designation))),
    designations, departments, documents: Array.from(docs.values()).sort((a, b) => a.title.localeCompare(b.title)),
    readiness: readiness(c, s, templates), suggestions: KPI_SUGGESTIONS, defaults: DEFAULT_COMPETENCIES, aiAvailable: aiEnabled(),
  });
}

const cleanComps = (v: unknown): Competency[] => (Array.isArray(v) ? v : []).slice(0, 30).map((x: any, i: number) => ({
  id: str(x?.id, 40) || `c${i}_${Date.now().toString(36)}`, name: str(x?.name, 80), standard: str(x?.standard, 200),
})).filter((x) => x.name);

/** Saves one wizard step. Each step is checked on its own, so HR can never save a broken setup. */
async function setupSave(c: C, b: any): Promise<Result> {
  const s = await settingsOf(c.cid);
  const step = str(b.step, 20);
  const before = clean(s);
  if (step === 'weights') {
    const w = { results: num(b.weights?.results) ?? -1, behaviour: num(b.weights?.behaviour) ?? -1, sop: num(b.weights?.sop) ?? -1 };
    const p = weightsProblem(w); if (p) return bad(p);
    s.weights = w;
  } else if (step === 'behaviours') {
    const comps = cleanComps(b.competencies);
    if (!comps.length) return bad('Choose at least one behaviour.');
    const names = comps.map((x) => lc(x.name));
    if (new Set(names).size !== names.length) return bad('Two behaviours have the same name. Give each one a different name.');
    s.competencies = comps; s.managerExtras = b.managerExtras !== false;
  } else if (step === 'sops') {
    const docs = await publishedDocs(c.cid);
    const sops: SopDef[] = [];
    for (const x of (Array.isArray(b.sops) ? b.sops : []).slice(0, 200)) {
      const d = docs.get(str(x?.documentId, 80));
      if (!d) return bad(`"${str(x?.title, 120) || 'A document'}" is not a published document any more. Remove it and pick again.`);
      if (sops.some((y) => y.documentId === d.documentId)) continue;
      sops.push({ documentId: d.documentId, title: d.title, departments: (Array.isArray(x.departments) ? x.departments : []).map((v: any) => str(v, 80)).filter(Boolean), designations: (Array.isArray(x.designations) ? x.designations : []).map((v: any) => str(v, 80)).filter(Boolean), critical: x.critical === true });
    }
    s.sops = sops;
  } else if (step === 'timing') {
    const t = b.timing || {};
    s.timing = {
      selfDays: intIn(t.selfDays, 2, 30, 7), managerDays: intIn(t.managerDays, 2, 30, 7), hrDays: intIn(t.hrDays, 1, 30, 5),
      publishDelayDays: intIn(t.publishDelayDays, 0, 14, 2), remindEvery: intIn(t.remindEvery, 1, 14, 3), escalateAfter: intIn(t.escalateAfter, 2, 30, 7),
    };
    const feed = str(b.feedUrl, 600);
    if (feed && !/^https:\/\//i.test(feed)) return bad('The evidence feed link must start with https://');
    s.feedUrl = feed; s.aiOn = b.aiOn === true;
  } else if (step === 'finish') {
    const r = readiness(c, s, await list(c.cid, 'templates'));
    if (!r.canFinish) return bad(`Fix these first: ${r.items.filter((i) => !i.ok && i.block).map((i) => i.text).join(' ')}`);
    if (!s.setupDone) s.setupDoneAt = new Date().toISOString();
    s.setupDone = true;
  } else return bad('Unknown setup step.');
  await put('settings', s);
  await audit(c, `settings_${c.cid}`, `SETUP_${step.toUpperCase()}`, JSON.stringify({ before: step === 'finish' ? undefined : (before as any)[step === 'behaviours' ? 'competencies' : step], after: step === 'finish' ? 'done' : (s as any)[step === 'behaviours' ? 'competencies' : step] }).slice(0, 700));
  // Event: once setup is finished, any change applies at once (plans are created or refreshed now, not tomorrow).
  let plans: any = null;
  if (s.setupDone) plans = (await syncPlans(c)).stats;
  return ok({ settings: s, plans, message: step === 'finish' ? `Setup finished. ${plans ? `${plans.created} plan(s) started.` : ''}` : 'Saved.' });
}

const cleanKpis = (v: unknown): KpiDef[] => (Array.isArray(v) ? v : []).slice(0, 13).map((x: any, i: number) => ({
  id: str(x?.id, 40) || `k${i}_${Date.now().toString(36)}`, kra: str(x?.kra, 100), kpi: str(x?.kpi, 200), measure: str(x?.measure, 200),
  weight: num(x?.weight) ?? 0, frequency: ['WEEKLY', 'MONTHLY', 'QUARTERLY'].includes(str(x?.frequency, 12)) ? str(x?.frequency, 12) : 'MONTHLY', source: str(x?.source, 120),
}));

async function tplSave(c: C, b: any): Promise<Result> {
  const designation = str(b.designation, 80);
  if (!designation) return bad('Pick the designation this template is for.');
  const kpis = cleanKpis(b.kpis);
  const p = kpiProblem(kpis); if (p) return bad(p);
  const extra = (Array.isArray(b.extraCompetencies) ? b.extraCompetencies : []).map((x: any) => str(x, 80)).filter(Boolean).slice(0, 8);
  const id = templateId(c.cid, designation);
  const prev = await get(c.cid, 'templates', id);
  const doc = await put('templates', { ...(prev || {}), id, companyId: c.cid, designation, kpis, extraCompetencies: extra, version: (prev?.version || 0) + 1, savedBy: c.who });
  await audit(c, id, prev ? 'TEMPLATE_UPDATED' : 'TEMPLATE_CREATED', `${designation}: ${kpis.map((k) => `${k.kpi} (${k.weight}%)`).join('; ')}`);
  const s = await settingsOf(c.cid);
  const plans = s.setupDone ? (await syncPlans(c)).stats : null;
  return ok({ item: doc, plans, message: `Template for ${designation} saved.${plans && plans.created + plans.released ? ` ${plans.created + plans.released} plan(s) started.` : ''}` });
}

async function tplDelete(c: C, b: any): Promise<Result> {
  const t = await get(c.cid, 'templates', str(b.id, 160));
  if (!t) return notFound('The template');
  await del('templates', t.id);
  await audit(c, t.id, 'TEMPLATE_DELETED', t.designation);
  return ok({ message: `Template for ${t.designation} deleted. Plans already started keep their KPIs.` });
}

/** Checks KPI wording: the plain rules always, and AI suggestions when AI is on. AI never sets targets or weights. */
async function kpiCheck(c: C, b: any): Promise<Result> {
  const kpis = cleanKpis(b.kpis);
  const notes = kpis.map((k) => ({ id: k.id, problem: vagueKpi(k.kpi), suggestion: '' }));
  const s = await settingsOf(c.cid);
  if (!aiEnabled() || !s.aiOn || !kpis.length) return ok({ notes, ai: false });
  const r = await aiJson({
    cid: c.cid, feature: 'pm_kpi_check', cacheKey: JSON.stringify(kpis.map((k) => k.kpi)), maxTokens: 700,
    system: 'You review KPI wording for an HR performance system. For each KPI, if it is vague, suggest clearer measurable wording and a sensible evidence source. Never invent numeric targets (write "[target]" instead), never change weights, never mention people. Reply as JSON {"items":[{"id":"...","suggestion":"..." }]} with an empty suggestion when the wording is already clear.',
    user: JSON.stringify(kpis.map((k) => ({ id: k.id, kra: k.kra, kpi: k.kpi, measure: k.measure }))),
  });
  for (const it of (r.data?.items || []) as any[]) {
    const n = notes.find((x) => x.id === it.id); const sug = str(it.suggestion, 300);
    if (!n || !sug) continue;
    if (unsupportedInference(sug)) { await raise(c, 'AI_DISCARDED', `kpi_${n.id}`, { text: 'An AI wording suggestion was discarded because it went beyond the work itself.' }); continue; }
    n.suggestion = sug;
  }
  return ok({ notes, ai: true, error: r.error || '' });
}

export const SETUP_ROUTES: Record<string, Route> = {
  setup: { method: 'GET', who: 'hr', run: (c) => setupGet(c) },
  'setup-save': { method: 'POST', who: 'hr', run: (c, b) => setupSave(c, b) },
  'tpl-save': { method: 'POST', who: 'hr', run: (c, b) => tplSave(c, b) },
  'tpl-delete': { method: 'POST', who: 'hr', run: (c, b) => tplDelete(c, b) },
  'kpi-check': { method: 'POST', who: 'hr', run: (c, b) => kpiCheck(c, b) },
};
