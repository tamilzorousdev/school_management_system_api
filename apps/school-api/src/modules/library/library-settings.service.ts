import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { libraryConfig, LibraryConfig } from '../../config/configuration';
import { LibrarySettingsDto, LibrarySettingsInputDto } from './dto/catalogue.dto';
import { LibrarySettings } from './entities/library-settings.entity';
import { DEFAULT_RULES, LoanRules } from './library.logic';

const DEFAULTS = {
  ...DEFAULT_RULES,
  opening_time: '08:00',
  closing_time: '16:30',
  isbn_lookup: true,
};

@Injectable()
export class LibrarySettingsService {
  constructor(
    @InjectRepository(LibrarySettings) private readonly repo: Repository<LibrarySettings>,
    @Inject(libraryConfig.KEY) private readonly config: LibraryConfig,
  ) {}

  async get(schoolId: number): Promise<LibrarySettingsDto> {
    const row = await this.repo.findOneBy({ school_id: schoolId });
    return {
      student_loan_days: row?.student_loan_days ?? DEFAULTS.student_loan_days,
      staff_loan_days: row?.staff_loan_days ?? DEFAULTS.staff_loan_days,
      student_max_books: row?.student_max_books ?? DEFAULTS.student_max_books,
      staff_max_books: row?.staff_max_books ?? DEFAULTS.staff_max_books,
      fine_per_day: row ? Number(row.fine_per_day) : DEFAULTS.fine_per_day,
      grace_days: row?.grace_days ?? DEFAULTS.grace_days,
      max_fine_per_book: row
        ? row.max_fine_per_book === null
          ? null
          : Number(row.max_fine_per_book)
        : DEFAULTS.max_fine_per_book,
      lost_processing_fee: row ? Number(row.lost_processing_fee) : DEFAULTS.lost_processing_fee,
      max_renewals: row?.max_renewals ?? DEFAULTS.max_renewals,
      block_issue_above_fine: row ? Number(row.block_issue_above_fine) : DEFAULTS.block_issue_above_fine,
      skip_holidays: row?.skip_holidays ?? DEFAULTS.skip_holidays,
      charge_staff_fines: row?.charge_staff_fines ?? DEFAULTS.charge_staff_fines,
      due_soon_days: row?.due_soon_days ?? DEFAULTS.due_soon_days,
      escalate_after_days: row?.escalate_after_days ?? DEFAULTS.escalate_after_days,
      long_overdue_days: row?.long_overdue_days ?? DEFAULTS.long_overdue_days,
      opening_time: row?.opening_time ?? DEFAULTS.opening_time,
      closing_time: row?.closing_time ?? DEFAULTS.closing_time,
      isbn_lookup: row?.isbn_lookup ?? DEFAULTS.isbn_lookup,
      isbn_lookup_available: Boolean(this.config.bookLookupUrl),
    };
  }

  async rules(schoolId: number): Promise<LoanRules> {
    return this.get(schoolId);
  }

  async update(schoolId: number, dto: LibrarySettingsInputDto, actor: AuthUser): Promise<LibrarySettingsDto> {
    const current = await this.get(schoolId);
    const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
    const next = { ...current, ...changes };
    if (next.long_overdue_days <= next.escalate_after_days) {
      throw AppException.validation([
        { field: 'long_overdue_days', message: 'Must be more than the days before the class teacher is told' },
      ]);
    }
    if (next.closing_time <= next.opening_time) {
      throw AppException.validation([{ field: 'closing_time', message: 'Closing time must be after opening time' }]);
    }
    const row = (await this.repo.findOneBy({ school_id: schoolId })) ?? this.repo.create({ school_id: schoolId });
    Object.assign(row, changes, { updated_by: actor.id });
    await this.repo.save(row);
    return this.get(schoolId);
  }
}
