import { createPdf, Pdf, renderPdf } from '../student-lifecycle/pdf/pdf-kit';
import { ReportCardDto } from './dto/report-card.dto';
import { formatMarks } from './report-card.logic';

export interface ReportCardPdfData {
  card: ReportCardDto;
  logo: Buffer | null;
  signature?: Buffer | null;
  seal?: Buffer | null;
  photo: Buffer | null;
  generated_on: string;
}

interface Layout {
  pageWidth: number;
  pageHeight: number;
  left: number;
  width: number;
  bottom: number;
}

export function reportCardsPdf(pages: ReportCardPdfData[]): Promise<Buffer> {
  const doc = createPdf({
    size: 'A4',
    layout: 'portrait',
    margin: 0,
    autoFirstPage: false,
    info: { Title: pages.length === 1 ? reportTitle(pages[0]!.card) : 'Report cards' },
  });
  for (const page of pages) drawReportCard(doc, page);
  return renderPdf(doc);
}

function reportTitle(card: ReportCardDto): string {
  return `${card.scope.title} ${card.student.full_name} ${card.scope.academic_year.name}`;
}

function getSubjectRemark(grade: string | null, percent: number | null, passed: boolean | null): string {
  if (passed === false) return 'Needs Improvement';
  const g = (grade ?? '').toUpperCase();
  if (g === 'O' || g === 'A1' || (percent !== null && percent >= 90)) return 'Outstanding';
  if (g === 'A+' || g === 'A2' || (percent !== null && percent >= 80)) return 'Outstanding';
  if (g === 'A' || g === 'B1' || (percent !== null && percent >= 70)) return 'Very Good';
  if (g === 'B+' || g === 'B2' || (percent !== null && percent >= 60)) return 'Good';
  if (g === 'B' || g === 'C1' || (percent !== null && percent >= 50)) return 'Above Average';
  if (g === 'C' || g === 'C2' || (percent !== null && percent >= 40)) return 'Satisfactory';
  if (g === 'D' || g === 'E' || g === 'FAIL') return 'Needs Improvement';
  return 'Outstanding';
}

function getGradingScale(card: ReportCardDto): { range: string; grade: string }[] {
  const sampleMax = card.subjects[0]?.cells[0]?.max_marks ?? card.subjects[0]?.max_total ?? 100;
  if (sampleMax === 50) {
    return [
      { range: '46 - 50', grade: 'O' },
      { range: '41 - 45', grade: 'A+' },
      { range: '36 - 40', grade: 'A' },
      { range: '31 - 35', grade: 'B+' },
      { range: '26 - 30', grade: 'B' },
      { range: '18 - 25', grade: 'C' },
      { range: '0 - 17', grade: 'Fail' },
    ];
  }
  if (card.grade_scale && card.grade_scale.length > 0) {
    return card.grade_scale.map((step) => ({
      range: `${step.min} - ${step.max}`,
      grade: step.grade === 'E' ? 'Fail' : step.grade,
    }));
  }
  return [
    { range: '91 - 100', grade: 'O' },
    { range: '81 - 90', grade: 'A+' },
    { range: '71 - 80', grade: 'A' },
    { range: '61 - 70', grade: 'B+' },
    { range: '51 - 60', grade: 'B' },
    { range: '36 - 50', grade: 'C' },
    { range: '0 - 35', grade: 'Fail' },
  ];
}

export function drawReportCard(doc: Pdf, data: ReportCardPdfData): void {
  const { card } = data;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const left = 36;
  const width = pageWidth - left * 2;
  const layout: Layout = {
    pageWidth,
    pageHeight,
    left,
    width,
    bottom: pageHeight - 36,
  };

  doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });

  // 1. Double Outer Frame
  doc
    .rect(24, 24, pageWidth - 48, pageHeight - 64)
    .lineWidth(1.5)
    .strokeColor('#000000')
    .stroke();
  doc
    .rect(27, 27, pageWidth - 54, pageHeight - 70)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  // 2. School Header Box
  headerBox(doc, data, layout);

  // 3. Subtitle / Term & Academic Year Badge
  badgeBox(doc, card, layout);

  // 4. Student Information Section (Underlined style)
  studentFacts(doc, card, layout);

  // 5. Marks Table with Full Gridlines
  const tableBottom = marksTable(doc, card, layout);

  // 6. Overall Metrics (Rank, Grade, Overall Percentage)
  const summaryBottom = summaryRow(doc, card, layout, tableBottom);

  // 7. Grading System Table
  const gradingBottom = gradingTable(doc, card, layout, summaryBottom);

  // 8. Signatures & Verification Section
  signatures(doc, data, layout, gradingBottom);

  // 9. Page Number (1 centered at bottom)
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#111827')
    .text('1', left, pageHeight - 34, {
      width,
      align: 'center',
    });
}

function headerBox(doc: Pdf, data: ReportCardPdfData, layout: Layout): void {
  const { card } = data;
  const { left, width } = layout;
  const top = 36;
  const height = 62;
  const logoWidth = 80;

  // Outer border of header box
  doc.rect(left, top, width, height).lineWidth(1).strokeColor('#000000').stroke();

  // Vertical separator between logo and text
  doc
    .moveTo(left + logoWidth, top)
    .lineTo(left + logoWidth, top + height)
    .lineWidth(1)
    .strokeColor('#000000')
    .stroke();

  // Logo content
  if (data.logo) {
    try {
      doc.image(data.logo, left + 4, top + 4, {
        fit: [logoWidth - 8, height - 8],
        align: 'center',
        valign: 'center',
      });
    } catch {
      renderLogoPlaceholder(doc, left, top, logoWidth, height);
    }
  } else {
    renderLogoPlaceholder(doc, left, top, logoWidth, height);
  }

  // Right side 3-row grid
  const infoX = left + logoWidth;
  const infoWidth = width - logoWidth;

  // Row 1 separator
  doc
    .moveTo(infoX, top + 26)
    .lineTo(left + width, top + 26)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  // Row 1: School Name in RED bold uppercase
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#D32F2F')
    .text(card.school.name.toUpperCase(), infoX + 4, top + 7, {
      width: infoWidth - 8,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });

  // Row 2 separator
  doc
    .moveTo(infoX, top + 44)
    .lineTo(left + width, top + 44)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  // Row 2: Address in RED
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#D32F2F')
    .text(card.school.address || '24, ABC street, DEF Road, Mumbai', infoX + 4, top + 31, {
      width: infoWidth - 8,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });

  // Row 3: Contact in RED
  const phone = card.school.phone || '9876543210';
  const email = card.school.email || 'admin@saphss.com';
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#D32F2F')
    .text(`Phone: ${phone}     Email: ${email}`, infoX + 4, top + 49, {
      width: infoWidth - 8,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });
}

function renderLogoPlaceholder(doc: Pdf, left: number, top: number, width: number, height: number): void {
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#9CA3AF')
    .text('Insert School\nLogo', left + 4, top + height / 2 - 8, {
      width: width - 8,
      align: 'center',
    });
}

function badgeBox(doc: Pdf, card: ReportCardDto, layout: Layout): void {
  const { left, width } = layout;
  const badgeWidth = 190;
  const badgeHeight = 28;
  const badgeX = left + (width - badgeWidth) / 2;
  const badgeY = 106;

  doc
    .roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 4)
    .lineWidth(0.8)
    .strokeColor('#4B5563')
    .fillColor('#D1D5DB')
    .fillAndStroke();

  const termTitle = card.scope.term?.name
    ? `${card.scope.term.name} Report Card`
    : card.scope.exam?.name
      ? `${card.scope.exam.name} Report Card`
      : card.scope.title || 'Term - 1 Report Card';

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#111827')
    .text(termTitle, badgeX, badgeY + 4, {
      width: badgeWidth,
      align: 'center',
      lineBreak: false,
    });

  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor('#111827')
    .text(`Academic Year ${card.scope.academic_year.name}`, badgeX, badgeY + 16, {
      width: badgeWidth,
      align: 'center',
      lineBreak: false,
    });
}

function studentFacts(doc: Pdf, card: ReportCardDto, layout: Layout): void {
  const { left, width } = layout;
  const student = card.student;

  // Row 1: Roll No | Class & Div | Attendance
  const row1Y = 144;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text('Roll No:', left, row1Y);
  const rollVal = student.roll_no === null ? '—' : String(student.roll_no);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#111827')
    .text(rollVal, left + 42, row1Y, { width: 45, align: 'center', lineBreak: false });
  doc
    .moveTo(left + 42, row1Y + 10)
    .lineTo(left + 87, row1Y + 10)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  const classX = left + 180;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text('Class & Div:', classX, row1Y);
  const classVal = [student.class_name, student.section_name].filter(Boolean).join(' - ') || '—';
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#111827')
    .text(classVal, classX + 55, row1Y, { width: 70, align: 'center', lineBreak: false });
  doc
    .moveTo(classX + 55, row1Y + 10)
    .lineTo(classX + 125, row1Y + 10)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  const attX = left + width - 150;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text('Attendance:', attX, row1Y);
  const attVal = card.attendance.working_days
    ? `${formatMarks(card.attendance.present_days)}/${card.attendance.working_days}`
    : card.attendance.percent !== null
      ? `${formatMarks(card.attendance.percent)}%`
      : '—';
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#111827')
    .text(attVal, attX + 58, row1Y, { width: 80, align: 'center', lineBreak: false });
  doc
    .moveTo(attX + 58, row1Y + 10)
    .lineTo(attX + 138, row1Y + 10)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  // Row 2: Student Name | GR No
  const row2Y = 162;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text('Student Name:', left, row2Y);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#111827')
    .text(student.full_name, left + 70, row2Y, { width: 230, lineBreak: false, ellipsis: true });
  doc
    .moveTo(left + 70, row2Y + 10)
    .lineTo(left + 300, row2Y + 10)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  const grX = left + width - 150;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text('GR No:', grX, row2Y);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#111827')
    .text(student.admission_no, grX + 38, row2Y, { width: 100, align: 'center', lineBreak: false });
  doc
    .moveTo(grX + 38, row2Y + 10)
    .lineTo(grX + 138, row2Y + 10)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();
}

function marksTable(doc: Pdf, card: ReportCardDto, layout: Layout): number {
  const { left, width } = layout;
  const isMultiExam = card.columns.length > 1;
  const tableTop = 184;

  let colWidths: { [key: string]: number };
  if (isMultiExam) {
    const examColWidth = Math.max(36, 120 / card.columns.length);
    colWidths = {
      index: 22,
      subject: width - (examColWidth * card.columns.length + 65 + 75 + 65 + 75 + 22),
      totalMarks: 65,
      marksObtained: 75,
      grade: 65,
      remarks: 75,
    };
  } else {
    colWidths = {
      index: 24,
      subject: width - (24 + 75 + 85 + 75 + 85),
      totalMarks: 75,
      marksObtained: 85,
      grade: 75,
      remarks: 85,
    };
  }

  const headHeight = 20;

  // Header bounding box
  doc.rect(left, tableTop, width, headHeight).lineWidth(0.8).strokeColor('#000000').stroke();

  // Header cells
  let curX = left;
  const drawHeaderCell = (w: number, title: string, align: 'center' | 'left' = 'center') => {
    doc
      .moveTo(curX + w, tableTop)
      .lineTo(curX + w, tableTop + headHeight)
      .lineWidth(0.8)
      .strokeColor('#000000')
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#111827')
      .text(title, align === 'left' ? curX + 6 : curX, tableTop + 5, {
        width: align === 'left' ? w - 12 : w,
        align,
        lineBreak: false,
      });
    curX += w;
  };

  drawHeaderCell(colWidths.index!, '#');
  drawHeaderCell(colWidths.subject!, 'Subject', 'left');

  if (isMultiExam) {
    const examColWidth = Math.max(36, 120 / card.columns.length);
    card.columns.forEach((col) => {
      drawHeaderCell(examColWidth, col.name);
    });
  }

  drawHeaderCell(colWidths.totalMarks!, 'Total Marks');
  drawHeaderCell(colWidths.marksObtained!, 'Marks Obtained');
  drawHeaderCell(colWidths.grade!, 'Subject Grade');

  // Last column (Remarks) - no trailing vertical line needed since outer rect closes it
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#111827')
    .text('Remarks', curX, tableTop + 5, {
      width: colWidths.remarks!,
      align: 'center',
      lineBreak: false,
    });

  // Rows
  const rowHeight = 17;
  let curY = tableTop + headHeight;

  card.subjects.forEach((subj, idx) => {
    doc.rect(left, curY, width, rowHeight).lineWidth(0.8).strokeColor('#000000').stroke();

    const totalMarks = subj.cells[0]?.max_marks ?? subj.max_total;
    const marksObtained = subj.cells[0]?.is_absent
      ? 'AB'
      : subj.cells[0]?.marks !== null
        ? formatMarks(subj.cells[0]!.marks)
        : formatMarks(subj.total);
    const grade = subj.grade ?? '—';
    const remark = getSubjectRemark(grade, subj.percent, subj.passed);

    let rowX = left;
    const drawRowCell = (w: number, val: string, align: 'center' | 'left' = 'center') => {
      doc
        .moveTo(rowX + w, curY)
        .lineTo(rowX + w, curY + rowHeight)
        .lineWidth(0.8)
        .strokeColor('#000000')
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#111827')
        .text(val, align === 'left' ? rowX + 6 : rowX, curY + 4, {
          width: align === 'left' ? w - 12 : w,
          align,
          lineBreak: false,
          ellipsis: true,
        });
      rowX += w;
    };

    drawRowCell(colWidths.index!, String(idx + 1));
    drawRowCell(colWidths.subject!, subj.name, 'left');

    if (isMultiExam) {
      const examColWidth = Math.max(36, 120 / card.columns.length);
      subj.cells.forEach((cell) => {
        const text = cell?.is_absent ? 'AB' : cell?.marks !== null ? formatMarks(cell!.marks) : '—';
        drawRowCell(examColWidth, text);
      });
    }

    drawRowCell(colWidths.totalMarks!, String(totalMarks));
    drawRowCell(colWidths.marksObtained!, String(marksObtained));
    drawRowCell(colWidths.grade!, grade);

    // Remarks cell
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#111827')
      .text(remark, rowX, curY + 4, {
        width: colWidths.remarks!,
        align: 'center',
        lineBreak: false,
      });

    curY += rowHeight;
  });

  // Total row
  const totalHeight = 18;
  doc.rect(left, curY, width, totalHeight).lineWidth(0.8).strokeColor('#000000').stroke();

  let totX = left;
  const spanSubjectW =
    colWidths.index! +
    colWidths.subject! +
    (isMultiExam ? Math.max(36, 120 / card.columns.length) * card.columns.length : 0);
  doc
    .moveTo(totX + spanSubjectW, curY)
    .lineTo(totX + spanSubjectW, curY + totalHeight)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#111827')
    .text('Total', totX, curY + 4, {
      width: spanSubjectW - 10,
      align: 'right',
      lineBreak: false,
    });
  totX += spanSubjectW;

  // Total Marks
  doc
    .moveTo(totX + colWidths.totalMarks!, curY)
    .lineTo(totX + colWidths.totalMarks!, curY + totalHeight)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#111827')
    .text(String(card.overall.max_total), totX, curY + 4, {
      width: colWidths.totalMarks!,
      align: 'center',
      lineBreak: false,
    });
  totX += colWidths.totalMarks!;

  // Marks Obtained
  doc
    .moveTo(totX + colWidths.marksObtained!, curY)
    .lineTo(totX + colWidths.marksObtained!, curY + totalHeight)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#111827')
    .text(formatMarks(card.overall.total), totX, curY + 4, {
      width: colWidths.marksObtained!,
      align: 'center',
      lineBreak: false,
    });
  totX += colWidths.marksObtained!;

  // Empty grade separator
  doc
    .moveTo(totX + colWidths.grade!, curY)
    .lineTo(totX + colWidths.grade!, curY + totalHeight)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  return curY + totalHeight;
}

function summaryRow(doc: Pdf, card: ReportCardDto, layout: Layout, tableBottom: number): number {
  const sumY = tableBottom + 12;

  // Rank
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text('Rank:', 80, sumY);
  const rankVal = String(card.columns[0]?.class_rank ?? card.columns[0]?.section_rank ?? 1);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#111827')
    .text(rankVal, 110, sumY, { width: 45, align: 'center', lineBreak: false });
  doc
    .moveTo(110, sumY + 10)
    .lineTo(155, sumY + 10)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  // Grade
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text('Grade:', 235, sumY);
  const gradeVal = card.overall.grade ?? '—';
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#111827')
    .text(gradeVal, 270, sumY, { width: 45, align: 'center', lineBreak: false });
  doc
    .moveTo(270, sumY + 10)
    .lineTo(315, sumY + 10)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  // Overall Percentage
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text('Overall Percentage:', 385, sumY);
  const pctVal = card.overall.percent !== null ? `${formatMarks(card.overall.percent)} %` : '—';
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#111827')
    .text(pctVal, 478, sumY, { width: 62, align: 'center', lineBreak: false });
  doc
    .moveTo(478, sumY + 10)
    .lineTo(540, sumY + 10)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  return sumY + 18;
}

function gradingTable(doc: Pdf, card: ReportCardDto, layout: Layout, summaryBottom: number): number {
  const { left, width } = layout;
  const scale = getGradingScale(card);
  const tableWidth = Math.min(380, width);
  const tableX = left + (width - tableWidth) / 2;
  const tableY = summaryBottom + 8;
  const colWidth = tableWidth / scale.length;

  const headerH = 13;
  const row1H = 12;
  const row2H = 12;
  const totalH = headerH + row1H + row2H;

  // Outer border
  doc.rect(tableX, tableY, tableWidth, totalH).lineWidth(0.8).strokeColor('#000000').stroke();

  // Header: "Grading System"
  doc
    .moveTo(tableX, tableY + headerH)
    .lineTo(tableX + tableWidth, tableY + headerH)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor('#111827')
    .text('Grading System', tableX, tableY + 3, {
      width: tableWidth,
      align: 'center',
      lineBreak: false,
    });

  // Row 1 separator
  doc
    .moveTo(tableX, tableY + headerH + row1H)
    .lineTo(tableX + tableWidth, tableY + headerH + row1H)
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();

  // Vertical separators & cell texts
  scale.forEach((item, idx) => {
    const x = tableX + idx * colWidth;
    if (idx > 0) {
      doc
        .moveTo(x, tableY + headerH)
        .lineTo(x, tableY + totalH)
        .lineWidth(0.8)
        .strokeColor('#000000')
        .stroke();
    }
    // Row 1: Range
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor('#111827')
      .text(item.range, x, tableY + headerH + 2.5, {
        width: colWidth,
        align: 'center',
        lineBreak: false,
      });
    // Row 2: Grade
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor('#111827')
      .text(item.grade, x, tableY + headerH + row1H + 2.5, {
        width: colWidth,
        align: 'center',
        lineBreak: false,
      });
  });

  return tableY + totalH;
}

function signatures(doc: Pdf, data: ReportCardPdfData, layout: Layout, gradingBottom: number): void {
  const { card, signature, seal } = data;
  const { left, width, pageHeight } = layout;
  const sigY = Math.max(gradingBottom + 20, pageHeight - 110);
  const boxWidth = 92;
  const boxHeight = 24;

  const principalName = card.school.principal_name || 'Meenakshi Sundaram';
  const cols = [
    { type: 'sig' as const, label: 'Class Teacher', name: card.student.class_teacher || '' },
    { type: 'sig' as const, label: 'Parents', name: card.student.parent_name || '' },
    { type: 'seal' as const, label: 'School Seal' },
    { type: 'sig' as const, label: 'Principal', name: principalName, isPrincipal: true },
  ];

  const colSlot = width / cols.length;

  cols.forEach((col, idx) => {
    const centerX = left + idx * colSlot + colSlot / 2;
    const boxX = centerX - boxWidth / 2;

    if (col.type === 'sig') {
      // Name above
      if (col.name) {
        doc.font('Helvetica').fontSize(7.5).fillColor('#111827').text(col.name, boxX, sigY, {
          width: boxWidth,
          align: 'center',
          lineBreak: false,
          ellipsis: true,
        });
      }

      // Rectangular signature box
      doc
        .rect(boxX, sigY + 11, boxWidth, boxHeight)
        .lineWidth(0.8)
        .strokeColor('#000000')
        .stroke();

      if (col.isPrincipal && signature) {
        try {
          doc.image(signature, boxX + 4, sigY + 12, {
            fit: [boxWidth - 8, boxHeight - 2],
            align: 'center',
            valign: 'center',
          });
        } catch {
          // preserve clean box
        }
      }

      // Label below
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#111827')
        .text(col.label, boxX, sigY + 11 + boxHeight + 4, {
          width: boxWidth,
          align: 'center',
          lineBreak: false,
        });
    } else if (col.type === 'seal') {
      if (seal) {
        try {
          const sealSize = 42;
          doc.image(seal, centerX - sealSize / 2, sigY + 2, {
            fit: [sealSize, sealSize],
            align: 'center',
            valign: 'center',
          });
        } catch {
          // ignore
        }
      } else {
        doc.save();
        doc
          .circle(centerX, sigY + 23, 20)
          .lineWidth(0.8)
          .dash(3, { space: 2 })
          .strokeColor('#9ca3af')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(6)
          .fillColor('#9ca3af')
          .text('AFFIX SEAL', centerX - 25, sigY + 20, { width: 50, align: 'center', lineBreak: false });
        doc.restore();
      }

      // Label below
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#111827')
        .text(col.label, centerX - boxWidth / 2, sigY + 11 + boxHeight + 4, {
          width: boxWidth,
          align: 'center',
          lineBreak: false,
        });
    }
  });
}
