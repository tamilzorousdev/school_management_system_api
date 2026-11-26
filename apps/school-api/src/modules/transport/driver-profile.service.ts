import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException, AuthUser } from '@app/common';
import { displayDate } from '../crew/crew.logic';
import { CrewService } from '../crew/crew.service';
import { FilesService } from '../files/files.service';
import { Staff } from '../staff/entities/staff.entity';
import { User } from '../users/entities/user.entity';
import { DriverProfileDto, UpdateDriverProfileDto } from './dto/driver-profile.dto';
import { Vehicle } from './entities/vehicle.entity';
import { VehicleDocumentsService } from './vehicle-documents.service';
import { VehiclesService } from './vehicles.service';

@Injectable()
export class DriverProfileService {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly crew: CrewService,
    private readonly fleet: VehiclesService,
    private readonly vehicleDocuments: VehicleDocumentsService,
    private readonly files: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async get(actor: AuthUser): Promise<DriverProfileDto> {
    const staff = await this.staffOf(actor);
    const me = await this.crew.get(staff.school_id, staff.id);
    const bus = await this.vehicles.findOne({
      where: [
        { school_id: staff.school_id, driver_user_id: actor.id },
        { school_id: staff.school_id, attendant_user_id: actor.id },
      ],
      order: { id: 'ASC' },
    });
    if (!bus) return { me, duty_message: dutyMessage(me), vehicle: null, vehicle_documents: [] };
    const [vehicle, documents] = await Promise.all([
      this.fleet.get(staff.school_id, bus.id),
      this.vehicleDocuments.list(staff.school_id, bus.id),
    ]);
    return {
      me,
      duty_message: dutyMessage(me),
      vehicle,
      vehicle_documents: documents.filter((document) => document.current),
    };
  }

  async update(actor: AuthUser, dto: UpdateDriverProfileDto): Promise<DriverProfileDto> {
    const staff = await this.staffOf(actor);
    if (dto.photo_file_id) {
      const file = await this.files.assertAttachable(dto.photo_file_id, staff.school_id, 'photo_file_id');
      if (!file.mime_type.startsWith('image/')) {
        throw AppException.validation([{ field: 'photo_file_id', message: 'The photo must be an image (PNG or JPG)' }]);
      }
    }
    const staffChanges = defined({
      address: dto.address,
      emergency_contact_name: dto.emergency_contact_name,
      emergency_contact_mobile: dto.emergency_contact_mobile,
    });
    const userChanges = defined({ email: dto.email, language: dto.language, photo_file_id: dto.photo_file_id });
    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(staffChanges).length) await manager.update(Staff, staff.id, staffChanges);
      if (Object.keys(userChanges).length) await manager.update(User, actor.id, userChanges);
    });
    return this.get(actor);
  }

  private async staffOf(actor: AuthUser): Promise<Staff> {
    if (!actor.school_id) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    const staff = await this.dataSource
      .getRepository(Staff)
      .findOneBy({ user_id: actor.id, school_id: actor.school_id });
    if (!staff) {
      throw AppException.notFound(
        'Your driver profile is not set up yet. Ask the transport office to add you in Drivers and attendants.',
        'CREW_NOT_FOUND',
      );
    }
    return staff;
  }
}

function defined<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function dutyMessage(me: {
  duty_status: string;
  allowed_today: { reason: string } | null;
  checks: { label: string; problem: string | null; expiry: { date: string | null } }[];
}): string | null {
  if (me.duty_status === 'approved') return null;
  if (me.allowed_today) return 'The office has allowed you on duty for today only.';
  const failing = me.checks.filter((check) => check.problem);
  if (!failing.length) return 'Waiting for the transport office to approve you for duty.';
  const parts = failing.map((check) =>
    check.problem === 'Expired' && check.expiry.date
      ? `${check.label} expired on ${displayDate(check.expiry.date)}`
      : `${check.label}: ${check.problem}`,
  );
  const renew = failing.some((check) => check.problem === 'Expired');
  return `${parts.join('. ')}. ${renew ? 'Renew it and give a copy' : 'Give the documents'} to the transport office.`;
}
