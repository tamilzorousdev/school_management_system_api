import type { CellValue } from 'exceljs';

export interface ImportColumn {
  key: string;
  header: string;
  width: number;
  required?: boolean;
  note: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'admission_no', header: 'Admission no', width: 16, note: 'Leave empty to generate a new number' },
  { key: 'emis_number', header: 'EMIS number', width: 16, note: 'Optional EMIS ID' },
  { key: 'first_name', header: 'First name', width: 16, required: true, note: 'Student first name' },
  { key: 'last_name', header: 'Last name', width: 16, note: 'Initial or family name' },
  { key: 'dob', header: 'Date of birth', width: 14, required: true, note: 'YYYY-MM-DD or DD-MM-YYYY' },
  { key: 'gender', header: 'Gender', width: 10, required: true, note: 'male, female or other' },
  { key: 'blood_group', header: 'Blood group', width: 11, note: 'A+, A-, B+, B-, AB+, AB-, O+ or O-' },
  {
    key: 'class',
    header: 'Class',
    width: 9,
    required: true,
    note: 'Class name as in School setup, for example LKG, 1, 10',
  },
  { key: 'section', header: 'Section', width: 9, note: 'Section name this year, for example A' },
  { key: 'roll_no', header: 'Roll no', width: 9, note: 'Needs a section' },
  { key: 'house', header: 'House', width: 10, note: 'Optional' },
  { key: 'admission_date', header: 'Admission date', width: 14, note: 'Defaults to today' },
  { key: 'address_line', header: 'Address', width: 28, note: 'Door number and street' },
  { key: 'city', header: 'City', width: 12, note: '' },
  { key: 'pincode', header: 'Pincode', width: 9, note: '6 digits' },
  { key: 'previous_school', header: 'Previous school', width: 20, note: '' },
  { key: 'identification_marks', header: 'Identification marks', width: 24, note: 'Birth marks, moles or scars' },
  { key: 'father_name', header: 'Father name', width: 18, note: 'At least one parent or guardian with a mobile' },
  { key: 'father_mobile', header: 'Father mobile', width: 13, note: '10 digits' },
  { key: 'mother_name', header: 'Mother name', width: 18, note: '' },
  { key: 'mother_mobile', header: 'Mother mobile', width: 13, note: '10 digits' },
  { key: 'guardian_name', header: 'Guardian name', width: 18, note: 'Use when the student lives with a guardian' },
  { key: 'guardian_mobile', header: 'Guardian mobile', width: 13, note: '10 digits' },
  { key: 'language', header: 'Parent language', width: 12, note: 'en or ta. Messages to the parents use it.' },
];

export type ImportRow = Record<string, string>;

export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value.trim();
  if ('richText' in value)
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  if ('text' in value && typeof value.text === 'string') return value.text.trim();
  if ('result' in value) return cellText(value.result as CellValue);
  return '';
}

export function normalizeDate(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const indian = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (indian) return `${indian[3]}-${indian[2].padStart(2, '0')}-${indian[1].padStart(2, '0')}`;
  return text;
}

export function headerKey(header: string): string | null {
  const wanted = header
    .trim()
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const column = IMPORT_COLUMNS.find(
    (item) => item.key === wanted || item.header.toLowerCase().replace(/[^a-z0-9]+/g, '_') === wanted,
  );
  return column?.key ?? null;
}

export function isBlankRow(row: ImportRow): boolean {
  return Object.values(row).every((value) => !value);
}
