import { jsPDF } from 'jspdf';
import { monthLabel } from '../../services/payrollService';
import { num } from './payslipPdf';

/** The annual tax statement: the figures behind Form 130 (the Income-tax Act 2025 replacement for Form 16), from payroll paid in this system. */
export function downloadTaxStatementPdf(st: any) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 50;
  const c = st.computation;
  const row = (label: string, value: string, bold = false) => {
    if (y > 780) { doc.addPage(); y = 50; }
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(9.5).text(label, M, y);
    doc.text(value, W - M, y, { align: 'right' });
    y += 14;
  };

  doc.setFont('helvetica', 'bold').setFontSize(16).text(st.employer.name || 'Annual tax statement', M, y);
  y += 16;
  doc.setFontSize(12).text(`Annual tax statement, ${st.fyLabel}`, M, y);
  y += 12;
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(110);
  doc.text('Figures behind Form 130 (replaces Form 16). Deposit details from the tax portal are not part of this statement.', M, y);
  doc.setTextColor(0);
  y += 8;
  doc.setDrawColor(200).line(M, y, W - M, y);
  y += 16;

  const pairs: [string, string][] = [
    ['Employee', st.employee.name], ['Employee ID', st.employee.empId], ['PAN', st.employee.pan || '-'], ['Tax regime', st.regime === 'OLD' ? 'Old regime' : 'New regime'],
    ['Employer TAN', st.employer.tan || '-'], ['Employer PAN', st.employer.pan || '-'],
  ];
  doc.setFontSize(9);
  pairs.forEach(([k, v], i) => {
    const x = M + (i % 2) * ((W - 2 * M) / 2);
    const r = Math.floor(i / 2);
    doc.setFont('helvetica', 'normal').setTextColor(110).text(k, x, y + r * 15);
    doc.setFont('helvetica', 'bold').setTextColor(0).text(String(v), x + 90, y + r * 15);
  });
  y += Math.ceil(pairs.length / 2) * 15 + 12;

  doc.setFont('helvetica', 'bold').setFontSize(10).text('Salary and tax deducted by month', M, y);
  y += 14;
  st.months.forEach((m: any) => row(monthLabel(m.month), `Gross ${num(m.gross)}   Tax deducted ${num(m.tds)}`));
  if (st.months.length === 0) row('No payroll has been paid in this year yet.', '');
  y += 8;

  doc.setFont('helvetica', 'bold').setFontSize(10).text('Computation of tax', M, y);
  y += 14;
  row('Salary paid in this system', num(c.grossSalary));
  if (c.prevIncome) row('Income from earlier employer / earlier months', num(c.prevIncome));
  if (c.otherIncome) row('Other income declared', num(c.otherIncome));
  if (c.hraExemption) row('Less: House rent allowance exemption', num(c.hraExemption));
  row('Less: Standard deduction', num(c.standardDeduction));
  if (c.professionalTax) row('Less: Professional tax', num(c.professionalTax));
  const d = c.deductions;
  ([['Section 80C (including PF)', d.sec80C], ['Section 80D', d.sec80D], ['Section 80CCD(1B)', d.sec80CCD1B], ['Employer NPS 80CCD(2)', d.nps80CCD2], ['Home loan interest', d.homeLoanInterest], ['Other deductions', d.other]] as [string, number][])
    .filter(([, v]) => v > 0).forEach(([k, v]) => row(`Less: ${k}`, num(v)));
  row('Taxable income', num(c.taxableIncome), true);
  row('Tax on taxable income', num(c.taxOnIncome));
  if (c.rebate) row('Less: Rebate under section 87A', num(c.rebate));
  if (c.marginalRelief) row('Less: Marginal relief', num(c.marginalRelief));
  if (c.surcharge) row('Add: Surcharge', num(c.surcharge));
  row('Add: Health and education cess', num(c.cess));
  row('Total tax for the year', num(c.totalTax), true);
  row('Tax deducted (including earlier employer)', num(st.taxDeducted));
  row(st.difference > 0 ? 'Tax still to be paid' : 'Tax paid in excess', num(Math.abs(st.difference)), true);
  y += 12;
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120).text(st.note, M, y, { maxWidth: W - 2 * M });
  doc.save(`tax-statement-${st.fyLabel}-${String(st.employee.empId || st.employee.name).replace(/[^a-z0-9]+/gi, '-')}.pdf`);
}
