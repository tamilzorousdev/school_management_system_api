import { BRAND, createPdf, displayDate, renderPdf } from './pdf-kit';

export interface TcData {
  school_name: string;
  school_address: string | null;
  school_phone: string | null;
  school_email: string | null;
  school_board: string | null;
  school_logo: Buffer | null;
  tc_no: string;
  issued_on: string;
  student_name: string;
  admission_no: string;
  emis_number?: string | null;
  gender: string;
  dob: string;
  identification_marks: string | null;
  guardian_name: string | null;
  admission_date: string;
  class_name: string | null;
  section_name: string | null;
  academic_year: string | null;
  promotion_eligible: boolean;
  leaving_date: string;
  reason: string;
  conduct: string;
  remarks: string | null;
}

export async function tcPdf(tc: TcData): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 50, info: { Title: `Transfer certificate ${tc.tc_no}` } });
  const left = 50;
  const width = 495.28;

  doc.rect(0, 0, 595.28, 8).fill(BRAND.green);
  if (tc.school_logo) doc.image(tc.school_logo, left, 34, { fit: [54, 54] });
  const headerX = tc.school_logo ? left + 66 : left;
  doc
    .fillColor(BRAND.dark)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(tc.school_name, headerX, 38, { width: width - (headerX - left) });
  const contact = [tc.school_address, tc.school_phone ? `Phone ${tc.school_phone}` : null, tc.school_email]
    .filter(Boolean)
    .join('  ·  ');
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(BRAND.muted)
    .text(contact, headerX, doc.y + 2, {
      width: width - (headerX - left),
    });
  if (tc.school_board) doc.text(`Affiliated board: ${tc.school_board}`, headerX, doc.y + 1);

  const ruleY = Math.max(doc.y + 14, 104);
  doc
    .moveTo(left, ruleY)
    .lineTo(left + width, ruleY)
    .lineWidth(1)
    .strokeColor(BRAND.line)
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor(BRAND.deep)
    .text('TRANSFER CERTIFICATE', left, ruleY + 16, { width, align: 'center', characterSpacing: 2 });

  const metaY = doc.y + 10;
  doc.font('Helvetica').fontSize(10).fillColor(BRAND.dark);
  doc.text(`TC No: `, left, metaY, { continued: true }).font('Helvetica-Bold').text(tc.tc_no);
  const issued = displayDate(tc.issued_on);
  const issuedWidth = doc.font('Helvetica-Bold').widthOfString(issued);
  doc.text(issued, left + width - issuedWidth, metaY, { lineBreak: false });
  const label = 'Date of issue: ';
  doc.font('Helvetica').text(label, left + width - issuedWidth - doc.widthOfString(label), metaY, { lineBreak: false });

  const rows: [string, string][] = [
    ['Name of the pupil', tc.student_name],
    ['Admission number', tc.admission_no],
    ['EMIS number', tc.emis_number ?? '—'],
    ['Gender', tc.gender.charAt(0).toUpperCase() + tc.gender.slice(1)],
    ['Date of birth', displayDate(tc.dob)],
    ['Personal marks of identification', tc.identification_marks ?? '—'],
    ['Parent or guardian', tc.guardian_name ?? '—'],
    ['Date of admission', displayDate(tc.admission_date)],
    ['Class last studied', [tc.class_name, tc.section_name].filter(Boolean).join(' - ') || '—'],
    ['Academic year', tc.academic_year ?? '—'],
    ['Qualified for promotion', tc.promotion_eligible ? 'Yes' : 'No'],
    ['Date of leaving', displayDate(tc.leaving_date)],
    ['Reason for leaving', tc.reason],
    ['General conduct', tc.conduct],
    ['Remarks', tc.remarks ?? '—'],
  ];

  let y = metaY + 34;
  rows.forEach(([label, value], index) => {
    const height = Math.max(26, doc.font('Helvetica-Bold').fontSize(10.5).heightOfString(value, { width: 270 }) + 14);
    if (index % 2 === 0) doc.rect(left, y, width, height).fill('#f5f7f6');
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(BRAND.muted)
      .text(`${index + 1}.`, left + 10, y + 8, { width: 20 })
      .text(label, left + 32, y + 8, { width: 180 });
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(BRAND.dark)
      .text(value, left + 215, y + 7, { width: 270 });
    y += height;
  });
  doc
    .rect(left, metaY + 34, width, y - (metaY + 34))
    .lineWidth(0.6)
    .strokeColor(BRAND.line)
    .stroke();

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(BRAND.muted)
    .text('Certified that the above information is in accordance with the school admission register.', left, y + 22, {
      width,
    });

  const signY = Math.max(y + 110, 700);
  const signatures = ['Prepared by', 'Class teacher', 'Principal'];
  const slot = width / signatures.length;
  signatures.forEach((label, index) => {
    const x = left + index * slot;
    doc
      .moveTo(x + 15, signY)
      .lineTo(x + slot - 15, signY)
      .lineWidth(0.6)
      .strokeColor(BRAND.muted)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text(label, x, signY + 6, { width: slot, align: 'center' });
  });
  doc.rect(0, 833.89, 595.28, 8).fill(BRAND.green);
  return renderPdf(doc);
}
