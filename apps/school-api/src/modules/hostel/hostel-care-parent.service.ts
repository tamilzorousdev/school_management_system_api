import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser, ListQueryDto, Paginated } from '@app/common';
import {
  HealthLogDto,
  HealthLogQueryDto,
  MedicationDto,
  MedicationQueryDto,
  MessDayDto,
  MessFeedbackDto,
  MessSkipDto,
  MessSkipQueryDto,
  MessWeekDto,
  ParentLaundryDto,
  ParentMedicationQueryDto,
  ParentMessFeedbackInputDto,
  ParentMessSkipInputDto,
  ParentMessSkipQueryDto,
} from './dto/hostel-care.dto';
import { HostelHealthService } from './hostel-health.service';
import { HostelLaundryService } from './hostel-laundry.service';
import { HostelMessService } from './hostel-mess.service';
import { HostelParentService } from './hostel-parent.service';
import { HostelSettingsService } from './hostel-settings.service';
import { HostelOptionalModule } from './hostel.logic';

interface CareStay {
  school_id: number;
  admission_id: number;
  hostel_id: number;
}

@Injectable()
export class HostelCareParentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly parent: HostelParentService,
    private readonly settings: HostelSettingsService,
    private readonly mess: HostelMessService,
    private readonly health: HostelHealthService,
    private readonly laundry: HostelLaundryService,
  ) {}

  async menu(user: AuthUser, studentId: number): Promise<MessWeekDto> {
    const stay = await this.stay(user, studentId, 'mess');
    return this.mess.week(stay.school_id, stay.hostel_id);
  }

  async day(user: AuthUser, studentId: number, date: string | undefined): Promise<MessDayDto> {
    const stay = await this.stay(user, studentId, 'mess');
    return this.mess.day(stay.school_id, date, stay.hostel_id);
  }

  async skips(user: AuthUser, studentId: number, query: ParentMessSkipQueryDto): Promise<Paginated<MessSkipDto>> {
    const stay = await this.stay(user, studentId, 'mess');
    return this.mess.skips(
      stay.school_id,
      Object.assign(new MessSkipQueryDto(), query, { admission_id: stay.admission_id }),
    );
  }

  async addSkip(user: AuthUser, studentId: number, dto: ParentMessSkipInputDto): Promise<MessSkipDto> {
    const stay = await this.stay(user, studentId, 'mess');
    return this.mess.createSkip(stay.school_id, stay.admission_id, dto, 'parent', user);
  }

  async cancelSkip(user: AuthUser, studentId: number, skipId: number): Promise<MessSkipDto> {
    const stay = await this.stay(user, studentId, 'mess');
    return this.mess.cancelSkip(stay.school_id, skipId, user, stay.admission_id);
  }

  async feedback(user: AuthUser, studentId: number, dto: ParentMessFeedbackInputDto): Promise<MessFeedbackDto> {
    const stay = await this.stay(user, studentId, 'mess');
    return this.mess.addFeedback(stay.school_id, stay.hostel_id, stay.admission_id, dto, user);
  }

  async healthLogs(user: AuthUser, studentId: number, query: ListQueryDto): Promise<Paginated<HealthLogDto>> {
    const stay = await this.stay(user, studentId, 'medical');
    return this.health.logs(
      stay.school_id,
      Object.assign(new HealthLogQueryDto(), query, { admission_id: stay.admission_id }),
    );
  }

  async medications(
    user: AuthUser,
    studentId: number,
    query: ParentMedicationQueryDto,
  ): Promise<Paginated<MedicationDto>> {
    const stay = await this.stay(user, studentId, 'medical');
    return this.health.medications(
      stay.school_id,
      Object.assign(new MedicationQueryDto(), query, { admission_id: stay.admission_id }),
    );
  }

  async laundryItems(user: AuthUser, studentId: number, query: ListQueryDto): Promise<Paginated<ParentLaundryDto>> {
    const stay = await this.stay(user, studentId, 'laundry');
    return this.laundry.residentItems(stay.school_id, stay.admission_id, query);
  }

  private async stay(user: AuthUser, studentId: number, module: HostelOptionalModule): Promise<CareStay> {
    const stay = await this.parent.resident(user, studentId);
    await this.settings.ensureEnabled(stay.school_id, module);
    const [row] = await this.dataSource.query(`SELECT hostel_id FROM hostel_admissions WHERE id = $1`, [
      stay.admission_id,
    ]);
    return { ...stay, hostel_id: Number(row.hostel_id) };
  }
}
