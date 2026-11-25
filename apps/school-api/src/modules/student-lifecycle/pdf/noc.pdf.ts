import { BRAND, createPdf, displayDate, renderPdf } from './pdf-kit';

export interface NocPdfLine {
  department: string;
  status: string;
  cleared_by: string | null;
  cleared_on: string | null;
  remarks: string | null;
}

export interface NocPdfData {
  school_name: string;
  school_address: string | null;
  school_logo: Buffer | null;
  student_name: string;
  admission_no: string;
  emis_number: string | null;
  class_name: string | null;
  leaving_date: string;
  reason: string;
  requested_on: string;
  cleared: boolean;
  lines: NocPdfLine[];
}

export async function nocPdf(data: NocPdfData): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 50, info: { Title: `No objection certificate ${data.student_name}` } });
  const left = 50;
  const width = 495.28;

  doc.rect(0, 0, 595.28, 8).fill(BRAND.green);
  if (data.school_logo) doc.image(data.school_logo, left, 34, { fit: [54, 54] });
  const headerX = data.school_logo ? left + 66 : left;
  doc
    .fillColor(BRAND.dark)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(data.school_name, headerX, 38, { width: width - (headerX - left) });
  if (data.school_address) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text(data.school_address, headerX, doc.y + 2, { width: width - (headerX - left) });
  }

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
    .text('NO OBJECTION CERTIFICATE', left, ruleY + 16, { width, align: 'center', characterSpacing: 2 });
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(data.cleared ? BRAND.green : BRAND.muted)
    .text(data.cleared ? 'All departments have cleared' : 'Clearance in progress', left, doc.y + 4, {
      width,
      align: 'center',
    });

  const facts: [string, string][] = [
    ['Name of the pupil', data.student_name],
    ['Admission number', data.admission_no],
    ['EMIS number', data.emis_number ?? '—'],
    ['Class', data.class_name ?? '—'],
    ['Date of leaving', displayDate(data.leaving_date)],
    ['Reason for leaving', data.reason],
    ['Requested on', displayDate(data.requested_on)],
  ];
  let y = doc.y + 18;
  for (const [label, value] of facts) {
    doc.font('Helvetica').fontSize(10).fillColor(BRAND.muted).text(label, left, y, { width: 160 });
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(BRAND.dark)
      .text(value, left + 165, y, { width: 330 });
    y = Math.max(doc.y, y + 14) + 6;
  }

  y += 12;
  const columns = [
    { label: 'Department', width: 120 },
    { label: 'Status', width: 70 },
    { label: 'Cleared by', width: 110 },
    { label: 'On', width: 70 },
    { label: 'Remarks', width: 125.28 },
  ];
  doc.rect(left, y, width, 24).fill(BRAND.deep);
  let x = left;
  for (const column of columns) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor('#ffffff')
      .text(column.label, x + 8, y + 8, { width: column.width - 12 });
    x += column.width;
  }
  y += 24;
  data.lines.forEach((line, index) => {
    const values = [
      line.department,
      line.status,
      line.cleared_by ?? '—',
      displayDate(line.cleared_on),
      line.remarks ?? '—',
    ];
    const height = Math.max(
      26,
      ...values.map(
        (value, column) =>
          doc
            .font('Helvetica')
            .fontSize(9.5)
            .heightOfString(value, { width: columns[column].width - 12 }) + 14,
      ),
    );
    if (index % 2 === 0) doc.rect(left, y, width, height).fill('#f5f7f6');
    let cellX = left;
    values.forEach((value, column) => {
      doc
        .font(column === 1 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9.5)
        .fillColor(column === 1 && line.status === 'Cleared' ? BRAND.green : BRAND.dark)
        .text(value, cellX + 8, y + 8, { width: columns[column].width - 12 });
      cellX += columns[column].width;
    });
    y += height;
  });
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(BRAND.muted)
    .text(
      'The school has no objection to the issue of a transfer certificate to the above pupil once every department has cleared.',
      left,
      y + 22,
      { width },
    );

  const signY = Math.max(y + 110, 700);
  const signatures = ['Accounts', 'Class teacher', 'Principal'];
  const slot = width / signatures.length;
  signatures.forEach((label, index) => {
    const slotX = left + index * slot;
    doc
      .moveTo(slotX + 15, signY)
      .lineTo(slotX + slot - 15, signY)
      .lineWidth(0.6)
      .strokeColor(BRAND.muted)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text(label, slotX, signY + 6, { width: slot, align: 'center' });
  });
  doc.rect(0, 833.89, 595.28, 8).fill(BRAND.green);
  return renderPdf(doc);
}
