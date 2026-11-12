import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import QRCode from 'qrcode';
import { StudentExitDto } from './dto/lifecycle.dto';
import { idCardPdf, idCardSheetPdf } from './pdf/id-card.pdf';
import { displayDate, initials } from './pdf/pdf-kit';
import { tcPdf } from './pdf/tc.pdf';
import { classSection, fullName } from './student-lifecycle.service';

const card = async () => ({
  school_name: 'Tamilzorous Model School',
  school_code: 'TZMS',
  school_city: 'Chennai',
  school_phone: '04426201234',
  school_logo: null,
  academic_year: '2026-27',
  name: 'Kavin Narayanan',
  admission_no: 'TZMS-2021-0001',
  class_section: '6 - A',
  roll_no: 10,
  dob: '2015-04-12',
  blood_group: 'B+',
  guardian_name: 'Lakshmi',
  guardian_mobile: '9000000005',
  photo: null,
  qr: await QRCode.toBuffer('TZS1.1.1.abc', { width: 120 }),
});

describe('names and labels', () => {
  it('joins names and class sections', () => {
    expect(fullName({ first_name: 'Kavin', last_name: 'Narayanan' })).toBe('Kavin Narayanan');
    expect(fullName({ first_name: 'Kavin', last_name: null })).toBe('Kavin');
    expect(classSection('6', 'A')).toBe('6 - A');
    expect(classSection('LKG', null)).toBe('LKG');
    expect(classSection(null, 'A')).toBeNull();
    expect(initials('Kavin Narayanan')).toBe('KN');
    expect(displayDate('2015-04-12')).toBe('12-04-2015');
    expect(displayDate(null)).toBe('—');
  });
});

describe('PDFs', () => {
  jest.setTimeout(30000);

  it('draws one ID card and a sheet of cards', async () => {
    for (const design of ['design1', 'design2', 'design3']) {
      const one = await idCardPdf(await card(), design);
      expect(one.subarray(0, 5).toString()).toBe('%PDF-');
      const sheet = await idCardSheetPdf(await Promise.all(Array.from({ length: 12 }, card)), 'ID cards', design);
      expect(sheet.subarray(0, 5).toString()).toBe('%PDF-');
      const expectedPages = design === 'design1' ? 3 : 4;
      expect((sheet.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(expectedPages);
    }
  });

  it('draws a transfer certificate', async () => {
    const pdf = await tcPdf({
      school_name: 'Tamilzorous Model School',
      school_address: 'Anna Nagar, Chennai',
      school_phone: null,
      school_email: null,
      school_board: 'CBSE',
      school_logo: null,
      tc_no: 'TZMS-TC-2026-0001',
      issued_on: '2026-11-02',
      student_name: 'Bharath Kumar',
      admission_no: 'TZMS-2025-0001',
      gender: 'male',
      dob: '2014-02-02',
      identification_marks: 'A mole on the left cheek',
      guardian_name: null,
      admission_date: '2025-06-02',
      class_name: '6',
      section_name: 'A',
      academic_year: '2026-27',
      promotion_eligible: true,
      leaving_date: '2026-11-02',
      reason: 'Family moved to Coimbatore',
      conduct: 'Good',
      remarks: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('leaving the school', () => {
  const errors = async (plain: object) =>
    (await validate(plainToInstance(StudentExitDto, plain), { whitelist: true, forbidNonWhitelisted: true })).map(
      (error) => error.property,
    );

  it('needs a type, a leaving date and a reason', async () => {
    expect(await errors({ exit_type: 'transferred', leaving_date: '2026-11-02', reason: 'Family moved' })).toEqual([]);
    expect(await errors({ exit_type: 'expelled', leaving_date: '2026-11-02', reason: 'Family moved' })).toEqual([
      'exit_type',
    ]);
    expect(await errors({ exit_type: 'withdrawn', leaving_date: '02-11-2026', reason: 'Family moved' })).toEqual([
      'leaving_date',
    ]);
    expect(await errors({ exit_type: 'withdrawn', leaving_date: '2026-11-02', reason: '' })).toEqual(['reason']);
  });
});
