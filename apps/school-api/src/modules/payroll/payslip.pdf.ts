import { createPdf, renderPdf } from '../student-lifecycle/pdf/pdf-kit';
import { rupees } from './payroll.calc';

export interface PayslipPdfData {
  school_name: string;
  school_code?: string | null;
  school_phone?: string | null;
  school_email?: string | null;
  school_address: string | null;
  school_logo: Buffer | null;
  school_signature?: Buffer | null;
  school_seal?: Buffer | null;
  month_label: string;
  employee_no: string;
  name: string;
  designation: string;
  department: string | null;
  bank: string | null;
  pan_last4: string | null;
  working_days: number;
  lop_days: number;
  paid_days: number;
  earnings: [string, number][];
  deductions: [string, number][];
  gross: number;
  total_deductions: number;
  net: number;
  draft: boolean;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(value: number): string {
  if (value < 20) return ONES[value]!;
  return [TENS[Math.floor(value / 10)], ONES[value % 10]].filter(Boolean).join(' ');
}

function belowThousand(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

export function amountInWords(value: number): string {
  let rest = Math.floor(value);
  const paise = Math.round((value - rest) * 100);
  if (rest === 0 && paise === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  for (const [size, name] of [
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand'],
  ] as const) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${count >= 100 ? belowThousand(count) : belowHundred(count)} ${name}`);
    rest %= size;
  }
  if (rest) parts.push(belowThousand(rest));
  const rupeesText = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  return `${rupeesText}${paise ? ` and ${belowHundred(paise)} Paise` : ''} Only`;
}

export async function payslipPdf(data: PayslipPdfData): Promise<Buffer> {
  const doc = createPdf({
    size: 'A4',
    margins: { top: 36, bottom: 20, left: 45, right: 45 },
    info: { Title: `Payslip - ${data.name} - ${data.month_label}` },
  });

  const left = 45;
  const width = 505.28;
  const right = left + width;

  // 1. Top Header: PAYSLIP title & Number on left, Website / School Logo on right
  doc.font('Helvetica-Bold').fontSize(26).fillColor('#111827').text('PAYSLIP', left, 40, { lineBreak: false });

  if (data.draft) {
    const badgeX = left + 145;
    const badgeY = 44;
    doc.roundedRect(badgeX, badgeY, 46, 15, 3).fillAndStroke('#FEF3C7', '#F59E0B');
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor('#B45309')
      .text('DRAFT', badgeX, badgeY + 4, { width: 46, align: 'center', lineBreak: false });
  }

  const slipNumber = `#TZMS-PAY-${data.month_label.slice(0, 3).toUpperCase()}-${data.employee_no}`;
  doc.font('Helvetica').fontSize(8.5).fillColor('#6B7280').text('Payslip Number  ', left, 70, { continued: true });
  doc.font('Helvetica-Bold').fillColor('#111827').text(slipNumber, { lineBreak: false });

  // Top Right: School Logo or Brand Logo Badge (Seamless fit for ANY logo shape)
  if (data.school_logo) {
    try {
      doc.image(data.school_logo, right - 160, 36, {
        fit: [160, 48],
        align: 'right',
        valign: 'center',
      });
    } catch {
      // If image loading fails, fall back gracefully
    }
  } else {
    // Exact Tamilzorous website brand badge
    const cx = right - 22;
    const cy = 54;
    const r = 20;
    doc.save();
    doc.circle(cx, cy, r).fill('#0F4C3A');
    doc.translate(cx - 11, cy - 11.5).scale(0.35);
    doc
      .path(
        'M33.2366 50.5778H55.433V57.1006H26.0639L33.0244 46.317L59.97 4.55969H2.80371V19.6741H29.0429L2.84002 61.3923H15.6051L44.6391 15.2678H39.9038L13.2402 57.1006H10.5934L36.7963 15.3797H7.08386V8.85692H52.1022L18.196 61.3923H59.7187V46.2834H35.9392L33.2366 50.5778Z',
      )
      .fill('#86EFAC');
    doc.restore();
  }

  // Thin Horizontal Divider Line
  doc.moveTo(left, 92).lineTo(right, 92).lineWidth(0.8).strokeColor('#E5E7EB').stroke();

  // 2. Metadata Section (Billed by / Billed to & Dates)
  const colW = (width - 20) / 2;
  const rX = left + colW + 20;

  // Row 1: Billed by / Billed to
  doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text('Billed by:', left, 106, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor('#111827')
    .text(data.school_name, left, 118, { width: colW, ellipsis: true, lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#6B7280')
    .text(data.school_email || 'office@tamilzorous.edu', left, 131, { lineBreak: false });
  doc.text(data.school_address || 'School Campus Office, Chennai - 600001', left, 142, {
    width: colW,
    ellipsis: true,
    lineBreak: false,
  });

  doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text('Billed to:', rX, 106, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor('#111827')
    .text(data.name, rX, 118, { width: colW, ellipsis: true, lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#6B7280')
    .text(`${data.designation}${data.department ? ' · ' + data.department : ''}`, rX, 131, {
      width: colW,
      ellipsis: true,
      lineBreak: false,
    });
  doc.text(`Employee ID: ${data.employee_no}${data.pan_last4 ? ' · PAN: XXXXXX' + data.pan_last4 : ''}`, rX, 142, {
    width: colW,
    ellipsis: true,
    lineBreak: false,
  });

  // Row 2: Date Issue / Due Date
  const dateY = 162;
  doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text('Date Issue:', left, dateY, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#111827')
    .text(data.month_label, left, dateY + 12, { lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text('Due Date:', rX, dateY, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#111827')
    .text(`31 ${data.month_label}`, rX, dateY + 12, { lineBreak: false });

  // 3. Table Section: Invoice Items / Service
  const tableTop = 198;
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#6B7280')
    .text('Invoice Items / Service:', left, tableTop, { lineBreak: false });

  const colX = {
    name: left,
    qty: left + 260,
    tax: left + 340,
    amt: right - 85,
  };

  const headerY = tableTop + 14;
  doc.font('Helvetica').fontSize(8).fillColor('#6B7280');
  doc.text('Item Name', colX.name, headerY, { width: 250, lineBreak: false });
  doc.text('QTY', colX.qty, headerY, { width: 50, align: 'center', lineBreak: false });
  doc.text('Tax / Type', colX.tax, headerY, { width: 70, align: 'center', lineBreak: false });
  doc.text('Amount', colX.amt, headerY, { width: 85, align: 'right', lineBreak: false });

  doc
    .moveTo(left, headerY + 12)
    .lineTo(right, headerY + 12)
    .lineWidth(0.6)
    .strokeColor('#E5E7EB')
    .stroke();

  // Table items
  const tableItems = [
    ...data.earnings.map(([name, amt]) => ({
      name,
      qty: `${data.paid_days}`,
      tax: 'Earning',
      amount: amt,
      isDeduction: false,
    })),
    ...data.deductions.map(([name, amt]) => ({
      name,
      qty: '1',
      tax: 'Deduction',
      amount: amt,
      isDeduction: true,
    })),
  ];

  let curY = headerY + 14;
  const rowH = 21;

  tableItems.forEach((item) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#111827')
      .text(item.name, colX.name, curY + 5, { width: 250, ellipsis: true, lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#6B7280')
      .text(item.qty, colX.qty, curY + 5, { width: 50, align: 'center', lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(item.isDeduction ? '#DC2626' : '#059669')
      .text(item.tax, colX.tax, curY + 5, { width: 70, align: 'center', lineBreak: false });

    const prefix = item.isDeduction ? '- ' : '';
    const color = item.isDeduction ? '#DC2626' : '#111827';
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(color)
      .text(`${prefix}${rupees(item.amount)}`, colX.amt, curY + 5, { width: 85, align: 'right', lineBreak: false });

    doc
      .moveTo(left, curY + rowH)
      .lineTo(right, curY + rowH)
      .lineWidth(0.5)
      .strokeColor('#F3F4F6')
      .stroke();
    curY += rowH;
  });

  // 4. Financial Summary (Right-aligned, matching reference image)
  const summaryTop = curY + 10;
  const summaryW = 190;
  const summaryX = right - summaryW;

  doc.moveTo(summaryX, summaryTop).lineTo(right, summaryTop).lineWidth(0.8).strokeColor('#E5E7EB').stroke();

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#6B7280')
    .text('Subtotal', summaryX, summaryTop + 8, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#111827')
    .text(rupees(data.gross), summaryX + 80, summaryTop + 8, { width: 110, align: 'right', lineBreak: false });

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#6B7280')
    .text('Discount / Deductions', summaryX, summaryTop + 22, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#DC2626')
    .text(`- ${rupees(data.total_deductions)}`, summaryX + 80, summaryTop + 22, {
      width: 110,
      align: 'right',
      lineBreak: false,
    });

  doc
    .moveTo(summaryX, summaryTop + 37)
    .lineTo(right, summaryTop + 37)
    .lineWidth(0.8)
    .strokeColor('#E5E7EB')
    .stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#111827')
    .text('Grand Total', summaryX, summaryTop + 44, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111827')
    .text(rupees(data.net), summaryX + 70, summaryTop + 43, { width: 120, align: 'right', lineBreak: false });

  // 5. Rounded Capsule Note Box
  const noteY = summaryTop + 68;
  const noteH = 30;
  doc
    .roundedRect(left, noteY, width, noteH, 6)
    .lineWidth(0.8)
    .strokeColor('#E5E7EB')
    .fillAndStroke('#F9FAFB', '#E5E7EB');

  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor('#111827')
    .text('Note: ', left + 14, noteY + 9, { continued: true });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#6B7280')
    .text(
      `Amount in Words: ${amountInWords(data.net)}. This is a computer generated payslip and requires no physical signature.`,
      { width: width - 28 },
    );

  // 6. Bottom Section: Payment Method on left, Stylized Signature on right
  const bottomY = noteY + noteH + 18;

  // Left: Payment Method
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#111827')
    .text('Payment Method', left, bottomY, { lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#6B7280')
    .text(data.bank ? 'EFT Bank Transfer / NEFT' : 'Direct Transfer', left, bottomY + 12, { lineBreak: false });
  const accText = `Account Number: ${data.bank || 'Canara Bank ····5678'}  ·  Paid Days: ${data.paid_days}/${data.working_days}`;
  doc.text(accText, left, bottomY + 23, { width: 320, lineBreak: false });

  // Right: Seal & Stylized Signature
  const sigX = right - 130;
  if (data.school_seal) {
    try {
      doc.image(data.school_seal, sigX - 60, bottomY - 14, { fit: [50, 50] });
    } catch {
      // ignore
    }
  }
  if (data.school_signature) {
    try {
      doc.image(data.school_signature, sigX + 10, bottomY - 6, {
        fit: [110, 26],
        align: 'center',
        valign: 'bottom',
      });
    } catch {
      doc.save();
      doc.lineWidth(1.4).strokeColor('#111827');
      doc
        .moveTo(sigX + 15, bottomY + 14)
        .bezierCurveTo(sigX + 30, bottomY - 2, sigX + 45, bottomY + 16, sigX + 60, bottomY + 6)
        .stroke();
      doc
        .moveTo(sigX + 40, bottomY + 2)
        .lineTo(sigX + 40, bottomY + 20)
        .stroke();
      doc
        .moveTo(sigX + 32, bottomY + 10)
        .bezierCurveTo(sigX + 45, bottomY + 4, sigX + 55, bottomY + 12, sigX + 70, bottomY + 8)
        .stroke();
      doc.restore();
    }
  } else {
    doc.save();
    doc.lineWidth(1.4).strokeColor('#111827');
    doc
      .moveTo(sigX + 15, bottomY + 14)
      .bezierCurveTo(sigX + 30, bottomY - 2, sigX + 45, bottomY + 16, sigX + 60, bottomY + 6)
      .stroke();
    doc
      .moveTo(sigX + 40, bottomY + 2)
      .lineTo(sigX + 40, bottomY + 20)
      .stroke();
    doc
      .moveTo(sigX + 32, bottomY + 10)
      .bezierCurveTo(sigX + 45, bottomY + 4, sigX + 55, bottomY + 12, sigX + 70, bottomY + 8)
      .stroke();
    doc.restore();
  }

  doc
    .moveTo(sigX, bottomY + 22)
    .lineTo(right, bottomY + 22)
    .lineWidth(0.6)
    .strokeColor('#111827')
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor('#111827')
    .text('Authorized Signatory', sigX, bottomY + 26, { width: 130, align: 'center', lineBreak: false });

  // 7. Footer
  doc.moveTo(left, 792).lineTo(right, 792).lineWidth(0.5).strokeColor('#E5E7EB').stroke();
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#94A3B8')
    .text(`Powered by ${data.school_name}`, left, 797, { lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#94A3B8')
    .text('Page 1 of 1', right - 100, 797, { width: 100, align: 'right', lineBreak: false });

  return renderPdf(doc);
}
