import { jsPDF } from 'jspdf';

/** Plain letter on A4: the text as issued, wrapped, with the reference number at the top right. */
export function downloadLetterPdf(letter: { number: string; title: string; recipient: string; text: string }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  let y = 64;
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(120).text(`Ref: ${letter.number}`, W - M, y, { align: 'right' });
  doc.setTextColor(0);
  y += 22;
  doc.setFontSize(11);
  const lines = letter.text.split('\n');
  const first = lines.findIndex((l) => l.trim());
  lines.forEach((raw, i) => {
    const wrapped: string[] = raw.trim() === '' ? [''] : doc.splitTextToSize(raw, W - 2 * M);
    doc.setFont('helvetica', i === first ? 'bold' : 'normal').setFontSize(i === first ? 14 : 11);
    for (const w of wrapped) {
      if (y > H - 64) { doc.addPage(); y = 64; }
      doc.text(w, M, y);
      y += i === first ? 20 : 15;
    }
  });
  doc.save(`${letter.number.replace(/[^A-Za-z0-9]+/g, '-')}-${letter.recipient.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`);
}
