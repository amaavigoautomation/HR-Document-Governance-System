import { jsPDF } from 'jspdf';
import { monthLabel } from '../../services/payrollService';

/** Money for the PDF: the standard PDF fonts have no rupee sign, so numbers are printed with the Indian digit grouping. */
export const num = (n: number | undefined | null) =>
  (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface SlipRows {
  earn: [string, number][];
  ded: [string, number][];
  /** Expense claims paid with the salary: added to net pay, not taxed. */
  reimb: [string, number][];
}

/** The lines of a payslip in the order people expect: salary components, then extras; statutory, then the rest. */
export function slipRows(slip: any): SlipRows {
  const l = slip.line;
  const earn: [string, number][] = l.earnings.map((e: any) => [e.name, e.amount]);
  if (l.encashment?.amount > 0) earn.push([`Leave encashment (${l.encashment.days} day${l.encashment.days === 1 ? '' : 's'})`, l.encashment.amount]);
  (l.adjustments || []).filter((a: any) => a.kind === 'EARNING').forEach((a: any) => earn.push([a.label, a.amount]));

  const s = l.statutory;
  const ded: [string, number][] = [];
  if (s.pfEmployee > 0) ded.push(['Provident fund (employee)', s.pfEmployee]);
  if (s.esicEmployee > 0) ded.push(['ESIC (employee)', s.esicEmployee]);
  if (s.pt > 0) ded.push(['Professional tax', s.pt]);
  l.deductions.forEach((d: any) => ded.push([d.name, d.amount]));
  (l.adjustments || []).filter((a: any) => a.kind === 'DEDUCTION').forEach((a: any) => ded.push([a.label, a.amount]));
  (l.loans || []).forEach((x: any) => ded.push([x.label, x.amount]));
  const reimb: [string, number][] = (l.reimbursements || []).map((r: any) => [r.label, r.amount]);
  return { earn, ded, reimb };
}

export function downloadPayslipPdf(slip: any) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 50;
  const e = slip.employee;
  const l = slip.line;

  doc.setFont('helvetica', 'bold').setFontSize(16).text(slip.company?.legalName || 'Payslip', M, y);
  y += 16;
  if (slip.company?.address) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100);
    doc.splitTextToSize(slip.company.address, W - 2 * M).forEach((t: string) => { doc.text(t, M, y); y += 11; });
    doc.setTextColor(0);
  }
  y += 6;
  doc.setFont('helvetica', 'bold').setFontSize(12).text(`Payslip for ${monthLabel(slip.month)}`, M, y);
  y += 8;
  doc.setDrawColor(200).line(M, y, W - M, y);
  y += 16;

  // employee block, two columns
  const pairs: [string, string][] = [
    ['Employee', e.name], ['Employee ID', e.empId], ['Department', e.department || '-'], ['Designation', e.title || '-'],
    ['Date of joining', e.joinDate || '-'], ['PAN', e.pan || '-'], ['UAN', e.uan || '-'], ['ESIC number', e.esicNo || '-'],
    ['Bank', e.bankName || '-'], ['Account', e.bankAccountMasked || '-'],
    ['Paid days', `${l.paidDays} of ${l.payDays}`], ['Loss of pay days', String(slip.inputs?.lopDays ?? 0)],
  ];
  doc.setFontSize(9);
  pairs.forEach(([k, v], i) => {
    const x = M + (i % 2) * ((W - 2 * M) / 2);
    const row = Math.floor(i / 2);
    doc.setFont('helvetica', 'normal').setTextColor(110).text(k, x, y + row * 15);
    doc.setFont('helvetica', 'bold').setTextColor(0).text(String(v), x + 90, y + row * 15);
  });
  y += Math.ceil(pairs.length / 2) * 15 + 10;

  // earnings | deductions
  const { earn, ded, reimb } = slipRows(slip);
  const colW = (W - 2 * M - 20) / 2;
  const xL = M;
  const xR = M + colW + 20;
  doc.setFillColor(245, 245, 245).rect(xL, y - 11, colW, 18, 'F').rect(xR, y - 11, colW, 18, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(10).text('Earnings', xL + 6, y + 2).text('Amount', xL + colW - 6, y + 2, { align: 'right' });
  doc.text('Deductions', xR + 6, y + 2).text('Amount', xR + colW - 6, y + 2, { align: 'right' });
  y += 20;
  doc.setFont('helvetica', 'normal').setFontSize(9.5);
  const rows = Math.max(earn.length, ded.length);
  for (let i = 0; i < rows; i++) {
    if (earn[i]) { doc.text(earn[i][0], xL + 6, y); doc.text(num(earn[i][1]), xL + colW - 6, y, { align: 'right' }); }
    if (ded[i]) { doc.text(ded[i][0], xR + 6, y); doc.text(num(ded[i][1]), xR + colW - 6, y, { align: 'right' }); }
    y += 15;
  }
  y += 2;
  doc.setDrawColor(200).line(xL, y - 9, xL + colW, y - 9).line(xR, y - 9, xR + colW, y - 9);
  doc.setFont('helvetica', 'bold');
  doc.text('Gross earnings', xL + 6, y + 3).text(num(l.gross), xL + colW - 6, y + 3, { align: 'right' });
  doc.text('Total deductions', xR + 6, y + 3).text(num(l.totalDeductions), xR + colW - 6, y + 3, { align: 'right' });
  y += 30;

  if (reimb.length) {
    doc.setFont('helvetica', 'bold').setFontSize(10).text('Reimbursements (not taxable)', xL + 6, y);
    y += 14;
    doc.setFont('helvetica', 'normal').setFontSize(9.5);
    reimb.forEach(([label, amount]) => { doc.text(label, xL + 6, y); doc.text(num(amount), xL + colW - 6, y, { align: 'right' }); y += 14; });
    y += 12;
  }

  doc.setFillColor(250, 112, 20).rect(M, y - 14, W - 2 * M, 28, 'F');
  doc.setTextColor(255).setFontSize(12).text('Net pay', M + 10, y + 4).text(`Rs. ${num(l.net)}`, W - M - 10, y + 4, { align: 'right' });
  doc.setTextColor(0);
  y += 40;

  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120);
  const s = l.statutory;
  if (s.pfEmployer > 0 || s.esicEmployer > 0) {
    doc.text(`Employer contributions this month: provident fund ${num(s.pfEmployer)}${s.esicEmployer > 0 ? `, ESIC ${num(s.esicEmployer)}` : ''}.`, M, y);
    y += 12;
  }
  doc.text('This is a system-generated payslip and does not need a signature.', M, y);
  doc.save(`payslip-${slip.month}-${String(e.empId || e.name).replace(/[^a-z0-9]+/gi, '-')}.pdf`);
}
