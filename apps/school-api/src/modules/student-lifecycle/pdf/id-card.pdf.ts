import { BRAND, createPdf, displayDate, initials, Pdf, renderPdf } from './pdf-kit';

export interface IdCardData {
  school_name: string;
  school_code: string;
  school_city: string | null;
  school_phone: string | null;
  school_address?: string | null;
  school_email?: string | null;
  school_logo: Buffer | null;
  academic_year: string | null;
  name: string;
  admission_no: string;
  class_section: string | null;
  roll_no: number | null;
  dob: string;
  blood_group: string | null;
  guardian_name: string | null;
  guardian_mobile: string | null;
  photo: Buffer | null;
  qr: Buffer;
  father_name?: string | null;
  mother_name?: string | null;
  address?: string | null;
}

const MM = 72 / 25.4;
// Design 1: Classic CR80 Landscape dimensions (~85.6mm x 54mm)
export const CARD_WIDTH_D1 = 85.6 * MM; // ~242.65 pt
export const CARD_HEIGHT_D1 = 54 * MM; // ~153.07 pt

// Design 2 & 3: CR80 Portrait dimensions (~54mm x 85.6mm)
export const CARD_WIDTH_D2 = 54 * MM; // ~153.07 pt
export const CARD_HEIGHT_D2 = 85.6 * MM; // ~242.65 pt

// Backward compatibility exports
export const CARD_WIDTH = CARD_WIDTH_D2;
export const CARD_HEIGHT = CARD_HEIGHT_D2;

/* =========================================================================
   DESIGN 1: ORIGINAL CLASSIC LANDSCAPE THEME
   Classic Green (#159053 / #0d5c35), student photo left, center details,
   Principal signature. Back side features the bus/gate QR code, campus
   address, office emergency contacts, and return notice.
   ========================================================================= */

export function drawIdCardFrontDesign1(doc: Pdf, x: number, y: number, card: IdCardData): void {
  const w = CARD_WIDTH_D1;
  const h = CARD_HEIGHT_D1;
  doc.save();
  doc.roundedRect(x, y, w, h, 7).lineWidth(0.6).fillAndStroke('#ffffff', BRAND.line);
  doc.roundedRect(x, y, w, h, 7).clip();

  // Green header banner
  doc.rect(x, y, w, 34).fill(BRAND.green);
  doc.rect(x, y + 30, w, 4).fill(BRAND.deep);
  if (card.school_logo) {
    doc.circle(x + 18, y + 16, 11).fill('#ffffff');
    doc.image(card.school_logo, x + 9, y + 7, { fit: [18, 18], align: 'center', valign: 'center' });
  } else {
    doc.circle(x + 18, y + 16, 11).fill('#ffffff');
    doc
      .fillColor(BRAND.green)
      .font('Helvetica-Bold')
      .fontSize(7)
      .text((card.school_code || 'SCH').slice(0, 4), x + 7, y + 13, { width: 22, align: 'center' });
  }
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(card.school_name, x + 34, y + 7, { width: w - 40, height: 11, ellipsis: true, lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(5.5)
    .fillColor('#e4f2ea')
    .text(`STUDENT ID CARD${card.academic_year ? `  ·  ${card.academic_year}` : ''}`, x + 34, y + 19, {
      width: w - 40,
      characterSpacing: 0.6,
      lineBreak: false,
    });

  // Student photo on left
  const photoX = x + 10;
  const photoY = y + 42;
  doc.roundedRect(photoX, photoY, 54, 76, 4).fill(BRAND.wash);
  if (card.photo) {
    doc.save();
    doc.roundedRect(photoX, photoY, 54, 76, 4).clip();
    doc.image(card.photo, photoX, photoY, { cover: [54, 76], align: 'center', valign: 'center' });
    doc.restore();
  } else {
    doc
      .fillColor(BRAND.deep)
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(initials(card.name), photoX, photoY + 29, { width: 54, align: 'center' });
  }

  // Student details across the rest of the front
  const textX = x + 72;
  const textWidth = w - 82;
  doc
    .fillColor(BRAND.dark)
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .text(card.name, textX, y + 42, { width: textWidth, height: 13, ellipsis: true });

  const rows: [string, string][] = [
    ['Adm. No', card.admission_no],
    ['Class', [card.class_section, card.roll_no ? `Roll ${card.roll_no}` : null].filter(Boolean).join(' · ') || '—'],
    ['DOB', displayDate(card.dob)],
    ['Blood', card.blood_group ?? '—'],
    ['Parent', card.father_name || card.guardian_name || '—'],
    ['Contact', card.guardian_mobile ?? '—'],
  ];
  let rowY = y + 57;
  for (const [label, value] of rows) {
    doc
      .font('Helvetica')
      .fontSize(5.5)
      .fillColor(BRAND.muted)
      .text(label.toUpperCase(), textX, rowY, { lineBreak: false });
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(BRAND.dark)
      .text(value, textX + 34, rowY - 0.6, { width: textWidth - 34, height: 8, ellipsis: true, lineBreak: false });
    rowY += 10.5;
  }

  // Principal Signature line on bottom right
  const sigW = 46;
  const sigX = x + w - sigW - 12;
  const sigY = y + h - 26;
  doc
    .moveTo(sigX, sigY)
    .lineTo(sigX + sigW, sigY)
    .lineWidth(0.6)
    .stroke(BRAND.deep);
  doc
    .font('Helvetica')
    .fontSize(4.6)
    .fillColor(BRAND.muted)
    .text('Principal Signature', sigX, sigY + 2, { width: sigW, align: 'center' });

  // Bottom footer wash bar
  doc.rect(x, y + h - 13, w, 13).fill(BRAND.wash);
  const footer = [card.school_city, card.school_phone ? `Ph ${card.school_phone}` : null].filter(Boolean).join('  ·  ');
  doc
    .font('Helvetica')
    .fontSize(5.5)
    .fillColor(BRAND.deep)
    .text(footer || 'If found, please return to the school office', x + 9, y + h - 9, {
      width: w - 18,
      align: 'center',
      lineBreak: false,
    });
  doc.restore();
}

export function drawIdCardDesign1(doc: Pdf, x: number, y: number, card: IdCardData): void {
  drawIdCardFrontDesign1(doc, x, y, card);
}

export function drawIdCardBackDesign1(doc: Pdf, x: number, y: number, card: IdCardData): void {
  const w = CARD_WIDTH_D1;
  const h = CARD_HEIGHT_D1;
  doc.save();
  doc.roundedRect(x, y, w, h, 7).lineWidth(0.6).fillAndStroke('#ffffff', BRAND.line);
  doc.roundedRect(x, y, w, h, 7).clip();

  // Green header bar
  doc.rect(x, y, w, 24).fill(BRAND.green);
  doc.rect(x, y + 20, w, 4).fill(BRAND.deep);
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor('#ffffff')
    .text('CAMPUS & EMERGENCY CONTACT', x + 10, y + 7, { width: w - 20, align: 'center', lineBreak: false });

  // Prominent QR Code on left
  const qrSize = 58;
  const qrX = x + 16;
  const qrY = y + 33;
  doc
    .rect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4)
    .lineWidth(0.5)
    .stroke(BRAND.line);
  doc.image(card.qr, qrX, qrY, { width: qrSize, height: qrSize });
  doc
    .font('Helvetica')
    .fontSize(4.8)
    .fillColor(BRAND.muted)
    .text('Scan for Bus & Gate Access', qrX - 8, qrY + qrSize + 3, { width: qrSize + 16, align: 'center' });

  // School Information & Emergency Details on right
  const textX = x + 88;
  const textW = w - 100;
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(BRAND.dark)
    .text(card.school_name, textX, y + 33, { width: textW, height: 12, ellipsis: true });

  const lines = [
    card.school_address || card.school_city || 'School Campus Office',
    card.school_phone ? `Office : ${card.school_phone}` : null,
    card.school_email ? `Email : ${card.school_email}` : null,
  ].filter(Boolean) as string[];

  doc
    .font('Helvetica')
    .fontSize(5.8)
    .fillColor(BRAND.muted)
    .text(lines.join('\n'), textX, y + 49, { width: textW, lineGap: 2.5 });

  // Instructions / Return Notice
  doc
    .moveTo(textX, y + 84)
    .lineTo(textX + textW, y + 84)
    .lineWidth(0.5)
    .stroke(BRAND.line);
  doc
    .font('Helvetica')
    .fontSize(4.6)
    .fillColor(BRAND.muted)
    .text(
      '1. This card must be carried during all school hours.\n2. In case of emergency or loss, contact school office.',
      textX,
      y + 88,
      {
        width: textW,
        lineGap: 1.5,
      },
    );

  // Bottom wash bar
  doc.rect(x, y + h - 13, w, 13).fill(BRAND.wash);
  doc
    .font('Helvetica-Oblique')
    .fontSize(5)
    .fillColor(BRAND.deep)
    .text('If found, please return to the school office', x + 9, y + h - 9, {
      width: w - 18,
      align: 'center',
      lineBreak: false,
    });
  doc.restore();
}

/* =========================================================================
   DESIGN 2: MODERN WAVE THEME (Teal & Vibrant Orange)
   CR80 Portrait card with curved decorative wave blobs & dual sides.
   ========================================================================= */
const MODERN_THEME = {
  teal: '#00897B',
  tealDark: '#00695C',
  tealLight: '#E0F2F1',
  orange: '#FA7222',
  orangeDark: '#E65100',
  peach: '#FEECE5',
  peachLight: '#FFF5F0',
  white: '#FFFFFF',
  border: '#CBD5E1',
  textDark: '#1F2937',
  textMuted: '#4B5563',
  textLight: '#6B7280',
};

function drawModernBackground(doc: Pdf, x: number, y: number, w: number, h: number): void {
  doc.save();
  doc.roundedRect(x, y, w, h, 8).lineWidth(0.6).fillAndStroke(MODERN_THEME.white, MODERN_THEME.border);
  doc.roundedRect(x, y, w, h, 8).clip();

  doc
    .moveTo(x + w * 0.45, y)
    .bezierCurveTo(x + w * 0.6, y + 14, x + w * 0.85, y + 28, x + w, y + 38)
    .lineTo(x + w, y)
    .closePath()
    .fill(MODERN_THEME.peach);

  doc
    .moveTo(x, y + h - 55)
    .bezierCurveTo(x + 18, y + h - 40, x + 24, y + h - 16, x + 35, y + h)
    .lineTo(x, y + h)
    .closePath()
    .fill(MODERN_THEME.peach);

  doc
    .moveTo(x + w - 40, y + h)
    .bezierCurveTo(x + w - 24, y + h - 20, x + w - 10, y + h - 35, x + w, y + h - 45)
    .lineTo(x + w, y + h)
    .closePath()
    .fill(MODERN_THEME.peachLight);

  doc
    .moveTo(x + w * 0.68, y)
    .bezierCurveTo(x + w * 0.78, y + 16, x + w * 0.92, y + 14, x + w, y + 8)
    .lineTo(x + w, y)
    .closePath()
    .fill(MODERN_THEME.teal);

  doc
    .moveTo(x + 10, y + h)
    .bezierCurveTo(x + 16, y + h - 18, x + 34, y + h - 18, x + 42, y + h)
    .lineTo(x, y + h)
    .closePath()
    .fill(MODERN_THEME.teal);

  doc
    .moveTo(x, y + 6)
    .bezierCurveTo(x + 12, y + 14, x + 15, y + 32, x, y + 42)
    .closePath()
    .fill(MODERN_THEME.orange);

  doc
    .moveTo(x + w, y + 68)
    .bezierCurveTo(x + w - 12, y + 82, x + w - 12, y + 96, x + w, y + 108)
    .closePath()
    .fill(MODERN_THEME.orange);

  doc
    .moveTo(x + w, y + h - 40)
    .bezierCurveTo(x + w - 16, y + h - 26, x + w - 10, y + h - 8, x + w, y + h)
    .closePath()
    .fill(MODERN_THEME.orange);

  doc.circle(x, y + h * 0.48, 4.5).fill('#F1F5F9');
  doc.circle(x + w, y + h * 0.48, 4.5).fill('#F1F5F9');

  doc.restore();
}

function drawSchoolLogoEmblem(doc: Pdf, cx: number, cy: number, radius: number): void {
  doc.save();
  doc
    .circle(cx, cy, radius)
    .lineWidth(1.2)
    .strokeColor(MODERN_THEME.orange)
    .fillColor(MODERN_THEME.white)
    .fillAndStroke();
  doc
    .circle(cx, cy, radius - 2)
    .lineWidth(0.5)
    .strokeColor(MODERN_THEME.orange);

  const bx = cx;
  const by = cy;
  doc
    .moveTo(bx, by - 1)
    .bezierCurveTo(bx - 3, by - 3, bx - 5, by - 2.5, bx - 6, by - 2)
    .lineTo(bx - 6, by + 3)
    .bezierCurveTo(bx - 5, by + 2.5, bx - 3, by + 2, bx, by + 3)
    .closePath()
    .fill(MODERN_THEME.teal);

  doc
    .moveTo(bx, by - 1)
    .bezierCurveTo(bx + 3, by - 3, bx + 5, by - 2.5, bx + 6, by - 2)
    .lineTo(bx + 6, by + 3)
    .bezierCurveTo(bx + 5, by + 2.5, bx + 3, by + 2, bx, by + 3)
    .closePath()
    .fill(MODERN_THEME.teal);

  doc.restore();
}

export function drawIdCardFrontDesign2(doc: Pdf, x: number, y: number, card: IdCardData): void {
  const w = CARD_WIDTH_D2;
  const h = CARD_HEIGHT_D2;

  doc.save();
  drawModernBackground(doc, x, y, w, h);

  const logoRadius = 13;
  const logoCx = x + 18;
  const logoCy = y + 23;

  if (card.school_logo) {
    doc.save();
    doc
      .circle(logoCx, logoCy, logoRadius)
      .lineWidth(1.2)
      .strokeColor(MODERN_THEME.orange)
      .fillColor(MODERN_THEME.white)
      .fillAndStroke();
    doc.image(card.school_logo, logoCx - 10, logoCy - 10, { fit: [20, 20], align: 'center', valign: 'center' });
    doc.restore();
  } else {
    drawSchoolLogoEmblem(doc, logoCx, logoCy, logoRadius);
  }

  const textX = x + 35;
  const textW = w - 42;
  const schoolName = (card.school_name || 'TAMILZOROUS MODEL SCHOOL').toUpperCase();

  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(MODERN_THEME.teal)
    .text(schoolName, textX, y + 14, {
      width: textW,
      height: 18,
      ellipsis: true,
    });

  doc
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .fillColor(MODERN_THEME.orange)
    .text(`Student ID : ${card.admission_no}`, textX, y + 32, {
      width: textW,
      height: 9,
      ellipsis: true,
      lineBreak: false,
    });

  const photoW = 54;
  const photoH = 58;
  const photoX = x + (w - photoW) / 2;
  const photoY = y + 48;

  if (card.photo) {
    doc.save();
    doc.rect(photoX, photoY, photoW, photoH).clip();
    doc.image(card.photo, photoX, photoY, { cover: [photoW, photoH], align: 'center', valign: 'center' });
    doc.restore();
  } else {
    doc.save();
    doc.rect(photoX, photoY, photoW, photoH).fill('#EDF2F7');
    doc
      .fillColor(MODERN_THEME.teal)
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(initials(card.name), photoX, photoY + 19, { width: photoW, align: 'center' });
    doc.restore();
  }
  doc.rect(photoX, photoY, photoW, photoH).lineWidth(2.2).stroke(MODERN_THEME.orange);

  const detailsY = photoY + photoH + 8;
  const labelX = x + 14;
  const colonX = x + 55;
  const valX = x + 60;
  const valW = w - 74;

  const rows: { label: string; value: string; isTeal?: boolean }[] = [
    { label: 'Name', value: card.name.toUpperCase(), isTeal: true },
    { label: "Father's Name", value: card.father_name || card.guardian_name || '—' },
    { label: 'Contact', value: card.guardian_mobile || '—' },
    { label: 'Class Name', value: card.class_section || '—' },
    { label: 'Class Roll', value: card.roll_no ? String(card.roll_no).padStart(2, '0') : '—' },
    { label: 'Date of Birth', value: displayDate(card.dob) },
    { label: 'Blood Group', value: card.blood_group || '—' },
  ];

  let curY = detailsY;
  const rowGap = 8.2;
  for (const row of rows) {
    doc
      .font('Helvetica-Bold')
      .fontSize(5.1)
      .fillColor(MODERN_THEME.textMuted)
      .text(row.label, labelX, curY, { width: colonX - labelX - 1, ellipsis: true, lineBreak: false });

    doc
      .font('Helvetica-Bold')
      .fontSize(5.1)
      .fillColor(MODERN_THEME.textMuted)
      .text(':', colonX, curY, { lineBreak: false });

    doc
      .font('Helvetica-Bold')
      .fontSize(5.1)
      .fillColor(row.isTeal ? MODERN_THEME.teal : MODERN_THEME.textDark)
      .text(row.value, valX, curY, { width: valW, height: 8, ellipsis: true, lineBreak: false });

    curY += rowGap;
  }

  const sigW = 42;
  const sigX = x + w - sigW - 14;
  const sigY = y + h - 18;

  doc
    .moveTo(sigX, sigY)
    .lineTo(sigX + sigW, sigY)
    .lineWidth(0.8)
    .stroke(MODERN_THEME.orange);
  doc
    .font('Helvetica')
    .fontSize(4.6)
    .fillColor(MODERN_THEME.textLight)
    .text('Principal Signature', sigX, sigY + 2.5, { width: sigW, align: 'center', lineBreak: false });

  doc.restore();
}

export function drawIdCardBackDesign2(doc: Pdf, x: number, y: number, card: IdCardData): void {
  const w = CARD_WIDTH_D2;
  const h = CARD_HEIGHT_D2;

  doc.save();
  drawModernBackground(doc, x, y, w, h);

  const topLineW = 50;
  const topLineX = x + (w - topLineW) / 2;
  const topLineY = y + 22;

  doc
    .moveTo(topLineX, topLineY)
    .lineTo(topLineX + topLineW, topLineY)
    .lineWidth(1.2)
    .stroke(MODERN_THEME.orange);
  doc
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .fillColor(MODERN_THEME.textDark)
    .text('For More Information', x + 10, topLineY + 6, { width: w - 20, align: 'center', lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(6)
    .fillColor(MODERN_THEME.textMuted)
    .text('Pls Scan This', x + 10, topLineY + 15, { width: w - 20, align: 'center', lineBreak: false });

  const qrSize = 54;
  const qrX = x + (w - qrSize) / 2;
  const qrY = topLineY + 27;

  doc
    .rect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6)
    .lineWidth(0.6)
    .stroke(MODERN_THEME.border);
  doc.image(card.qr, qrX, qrY, { width: qrSize, height: qrSize });

  const headY = qrY + qrSize + 16;
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(MODERN_THEME.textDark)
    .text('S C H O O L   A D D R E S S', x + 10, headY, { width: w - 20, align: 'center', lineBreak: false });

  const campusAddr =
    card.school_address ||
    [card.school_city, card.school_phone ? 'Ph: ' + card.school_phone : null].filter(Boolean).join(', ') ||
    'School Campus Office';

  const officePhone = card.school_phone ? `Office : ${card.school_phone}` : '';
  const emailLine = card.school_email ? `Email : ${card.school_email}` : '';
  const lines = [campusAddr, officePhone, emailLine].filter(Boolean);

  doc
    .font('Helvetica')
    .fontSize(5.3)
    .fillColor(MODERN_THEME.textMuted)
    .text(lines.join('\n'), x + 14, headY + 11, { width: w - 28, align: 'center', lineGap: 2.2 });

  doc
    .font('Helvetica-Oblique')
    .fontSize(4.6)
    .fillColor(MODERN_THEME.textLight)
    .text('If found, please return to the school office.', x + 10, y + h - 18, {
      width: w - 20,
      align: 'center',
      lineBreak: false,
    });

  doc.restore();
}

/* =========================================================================
   DESIGN 3: CAMPUS SHIELD THEME (Navy & Gold)
   CR80 Portrait card with classic split academic header.
   ========================================================================= */
const SHIELD_THEME = {
  navy: '#17324D',
  blue: '#244B70',
  gold: '#D4A64A',
  paper: '#F7F9FC',
  text: '#1F2937',
  muted: '#64748B',
  line: '#D6DEE8',
  white: '#FFFFFF',
};

export function drawIdCardFrontDesign3(doc: Pdf, x: number, y: number, card: IdCardData): void {
  const w = CARD_WIDTH_D2;
  const h = CARD_HEIGHT_D2;
  doc.save();
  doc.roundedRect(x, y, w, h, 7).lineWidth(0.7).fillAndStroke(SHIELD_THEME.white, SHIELD_THEME.line);
  doc.roundedRect(x, y, w, h, 7).clip();
  doc.rect(x, y, w, 44).fill(SHIELD_THEME.navy);
  doc.rect(x, y + 42, w, 2).fill(SHIELD_THEME.gold);

  const logoX = x + 10;
  const logoY = y + 9;
  doc.circle(logoX + 11, logoY + 11, 11).fillAndStroke(SHIELD_THEME.white, SHIELD_THEME.gold);
  if (card.school_logo) {
    doc.image(card.school_logo, logoX + 4, logoY + 4, { fit: [14, 14], align: 'center', valign: 'center' });
  } else {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(SHIELD_THEME.navy)
      .text('S', logoX + 7, logoY + 6, {
        width: 8,
        align: 'center',
        lineBreak: false,
      });
  }
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(SHIELD_THEME.white)
    .text((card.school_name || 'SCHOOL').toUpperCase(), x + 37, y + 11, { width: w - 45, height: 20, ellipsis: true });
  doc
    .font('Helvetica-Bold')
    .fontSize(5.2)
    .fillColor(SHIELD_THEME.gold)
    .text('STUDENT ID CARD', x + 37, y + 29, { width: w - 45, lineBreak: false });

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(SHIELD_THEME.navy)
    .text(card.name.toUpperCase(), x + 8, y + 51, {
      width: w - 16,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(5.5)
    .fillColor(SHIELD_THEME.muted)
    .text(`Admission No: ${card.admission_no}`, x + 8, y + 63, {
      width: w - 16,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });

  const photoX = x + 11;
  const photoY = y + 78;
  const photoW = 54;
  const photoH = 68;
  doc.rect(photoX - 2, photoY - 2, photoW + 4, photoH + 4).fillAndStroke(SHIELD_THEME.paper, SHIELD_THEME.gold);
  if (card.photo) {
    doc.save();
    doc.rect(photoX, photoY, photoW, photoH).clip();
    doc.image(card.photo, photoX, photoY, { cover: [photoW, photoH], align: 'center', valign: 'center' });
    doc.restore();
  } else {
    doc.rect(photoX, photoY, photoW, photoH).fill(SHIELD_THEME.paper);
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(SHIELD_THEME.blue)
      .text(initials(card.name), photoX, photoY + 23, {
        width: photoW,
        align: 'center',
      });
  }
  doc.rect(photoX, photoY, photoW, photoH).lineWidth(0.8).stroke(SHIELD_THEME.navy);

  const rows = [
    { label: 'CLASS', value: card.class_section || '—' },
    { label: 'ROLL NO', value: card.roll_no ? String(card.roll_no).padStart(2, '0') : '—' },
    { label: 'DATE OF BIRTH', value: displayDate(card.dob) },
    { label: 'BLOOD GROUP', value: card.blood_group || '—' },
    { label: 'GUARDIAN', value: card.father_name || card.guardian_name || '—' },
    { label: 'CONTACT', value: card.guardian_mobile || '—' },
  ];
  let rowY = y + 80;
  for (const row of rows) {
    doc
      .font('Helvetica-Bold')
      .fontSize(4.2)
      .fillColor(SHIELD_THEME.muted)
      .text(row.label, x + 72, rowY, {
        width: w - 80,
        lineBreak: false,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(5.2)
      .fillColor(SHIELD_THEME.text)
      .text(row.value, x + 72, rowY + 6, {
        width: w - 80,
        ellipsis: true,
        lineBreak: false,
      });
    rowY += 22;
  }

  doc.rect(x, y + h - 20, w, 20).fill(SHIELD_THEME.navy);
  doc
    .font('Helvetica-Bold')
    .fontSize(5)
    .fillColor(SHIELD_THEME.gold)
    .text(card.academic_year || 'STUDENT', x + 7, y + h - 12, { width: w - 14, align: 'center', lineBreak: false });
  doc.restore();
}

export function drawIdCardBackDesign3(doc: Pdf, x: number, y: number, card: IdCardData): void {
  const w = CARD_WIDTH_D2;
  const h = CARD_HEIGHT_D2;
  doc.save();
  doc.roundedRect(x, y, w, h, 7).lineWidth(0.7).fillAndStroke(SHIELD_THEME.white, SHIELD_THEME.line);
  doc.roundedRect(x, y, w, h, 7).clip();
  doc.rect(x, y, w, 25).fill(SHIELD_THEME.navy);
  doc.rect(x, y + 23, w, 2).fill(SHIELD_THEME.gold);
  doc
    .font('Helvetica-Bold')
    .fontSize(6)
    .fillColor(SHIELD_THEME.white)
    .text('CAMPUS INFORMATION', x + 6, y + 9, { width: w - 12, align: 'center', lineBreak: false });

  const qrSize = 55;
  const qrX = x + (w - qrSize) / 2;
  const qrY = y + 34;
  doc
    .rect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6)
    .lineWidth(1)
    .stroke(SHIELD_THEME.gold);
  doc.image(card.qr, qrX, qrY, { width: qrSize, height: qrSize });
  doc
    .font('Helvetica')
    .fontSize(5)
    .fillColor(SHIELD_THEME.muted)
    .text('Scan for campus access', x + 8, qrY + qrSize + 8, { width: w - 16, align: 'center', lineBreak: false });

  doc
    .font('Helvetica-Bold')
    .fontSize(6)
    .fillColor(SHIELD_THEME.navy)
    .text(card.school_name.toUpperCase(), x + 8, y + 110, {
      width: w - 16,
      align: 'center',
      ellipsis: true,
      lineBreak: false,
    });
  const details = [
    card.school_address || card.school_city || 'School Campus Office',
    card.school_phone ? `Office: ${card.school_phone}` : '',
    card.school_email ? `Email: ${card.school_email}` : '',
  ].filter(Boolean);
  doc
    .font('Helvetica')
    .fontSize(5)
    .fillColor(SHIELD_THEME.muted)
    .text(details.join('\n'), x + 10, y + 122, {
      width: w - 20,
      align: 'center',
      lineGap: 2,
    });

  const noticeY = y + h - 35;
  doc
    .moveTo(x + 12, noticeY)
    .lineTo(x + w - 12, noticeY)
    .lineWidth(0.6)
    .stroke(SHIELD_THEME.line);
  doc
    .font('Helvetica')
    .fontSize(4.8)
    .fillColor(SHIELD_THEME.muted)
    .text('This card is school property. If found, please return it to the school office.', x + 11, noticeY + 6, {
      width: w - 22,
      align: 'center',
      lineGap: 2,
    });
  doc.restore();
}

/* =========================================================================
   PUBLIC DRAWING & PDF GENERATION APIS
   ========================================================================= */

export function drawIdCardFront(doc: Pdf, x: number, y: number, card: IdCardData, design: string = 'design2'): void {
  if (design === 'design1' || design === 'classic') {
    drawIdCardFrontDesign1(doc, x, y, card);
  } else if (design === 'design3') {
    drawIdCardFrontDesign3(doc, x, y, card);
  } else {
    drawIdCardFrontDesign2(doc, x, y, card);
  }
}

export function drawIdCardBack(doc: Pdf, x: number, y: number, card: IdCardData, design: string = 'design2'): void {
  if (design === 'design1' || design === 'classic') {
    drawIdCardBackDesign1(doc, x, y, card);
  } else if (design === 'design3') {
    drawIdCardBackDesign3(doc, x, y, card);
  } else {
    drawIdCardBackDesign2(doc, x, y, card);
  }
}

export function drawIdCard(doc: Pdf, x: number, y: number, card: IdCardData, design: string = 'design2'): void {
  drawIdCardFront(doc, x, y, card, design);
}

/**
 * Individual Student ID Card PDF:
 * FRONT and BACK are placed SIDE-BY-SIDE with fold guide line for all designs.
 */
export async function idCardPdf(card: IdCardData, design: string = 'design2'): Promise<Buffer> {
  if (design === 'design1' || design === 'classic') {
    // Landscape CR80: Front and Back placed side-by-side
    const gap = 10;
    const padding = 8;
    const pageWidth = padding * 2 + CARD_WIDTH_D1 * 2 + gap;
    const pageHeight = padding * 2 + CARD_HEIGHT_D1;

    const doc = createPdf({
      size: [pageWidth, pageHeight],
      margin: 0,
      info: { Title: `ID card - ${card.name}` },
    });

    // Front on left
    drawIdCardFrontDesign1(doc, padding, padding, card);

    // Dotted fold guide line between them
    doc.save();
    doc.dash(3, { space: 3 }).lineWidth(0.5).strokeColor('#CBD5E1');
    doc
      .moveTo(padding + CARD_WIDTH_D1 + gap / 2, padding)
      .lineTo(padding + CARD_WIDTH_D1 + gap / 2, padding + CARD_HEIGHT_D1)
      .stroke();
    doc.restore();

    // Back on right (with QR code)
    drawIdCardBackDesign1(doc, padding + CARD_WIDTH_D1 + gap, padding, card);

    return renderPdf(doc);
  }

  // Portrait designs (Design 2 & Design 3): Front + Back side-by-side
  const gap = 8;
  const padding = 6;
  const pageWidth = padding * 2 + CARD_WIDTH_D2 * 2 + gap;
  const pageHeight = padding * 2 + CARD_HEIGHT_D2;

  const doc = createPdf({
    size: [pageWidth, pageHeight],
    margin: 0,
    info: { Title: `ID card - ${card.name}` },
  });

  drawIdCardFront(doc, padding, padding, card, design);

  doc.save();
  doc.dash(3, { space: 3 }).lineWidth(0.5).strokeColor('#CBD5E1');
  doc
    .moveTo(padding + CARD_WIDTH_D2 + gap / 2, padding)
    .lineTo(padding + CARD_WIDTH_D2 + gap / 2, padding + CARD_HEIGHT_D2)
    .stroke();
  doc.restore();

  drawIdCardBack(doc, padding + CARD_WIDTH_D2 + gap, padding, card, design);

  return renderPdf(doc);
}

/**
 * A4 Printable Batch Sheet of ID Cards:
 * For Design 1 (Original Classic Landscape):
 * 4 student pairs (Front + Back side-by-side) per A4 page.
 *
 * For Design 2 / 3 (Modern Wave & Campus Shield Portrait):
 * 3 student pairs (Front + Back side-by-side) per A4 page.
 */
export async function idCardSheetPdf(cards: IdCardData[], title: string, design: string = 'design2'): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: title } });

  if (design === 'design1' || design === 'classic') {
    const rowsPerPage = 4;
    const gapX = 10;
    const gapY = 16;
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const pairWidth = CARD_WIDTH_D1 * 2 + gapX;
    const startX = (pageWidth - pairWidth) / 2;
    const startY = (pageHeight - (rowsPerPage * CARD_HEIGHT_D1 + (rowsPerPage - 1) * gapY)) / 2;

    cards.forEach((card, index) => {
      const slot = index % rowsPerPage;
      if (slot === 0) doc.addPage();
      const y = startY + slot * (CARD_HEIGHT_D1 + gapY);

      // Front on left
      drawIdCardFrontDesign1(doc, startX, y, card);

      // Dotted fold guide line
      doc.save();
      doc.dash(3, { space: 3 }).lineWidth(0.5).strokeColor('#CBD5E1');
      doc
        .moveTo(startX + CARD_WIDTH_D1 + gapX / 2, y)
        .lineTo(startX + CARD_WIDTH_D1 + gapX / 2, y + CARD_HEIGHT_D1)
        .stroke();
      doc.restore();

      // Back on right (with QR code)
      drawIdCardBackDesign1(doc, startX + CARD_WIDTH_D1 + gapX, y, card);
    });

    if (!cards.length) doc.addPage();
    return renderPdf(doc);
  }

  const rowsPerPage = 3;
  const gapX = 8;
  const gapY = 16;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const pairWidth = CARD_WIDTH_D2 * 2 + gapX;
  const startX = (pageWidth - pairWidth) / 2;
  const startY = (pageHeight - (rowsPerPage * CARD_HEIGHT_D2 + (rowsPerPage - 1) * gapY)) / 2;

  cards.forEach((card, index) => {
    const slot = index % rowsPerPage;
    if (slot === 0) doc.addPage();
    const y = startY + slot * (CARD_HEIGHT_D2 + gapY);

    drawIdCardFront(doc, startX, y, card, design);

    doc.save();
    doc.dash(3, { space: 3 }).lineWidth(0.5).strokeColor('#CBD5E1');
    doc
      .moveTo(startX + CARD_WIDTH_D2 + gapX / 2, y)
      .lineTo(startX + CARD_WIDTH_D2 + gapX / 2, y + CARD_HEIGHT_D2)
      .stroke();
    doc.restore();

    drawIdCardBack(doc, startX + CARD_WIDTH_D2 + gapX, y, card, design);
  });

  if (!cards.length) doc.addPage();
  return renderPdf(doc);
}
