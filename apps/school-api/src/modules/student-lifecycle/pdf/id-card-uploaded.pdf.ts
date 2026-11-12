import { IdCardLayout, IdCardLayoutItem, IdCardLayoutKey } from '../../../shared/id-card-layout';
import { CARD_HEIGHT_D1, CARD_WIDTH_D1, IdCardData } from './id-card.pdf';
import { createPdf, displayDate, Pdf, renderPdf } from './pdf-kit';

export interface UploadedIdCardDesign {
  front: Buffer;
  back: Buffer | null;
  layout: IdCardLayout;
}

type OpenedImage = { width: number; height: number };
type Box = { x: number; y: number; w: number; h: number };

const A4 = { w: 595.28, h: 841.89 };
const GAP = 10;

function open(doc: Pdf, image: Buffer): OpenedImage {
  return (doc as unknown as { openImage(src: Buffer): OpenedImage }).openImage(image);
}

function cardSize(front: OpenedImage): { w: number; h: number } {
  return front.width > front.height ? { w: CARD_WIDTH_D1, h: CARD_HEIGHT_D1 } : { w: CARD_HEIGHT_D1, h: CARD_WIDTH_D1 };
}

export function idCardValue(key: IdCardLayoutKey, card: IdCardData): string {
  switch (key) {
    case 'student_name':
      return card.name;
    case 'admission_no':
      return card.admission_no;
    case 'class_section':
      return card.class_section ?? '';
    case 'roll_no':
      return card.roll_no === null ? '' : String(card.roll_no).padStart(2, '0');
    case 'dob':
      return card.dob ? displayDate(card.dob) : '';
    case 'blood_group':
      return card.blood_group ?? '';
    case 'guardian_name':
      return card.guardian_name ?? '';
    case 'guardian_mobile':
      return card.guardian_mobile ?? '';
    case 'address':
      return card.address ?? '';
    case 'academic_year':
      return card.academic_year ?? '';
    default:
      return '';
  }
}

function drawText(doc: Pdf, box: Box, item: IdCardLayoutItem, value: string): void {
  if (!value) return;
  const options = { width: box.w, align: item.align, lineGap: 0 } as const;
  doc.save();
  doc.font(item.bold ? 'Helvetica-Bold' : 'Helvetica');
  let size = item.font_size;
  doc.fontSize(size);
  while (size > 3 && doc.heightOfString(value, options) > box.h + 0.5) {
    size -= 0.25;
    doc.fontSize(size);
  }
  const textHeight = Math.min(box.h, doc.heightOfString(value, options));
  doc.rect(box.x, box.y, box.w, box.h).clip();
  doc
    .fillColor(item.color)
    .text(value, box.x, box.y + (box.h - textHeight) / 2, { ...options, height: box.h + size, ellipsis: true });
  doc.restore();
}

function drawPicture(doc: Pdf, box: Box, image: Buffer | null, cover: boolean): void {
  if (!image) return;
  doc.save();
  try {
    doc.rect(box.x, box.y, box.w, box.h).clip();
    if (cover) doc.image(image, box.x, box.y, { cover: [box.w, box.h], align: 'center', valign: 'center' });
    else doc.image(image, box.x, box.y, { fit: [box.w, box.h], align: 'center', valign: 'center' });
  } catch {
    return;
  } finally {
    doc.restore();
  }
}

function drawSide(
  doc: Pdf,
  image: OpenedImage,
  items: IdCardLayoutItem[],
  card: IdCardData,
  x: number,
  y: number,
  size: { w: number; h: number },
): void {
  doc.image(image as unknown as Buffer, x, y, { width: size.w, height: size.h });
  for (const item of items) {
    const box = { x: x + item.x * size.w, y: y + item.y * size.h, w: item.w * size.w, h: item.h * size.h };
    if (item.key === 'photo') drawPicture(doc, box, card.photo, true);
    else if (item.key === 'qr') drawPicture(doc, box, card.qr, false);
    else drawText(doc, box, item, idCardValue(item.key, card));
  }
  doc.save();
  doc.rect(x, y, size.w, size.h).lineWidth(0.4).stroke('#CBD5E1');
  doc.restore();
}

interface Opened {
  front: OpenedImage;
  back: OpenedImage | null;
  size: { w: number; h: number };
}

function openDesign(doc: Pdf, design: UploadedIdCardDesign): Opened {
  const front = open(doc, design.front);
  return { front, back: design.back ? open(doc, design.back) : null, size: cardSize(front) };
}

function drawPair(doc: Pdf, opened: Opened, layout: IdCardLayout, card: IdCardData, x: number, y: number): void {
  const { size } = opened;
  drawSide(doc, opened.front, layout.front, card, x, y, size);
  if (!opened.back) return;
  doc.save();
  doc.dash(3, { space: 3 }).lineWidth(0.5).strokeColor('#CBD5E1');
  doc
    .moveTo(x + size.w + GAP / 2, y)
    .lineTo(x + size.w + GAP / 2, y + size.h)
    .stroke();
  doc.restore();
  drawSide(doc, opened.back, layout.back, card, x + size.w + GAP, y, size);
}

export async function uploadedIdCardPdf(design: UploadedIdCardDesign, card: IdCardData): Promise<Buffer> {
  const padding = 8;
  const doc = createPdf({ autoFirstPage: false, margin: 0, info: { Title: `ID card - ${card.name}` } });
  const opened = openDesign(doc, design);
  const { size } = opened;
  doc.addPage({
    size: [padding * 2 + (opened.back ? size.w * 2 + GAP : size.w), padding * 2 + size.h],
    margin: 0,
  });
  drawPair(doc, opened, design.layout, card, padding, padding);
  return renderPdf(doc);
}

export async function uploadedIdCardSheetPdf(
  design: UploadedIdCardDesign,
  cards: IdCardData[],
  title: string,
): Promise<Buffer> {
  const doc = createPdf({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: title } });
  const opened = openDesign(doc, design);
  const { size } = opened;
  const gapY = 16;
  const pairWidth = opened.back ? size.w * 2 + GAP : size.w;
  const columns = Math.max(1, Math.floor((A4.w - 40 + GAP) / (pairWidth + GAP)));
  const rows = Math.max(1, Math.floor((A4.h - 40 + gapY) / (size.h + gapY)));
  const perPage = columns * rows;
  const startX = (A4.w - (columns * pairWidth + (columns - 1) * GAP)) / 2;
  const startY = (A4.h - (rows * size.h + (rows - 1) * gapY)) / 2;
  cards.forEach((card, index) => {
    const slot = index % perPage;
    if (slot === 0) doc.addPage();
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    drawPair(doc, opened, design.layout, card, startX + column * (pairWidth + GAP), startY + row * (size.h + gapY));
  });
  if (!cards.length) doc.addPage();
  return renderPdf(doc);
}
