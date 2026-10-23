import { jsPDF } from 'jspdf';
import { num, slipRows } from './payslipPdf';

/** The lines of a settlement: salary, encashment and extras, gratuity, then everything taken off. */
export function settlementRows(s: any) {
  const c = s.calc;
  const { earn, ded, reimb } = slipRows({ line: c.line });
  if (c.gratuity?.amount > 0) earn.push(['Gratuity', c.gratuity.amount]);
  if (c.notice?.recovery > 0) ded.push([`Notice period shortfall (${c.notice.shortfallDays} day(s))`, c.notice.recovery]);
  if (c.overpaid?.amount > 0) ded.push(['Salary paid after the last working day', c.overpaid.amount]);
  return { earn, ded, reimb };
}

export function downloadSettlementPdf(s: any, company: any) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 50;
  const e = s.employee;
  const c = s.calc;

  doc.setFont('helvetica', 'bold').setFontSize(16).text(company?.legalName || 'Full and final settlement', M, y);
  y += 18;
  doc.setFontSize(12).text('Full and final settlement statement', M, y);
  y += 8;
  doc.setDrawColor(200).line(M, y, W - M, y);
  y += 16;

  const pairs: [string, string][] = [
    ['Employee', e.name], ['Employee ID', e.empId], ['Department', e.department || '-'], ['Designation', e.title || '-'],
    ['Date of joining', c.joinDate || '-'], ['Last working day', s.input.lastWorkingDay], ['Reason', String(s.input.reason).toLowerCase()],
    ['Service', c.gratuity?.service ? `${Math.floor(c.gratuity.service.months / 12)} yr ${c.gratuity.service.months % 12} mo` : '-'],
    ['Paid days in final month', `${c.inputs.paidDays} of ${c.inputs.payDays}`], ['Account', e.bankAccountMasked || '-'],
  ];
  doc.setFontSize(9);
  pairs.forEach(([k, v], i) => {
    const x = M + (i % 2) * ((W - 2 * M) / 2);
    const row = Math.floor(i / 2);
    doc.setFont('helvetica', 'normal').setTextColor(110).text(k, x, y + row * 15);
    doc.setFont('helvetica', 'bold').setTextColor(0).text(String(v), x + 110, y + row * 15);
  });
  y += Math.ceil(pairs.length / 2) * 15 + 12;

  const { earn, ded, reimb } = settlementRows(s);
  const colW = (W - 2 * M - 20) / 2;
  const xL = M;
  const xR = M + colW + 20;
  doc.setFillColor(245, 245, 245).rect(xL, y - 11, colW, 18, 'F').rect(xR, y - 11, colW, 18, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(10).text('Payable', xL + 6, y + 2).text('Amount', xL + colW - 6, y + 2, { align: 'right' });
  doc.text('Deductions', xR + 6, y + 2).text('Amount', xR + colW - 6, y + 2, { align: 'right' });
  y += 20;
  doc.setFont('helvetica', 'normal').setFontSize(9.5);
  const all = [...earn, ...reimb.map(([l, a]) => [`${l} (reimbursement)`, a] as [string, number])];
  for (let i = 0; i < Math.max(all.length, ded.length); i++) {
    if (all[i]) { doc.text(all[i][0], xL + 6, y); doc.text(num(all[i][1]), xL + colW - 6, y, { align: 'right' }); }
    if (ded[i]) { doc.text(ded[i][0], xR + 6, y); doc.text(num(ded[i][1]), xR + colW - 6, y, { align: 'right' }); }
    y += 15;
  }
  y += 4;
  doc.setDrawColor(200).line(xL, y - 9, xL + colW, y - 9).line(xR, y - 9, xR + colW, y - 9);
  doc.setFont('helvetica', 'bold');
  doc.text('Total payable', xL + 6, y + 3).text(num(c.totals.gross + c.totals.reimbursements), xL + colW - 6, y + 3, { align: 'right' });
  doc.text('Total deductions', xR + 6, y + 3).text(num(c.totals.deductions), xR + colW - 6, y + 3, { align: 'right' });
  y += 30;

  doc.setFillColor(250, 112, 20).rect(M, y - 14, W - 2 * M, 28, 'F');
  doc.setTextColor(255).setFontSize(12);
  doc.text(c.totals.recoverable > 0 ? 'Recoverable from employee' : 'Net settlement', M + 10, y + 4)
    .text(`Rs. ${num(c.totals.recoverable > 0 ? c.totals.recoverable : c.totals.net)}`, W - M - 10, y + 4, { align: 'right' });
  doc.setTextColor(0);
  y += 40;

  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120);
  if (c.gratuity?.note) { doc.text(`Gratuity: ${c.gratuity.note}`, M, y, { maxWidth: W - 2 * M }); y += 14; }
  if (s.paidOn) { doc.text(`Paid on ${s.paidOn}${s.paidRef ? `, reference ${s.paidRef}` : ''}.`, M, y); y += 12; }
  doc.text('This is a system-generated statement and does not need a signature.', M, y);
  doc.save(`settlement-${String(e.empId || e.name).replace(/[^a-z0-9]+/gi, '-')}.pdf`);
}
