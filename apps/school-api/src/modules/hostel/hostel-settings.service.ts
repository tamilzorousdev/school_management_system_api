import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { HostelModulesDto, HostelSettingsDto, HostelSettingsInputDto } from './dto/hostel-setup.dto';
import { HostelSettings } from './entities/hostel.entity';
import {
  DEFAULT_TIMINGS,
  EnabledModules,
  HostelOptionalModule,
  HostelTimings,
  mergeEnabledModules,
  timingErrors,
} from './hostel.logic';

const MODULE_NAMES: Record<HostelOptionalModule, string> = {
  staff_duty: 'Staff attendance and duty',
  lockers: 'Student lockers',
  study_hall: 'Study halls',
  laundry: 'Laundry',
  medical: 'Medical and sick bay',
  mess: 'Mess',
};

@Injectable()
export class HostelSettingsService {
  constructor(@InjectRepository(HostelSettings) private readonly repo: Repository<HostelSettings>) {}

  async get(schoolId: number): Promise<HostelSettingsDto> {
    const row = await this.repo.findOneBy({ school_id: schoolId });
    return {
      enabled_modules: mergeEnabledModules(row?.enabled_modules),
      wake_up_time: row?.wake_up_time ?? DEFAULT_TIMINGS.wake_up_time,
      study_start_time: row?.study_start_time ?? DEFAULT_TIMINGS.study_start_time,
      study_end_time: row?.study_end_time ?? DEFAULT_TIMINGS.study_end_time,
      in_time: row?.in_time ?? DEFAULT_TIMINGS.in_time,
      lights_out_time: row?.lights_out_time ?? DEFAULT_TIMINGS.lights_out_time,
      outing_from_time: row?.outing_from_time ?? DEFAULT_TIMINGS.outing_from_time,
      outing_until_time: row?.outing_until_time ?? DEFAULT_TIMINGS.outing_until_time,
      parent_consent_for_leave: row?.parent_consent_for_leave ?? true,
      holiday_mode: row?.holiday_mode ?? false,
      rules: row?.rules ?? null,
    };
  }

  async modules(schoolId: number): Promise<HostelModulesDto> {
    const settings = await this.get(schoolId);
    return { enabled_modules: settings.enabled_modules, holiday_mode: settings.holiday_mode };
  }

  async enabledModules(schoolId: number): Promise<EnabledModules> {
    return (await this.get(schoolId)).enabled_modules;
  }

  async ensureEnabled(schoolId: number, module: HostelOptionalModule): Promise<void> {
    const enabled = await this.enabledModules(schoolId);
    if (!enabled[module]) {
      throw AppException.forbidden(
        `${MODULE_NAMES[module]} is turned off for this hostel. Turn it on in hostel settings.`,
        'HOSTEL_MODULE_DISABLED',
      );
    }
  }

  async update(schoolId: number, dto: HostelSettingsInputDto, actor: AuthUser): Promise<HostelSettingsDto> {
    const current = await this.get(schoolId);
    const { enabled_modules: moduleChanges, ...rest } = dto;
    const changes = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
    const timings: HostelTimings = {
      wake_up_time: rest.wake_up_time ?? current.wake_up_time,
      study_start_time: rest.study_start_time ?? current.study_start_time,
      study_end_time: rest.study_end_time ?? current.study_end_time,
      in_time: rest.in_time ?? current.in_time,
      lights_out_time: rest.lights_out_time ?? current.lights_out_time,
      outing_from_time: rest.outing_from_time ?? current.outing_from_time,
      outing_until_time: rest.outing_until_time ?? current.outing_until_time,
    };
    const errors = timingErrors(timings);
    if (errors.length) throw AppException.validation(errors);
    const enabled = mergeEnabledModules({
      ...current.enabled_modules,
      ...Object.fromEntries(Object.entries(moduleChanges ?? {}).filter(([, value]) => value !== undefined)),
    });
    const row = (await this.repo.findOneBy({ school_id: schoolId })) ?? this.repo.create({ school_id: schoolId });
    Object.assign(row, changes, { enabled_modules: enabled, updated_by: actor.id });
    await this.repo.save(row);
    return this.get(schoolId);
  }
}
