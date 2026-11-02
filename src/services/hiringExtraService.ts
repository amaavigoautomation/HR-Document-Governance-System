import { apiJson } from './apiClient';
import { hrbpService } from './hrbpService';

const base = '/api/recruitment/';
const get = <T = any>(action: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
  return apiJson<T>(`${base}${action}${qs ? `?${qs}` : ''}`);
};
const post = <T = any>(action: string, body: unknown = {}) => apiJson<T>(`${base}${action}`, body);

/** Offers, joining, founder dashboard and recruitment AI. Server side: offerApi.ts, joiningApi.ts, analyticsApi.ts, aiHiringApi.ts. */
export const offerService = {
  list: (status?: string) => get('offer-list', { status }),
  get: (id: string) => get('offer-get', { id }),
  create: (b: unknown) => post('offer-create', b),
  act: (b: unknown) => post('offer-act', b),
  packSave: (id: string, docs: Record<string, string>) => post('offer-pack-save', { id, docs }),
  templates: () => get('offer-tpl-list'),
  templateSave: (docKey: string, body: string) => post('offer-tpl-save', { docKey, body }),
  costs: (requisitionId?: string) => get('hcost-list', { requisitionId }),
  costSave: (b: unknown) => post('hcost-save', b),
  costDelete: (id: string) => post('hcost-delete', { id }),
  // candidate (no sign-in, the token is the credential)
  publicGet: (token: string) => get('offer-public-get', { token }),
  publicRespond: (b: unknown) => post('offer-public-respond', b),
};

export const joiningService = {
  board: () => get('joining-board'),
  assets: () => get('asset-list'),
  assetSave: (b: unknown) => post('asset-save', b),
  assetIssue: (b: unknown) => post('asset-issue', b),
  assetReturn: (b: unknown) => post('asset-return', b),
  kitSave: (b: unknown) => post('kit-save', b),
  kitTick: (b: unknown) => post('kit-tick', b),
  itSet: (b: unknown) => post('it-set', b),
};

export const dashService = {
  dashboard: () => get('hdash'),
  insights: () => get('ai-insights'),
  integrations: () => get('integrations'),
};

export const aiService = {
  status: () => get('ai-status'),
  resume: (applicationId: string, force = false) => post('ai-resume', { applicationId, force }),
  dupScan: () => get('dup-scan'),
  dupMerge: (keepId: string, mergeIds: string[]) => post('dup-merge', { keepId, mergeIds, confirm: true }),
  compare: (applicationIds: string[]) => post('ai-compare', { applicationIds }),
  recommend: (applicationId: string) => post('ai-recommend', { applicationId }),
  followup: (applicationId: string, purpose: string, note?: string) => post('ai-followup', { applicationId, purpose, note }),
  followupSend: (applicationId: string, subject: string, body: string) => post('ai-followup-send', { applicationId, subject, body }),
};

/** Probation, OKRs, promotions and the quarterly round (api/_lib/talentCycleApi.ts, reached through the HRBP route). */
export const cycleService = {
  probList: () => hrbpService.get('prob-list'),
  probStart: (b: unknown) => hrbpService.post('prob-start', b),
  probFeedback: (b: unknown) => hrbpService.post('prob-feedback', b),
  probDecide: (b: unknown) => hrbpService.post('prob-decide', b),
  okrList: (quarter?: string) => hrbpService.get('okr-list', { quarter }),
  okrSave: (b: unknown) => hrbpService.post('okr-save', b),
  okrUpdate: (b: unknown) => hrbpService.post('okr-update', b),
  okrClose: (b: unknown) => hrbpService.post('okr-close', b),
  okrDelete: (id: string) => hrbpService.post('okr-delete', { id }),
  promoList: () => hrbpService.get('promo-list'),
  promoPropose: (b: unknown) => hrbpService.post('promo-propose', b),
  promoAct: (b: unknown) => hrbpService.post('promo-act', b),
  qcList: () => hrbpService.get('qc-list'),
  qcOpen: (b: unknown) => hrbpService.post('qc-open', b),
  qcTick: (b: unknown) => hrbpService.post('qc-tick', b),
  qcView: (id: string) => hrbpService.get('qc-view', { id }),
};

export const screenLinkService = {
  create: (applicationId: string, resend = false) => post('scrlink-create', { applicationId, resend }),
  list: () => get('scrlink-list'),
  publicGet: (token: string) => get('scrlink-public-get', { token }),
  publicSubmit: (b: unknown) => post('scrlink-public-submit', b),
};
