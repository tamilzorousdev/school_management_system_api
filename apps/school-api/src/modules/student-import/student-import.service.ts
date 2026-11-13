import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { AppException } from '@app/common';
import { AcademicYear } from '../setup/entities/academic-year.entity';
import { SchoolClass } from '../setup/entities/school-class.entity';
import { Section } from '../setup/entities/section.entity';
import { CreateStudentDto } from '../students/dto/student-input.dto';
import { Relation } from '../students/entities/student-guardian.entity';
import { BLOOD_GROUPS, GENDERS } from '../students/entities/student.entity';
import { Invite, GuardiansService } from '../students/guardians.service';
import { StudentsService } from '../students/students.service';
import { ImportFieldErrorDto, ImportMode, ImportReportDto, ImportRowDto } from './dto/import.dto';
import { cellText, headerKey, IMPORT_COLUMNS, ImportRow, isBlankRow, normalizeDate } from './import-sheet';

const MAX_ROWS = 1000;
const GUARDIAN_SOURCES: { prefix: 'father' | 'mother' | 'guardian'; relation: Relation }[] = [
  { prefix: 'father', relation: 'father' },
  { prefix: 'mother', relation: 'mother' },
  { prefix: 'guardian', relation: 'guardian' },
];

interface Lookups {
  year: AcademicYear;
  classes: Map<string, SchoolClass>;
  sections: Map<string, Section>;
  sectionCounts: Map<number, number>;
  admissionNos: Set<string>;
  rolls: Set<string>;
}

interface PlannedRow {
  report: ImportRowDto;
  dto: CreateStudentDto | null;
}

export function flattenErrors(errors: ValidationError[], parent = ''): ImportFieldErrorDto[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field: path, message }));
    return [...own, ...flattenErrors(error.children ?? [], path)];
  });
}

export function columnFor(path: string, guardianColumns: string[]): string {
  const nested = /^guardians\.(\d+)\.(\w+)$/.exec(path);
  if (nested) return `${guardianColumns[Number(nested[1])] ?? 'guardian'}_${nested[2] === 'name' ? 'name' : 'mobile'}`;
  if (path === 'class_id') return 'class';
  if (path === 'section_id') return 'section';
  if (path === 'guardians') return 'father_mobile';
  return path;
}

export function headerOf(field: string): string {
  return IMPORT_COLUMNS.find((column) => column.key === field)?.header ?? field.replace(/_/g, ' ');
}

export function friendlyMessage(field: string, message: string, value: string): string {
  const header = headerOf(field);
  if (field === 'father_mobile' && message.startsWith('Add at least one')) {
    return 'Add at least one parent or guardian with a name and mobile';
  }
  if (!value) return `${header} is required`;
  return message.replace(/^\S+/, header);
}

export function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

@Injectable()
export class StudentImportService {
  constructor(
    private readonly students: StudentsService,
    private readonly guardians: GuardiansService,
    private readonly dataSource: DataSource,
  ) {}

  async template(schoolId: number): Promise<{ name: string; buffer: Buffer }> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy({ school_id: schoolId, is_current: true });
    const classes = await this.dataSource.getRepository(SchoolClass).find({
      where: { school_id: schoolId },
      order: { grade_level: 'ASC' },
    });
    const sections = year
      ? await this.dataSource.getRepository(Section).find({
          where: { school_id: schoolId, academic_year_id: year.id },
          order: { name: 'ASC' },
        })
      : [];

    const book = new ExcelJS.Workbook();
    book.creator = 'Tamilzorous School';
    const sheet = book.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = IMPORT_COLUMNS.map((column) => ({
      header: column.required ? `${column.header} *` : column.header,
      key: column.key,
      width: column.width,
    }));
    const header = sheet.getRow(1);
    header.height = 22;
    header.eachCell((cell, index) => {
      const column = IMPORT_COLUMNS[index - 1];
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column.required ? 'FF0D5C35' : 'FF159053' } };
      cell.alignment = { vertical: 'middle' };
      if (column.note) cell.note = column.note;
    });

    const list = (values: readonly string[]) => ({
      type: 'list' as const,
      allowBlank: true,
      formulae: [`"${values.join(',')}"`],
    });
    const columnLetter = (key: string) => sheet.getColumn(key).letter;
    for (let row = 2; row <= MAX_ROWS + 1; row += 1) {
      sheet.getCell(`${columnLetter('gender')}${row}`).dataValidation = list(GENDERS);
      sheet.getCell(`${columnLetter('blood_group')}${row}`).dataValidation = list(BLOOD_GROUPS);
      sheet.getCell(`${columnLetter('language')}${row}`).dataValidation = list(['en', 'ta']);
      if (classes.length) {
        sheet.getCell(`${columnLetter('class')}${row}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`Classes!$A$2:$A$${classes.length + 1}`],
        };
      }
      for (const key of ['dob', 'admission_date', 'father_mobile', 'mother_mobile', 'guardian_mobile', 'pincode']) {
        sheet.getCell(`${columnLetter(key)}${row}`).numFmt = '@';
      }
    }

    const reference = book.addWorksheet('Classes');
    reference.columns = [
      { header: 'Class', key: 'class', width: 10 },
      { header: `Sections ${year?.name ?? ''}`.trim(), key: 'sections', width: 30 },
    ];
    reference.getRow(1).font = { bold: true };
    for (const item of classes) {
      reference.addRow({
        class: item.name,
        sections: sections
          .filter((section) => section.class_id === item.id)
          .map((section) => section.name)
          .join(', '),
      });
    }

    const help = book.addWorksheet('How to fill');
    help.getColumn(1).width = 22;
    help.getColumn(2).width = 70;
    help.addRow(['Column', 'What to enter']).font = { bold: true };
    for (const column of IMPORT_COLUMNS) {
      help.addRow([`${column.header}${column.required ? ' *' : ''}`, column.note]);
    }
    help.addRow([]);
    help.addRow([
      'Tip',
      'Upload with mode "validate" first. Fix the rows in the report, then upload with mode "import".',
    ]);
    help.addRow(['Siblings', 'Use the same parent mobile for brothers and sisters. They are linked automatically.']);

    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    return { name: 'student-import-template.xlsx', buffer };
  }

  async run(
    schoolId: number,
    file: { buffer: Buffer; originalname: string } | undefined,
    mode: ImportMode,
    sendInvites: boolean,
  ): Promise<ImportReportDto> {
    if (!file?.buffer?.length) throw AppException.badRequest('Choose the filled Excel file', 'FILE_MISSING');
    const rows = await this.readRows(file.buffer);
    const lookups = await this.lookups(schoolId);
    const planned = await this.plan(rows, lookups);

    let created = 0;
    let failed = 0;
    const invites: (Invite | null)[] = [];
    if (mode === 'import') {
      for (const item of planned) {
        if (!item.dto) continue;
        try {
          const result = await this.dataSource.transaction((manager) =>
            this.students.createInTx(manager, schoolId, item.dto!),
          );
          item.report.status = 'created';
          item.report.admission_no = result.student.admission_no;
          invites.push(...result.invites);
          created += 1;
        } catch (error) {
          item.report.status = 'failed';
          item.report.errors = [{ field: 'row', message: (error as Error).message }];
          failed += 1;
        }
      }
      if (sendInvites) await this.guardians.sendInvites(invites);
    }

    const errorRows = planned.filter((item) => !item.dto).length;
    return {
      mode,
      total_rows: planned.length,
      valid_rows: planned.length - errorRows,
      error_rows: errorRows,
      created,
      failed,
      rows: planned.map((item) => item.report),
    };
  }

  private async readRows(buffer: Buffer): Promise<{ row: number; values: ImportRow }[]> {
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw AppException.badRequest('This is not an Excel file. Use the .xlsx template.', 'IMPORT_NOT_EXCEL');
    }
    const sheet = book.getWorksheet('Students') ?? book.worksheets[0];
    if (!sheet) throw AppException.badRequest('The file has no sheets', 'IMPORT_EMPTY');

    const keys = new Map<number, string>();
    sheet.getRow(1).eachCell((cell, column) => {
      const key = headerKey(cellText(cell.value));
      if (key) keys.set(column, key);
    });
    const missing = IMPORT_COLUMNS.filter((column) => column.required && ![...keys.values()].includes(column.key));
    if (missing.length) {
      throw AppException.badRequest(
        `Columns missing: ${missing.map((column) => column.header).join(', ')}. Download the template again.`,
        'IMPORT_COLUMNS_MISSING',
      );
    }

    const rows: { row: number; values: ImportRow }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      if (number === 1) return;
      const values: ImportRow = {};
      for (const [column, key] of keys) values[key] = cellText(row.getCell(column).value);
      if (!isBlankRow(values)) rows.push({ row: number, values });
    });
    if (!rows.length) throw AppException.badRequest('The sheet has no student rows', 'IMPORT_EMPTY');
    if (rows.length > MAX_ROWS) {
      throw AppException.badRequest(`Import up to ${MAX_ROWS} students at a time`, 'IMPORT_TOO_MANY_ROWS');
    }
    return rows;
  }

  private async lookups(schoolId: number): Promise<Lookups> {
    const year = await this.dataSource.getRepository(AcademicYear).findOneBy({ school_id: schoolId, is_current: true });
    if (!year) throw AppException.badRequest('Set the current academic year in School setup first', 'NO_CURRENT_YEAR');
    const [classes, sections, counts, numbers, rolls] = await Promise.all([
      this.dataSource.getRepository(SchoolClass).findBy({ school_id: schoolId }),
      this.dataSource.getRepository(Section).findBy({ school_id: schoolId, academic_year_id: year.id }),
      this.dataSource.query(
        `SELECT section_id, COUNT(*) AS count FROM student_enrollments
         WHERE academic_year_id = $1 AND section_id IS NOT NULL GROUP BY section_id`,
        [year.id],
      ) as Promise<{ section_id: number; count: string }[]>,
      this.dataSource.query(
        `SELECT LOWER(admission_no) AS value FROM students WHERE school_id = $1 AND deleted_at IS NULL`,
        [schoolId],
      ) as Promise<{ value: string }[]>,
      this.dataSource.query(
        `SELECT section_id, roll_no FROM student_enrollments
         WHERE academic_year_id = $1 AND section_id IS NOT NULL AND roll_no IS NOT NULL`,
        [year.id],
      ) as Promise<{ section_id: number; roll_no: number }[]>,
    ]);
    return {
      year,
      classes: new Map(classes.map((item) => [item.name.trim().toLowerCase(), item])),
      sections: new Map(sections.map((item) => [`${item.class_id}:${item.name.trim().toLowerCase()}`, item])),
      sectionCounts: new Map(counts.map((item) => [Number(item.section_id), Number(item.count)])),
      admissionNos: new Set(numbers.map((item) => item.value)),
      rolls: new Set(rolls.map((item) => `${item.section_id}:${item.roll_no}`)),
    };
  }

  private async plan(rows: { row: number; values: ImportRow }[], lookups: Lookups): Promise<PlannedRow[]> {
    const planned: PlannedRow[] = [];
    for (const { row, values } of rows) {
      const errors: ImportFieldErrorDto[] = [];
      const schoolClass = values.class ? lookups.classes.get(values.class.toLowerCase()) : undefined;
      if (values.class && !schoolClass)
        errors.push({ field: 'class', message: `Class "${values.class}" is not in School setup` });
      const section =
        schoolClass && values.section
          ? lookups.sections.get(`${schoolClass.id}:${values.section.toLowerCase()}`)
          : undefined;
      if (schoolClass && values.section && !section) {
        errors.push({
          field: 'section',
          message: `Class ${schoolClass.name} has no section "${values.section}" this year`,
        });
      }

      const guardianColumns: string[] = [];
      const guardians = GUARDIAN_SOURCES.filter(
        ({ prefix }) => values[`${prefix}_name`] || values[`${prefix}_mobile`],
      ).map(({ prefix, relation }, index) => {
        guardianColumns.push(prefix);
        return {
          name: values[`${prefix}_name`] ?? '',
          mobile: values[`${prefix}_mobile`] ?? '',
          relation,
          is_primary: index === 0,
          language: values.language === 'ta' ? 'ta' : 'en',
        };
      });

      const rollText = values.roll_no ?? '';
      const plain = {
        admission_no: values.admission_no || undefined,
        first_name: values.first_name ?? '',
        last_name: values.last_name || null,
        dob: normalizeDate(values.dob ?? ''),
        gender: (values.gender ?? '').toLowerCase(),
        blood_group: values.blood_group ? values.blood_group.toUpperCase().replace(/\s/g, '') : null,
        house: values.house || null,
        admission_date: values.admission_date ? normalizeDate(values.admission_date) : undefined,
        address_line: values.address_line || null,
        city: values.city || null,
        pincode: values.pincode || null,
        previous_school: values.previous_school || null,
        identification_marks: values.identification_marks || null,
        emis_number: values.emis_number || null,
        class_id: schoolClass?.id ?? 0,
        section_id: section?.id ?? null,
        roll_no: rollText ? Number(rollText) : null,
        guardians,
      };
      const dto = plainToInstance(CreateStudentDto, plain);
      const validation = flattenErrors(await validate(dto, { whitelist: true, forbidNonWhitelisted: true }));
      for (const error of validation) {
        const field = columnFor(error.field, guardianColumns);
        if (field === 'class' && !values.class) errors.push({ field, message: 'Class is required' });
        else if (field !== 'class' && field !== 'section') {
          errors.push({ field, message: friendlyMessage(field, error.message, values[field] ?? '') });
        }
      }
      for (const key of ['dob', 'admission_date'] as const) {
        const value = plain[key];
        if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isRealDate(value)) {
          errors.push({ field: key, message: `${headerOf(key)} ${values[key]} is not a real date` });
        }
      }
      if (values.language && !['en', 'ta'].includes(values.language)) {
        errors.push({ field: 'language', message: 'Parent language must be en or ta' });
      }

      const mobiles = guardians.map((guardian) => guardian.mobile).filter(Boolean);
      if (new Set(mobiles).size !== mobiles.length) {
        errors.push({ field: 'mother_mobile', message: 'Two parents have the same mobile number' });
      }
      const admissionKey = values.admission_no?.toLowerCase();
      if (admissionKey && lookups.admissionNos.has(admissionKey)) {
        errors.push({ field: 'admission_no', message: `Admission number ${values.admission_no} is already used` });
      }
      if (dto.roll_no && !section) errors.push({ field: 'roll_no', message: 'Give a section before the roll number' });
      const rollKey = section && dto.roll_no ? `${section.id}:${dto.roll_no}` : null;
      if (rollKey && lookups.rolls.has(rollKey)) {
        errors.push({
          field: 'roll_no',
          message: `Roll number ${dto.roll_no} is already used in ${values.class}-${values.section}`,
        });
      }
      if (section && (lookups.sectionCounts.get(section.id) ?? 0) >= section.capacity) {
        errors.push({
          field: 'section',
          message: `Section ${values.class}-${values.section} is full (${section.capacity})`,
        });
      }

      const valid = errors.length === 0;
      if (valid) {
        if (admissionKey) lookups.admissionNos.add(admissionKey);
        if (rollKey) lookups.rolls.add(rollKey);
        if (section) lookups.sectionCounts.set(section.id, (lookups.sectionCounts.get(section.id) ?? 0) + 1);
      }
      planned.push({
        dto: valid ? dto : null,
        report: {
          row,
          status: valid ? 'valid' : 'error',
          name: [values.first_name, values.last_name].filter(Boolean).join(' ') || '—',
          class_section: schoolClass
            ? [schoolClass.name, section?.name].filter(Boolean).join(' - ')
            : values.class || null,
          admission_no: values.admission_no || null,
          errors: errors.filter(
            (error, index) =>
              errors.findIndex((other) => other.field === error.field && other.message === error.message) === index,
          ),
        },
      });
    }
    return planned;
  }
}
