import sharp from 'sharp';
import { normalizeIdCardLayout } from '../../../shared/id-card-layout';
import type { IdCardData } from './id-card.pdf';
import { idCardValue, uploadedIdCardPdf, uploadedIdCardSheetPdf } from './id-card-uploaded.pdf';

function image(width: number, height: number, colour = '#9A3412'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();
}

async function card(name: string): Promise<IdCardData> {
  return {
    school_name: 'Tamilzorous Model School',
    school_code: 'TZMS',
    school_city: 'Coimbatore',
    school_phone: null,
    school_logo: null,
    academic_year: '2026-27',
    name,
    admission_no: 'TZMS-2026-0001',
    class_section: '6 - A',
    roll_no: 7,
    dob: '2014-06-14',
    blood_group: 'B+',
    guardian_name: 'Narayanan R',
    guardian_mobile: '9876543210',
    address: '12, Gandhi Street, Coimbatore',
    photo: await image(300, 400, '#64748B'),
    qr: await image(200, 200, '#000000'),
  };
}

const layout = normalizeIdCardLayout({
  front: [
    { key: 'photo', x: 0.15, y: 0.27, w: 0.21, h: 0.43 },
    { key: 'student_name', x: 0.66, y: 0.42, w: 0.3, h: 0.07, font_size: 9, bold: true, color: '#5b3a36' },
    { key: 'address', x: 0.66, y: 0.69, w: 0.3, h: 0.1, font_size: 30 },
    { key: 'student_name', x: 0, y: 0, w: 0.1, h: 0.1 },
  ],
  back: [{ key: 'qr', x: 0.4, y: 0.3, w: 0.2, h: 0.3 }],
});

describe('uploaded ID card design', () => {
  it('keeps each detail once and clamps positions', () => {
    expect(layout.front.map((item) => item.key)).toEqual(['photo', 'student_name', 'address']);
    expect(layout.front[1].color).toBe('#5B3A36');
    expect(() => normalizeIdCardLayout({ front: [{ key: 'password' }] })).toThrow();
    expect(() => normalizeIdCardLayout({ front: [{ key: 'dob', color: 'red' }] })).toThrow();
  });

  it('maps student details', async () => {
    const data = await card('Kavin');
    expect(idCardValue('roll_no', data)).toBe('07');
    expect(idCardValue('dob', data)).toBe('14-06-2014');
  });

  it('prints each student on the design', async () => {
    const design = { front: await image(1712, 1080), back: await image(1712, 1080), layout };
    const single = await uploadedIdCardPdf(design, await card('Kavin Narayanan'));
    expect(single.subarray(0, 4).toString()).toBe('%PDF');
    const cards = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((name) => card(name)));
    const sheet = await uploadedIdCardSheetPdf(design, cards, 'Sheet');
    expect(sheet.subarray(0, 4).toString()).toBe('%PDF');
  });
});
