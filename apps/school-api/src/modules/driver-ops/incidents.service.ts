import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, AuthUser, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { monthStartIn, todayIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { TripsService } from '../tracking/trips.service';
import { Vehicle } from '../transport/entities/vehicle.entity';
import {
  BreakdownInputDto,
  IncidentDto,
  IncidentInputDto,
  IncidentInsightsDto,
  IncidentQueryDto,
} from './dto/driver-ops.dto';
import { IncidentType, TransportIncident } from './entities/driver-ops.entity';

const TYPE_LABELS: Record<IncidentType, string> = {
  breakdown: 'Breakdown',
  accident: 'Accident',
  injury: 'Injury',
  medical: 'Medical',
  misbehaviour: 'Misbehaviour',
  fight: 'Fight',
  other: 'Incident',
};

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger('TransportIncidents');

  constructor(
    @InjectRepository(TransportIncident) private readonly incidents: Repository<TransportIncident>,
    private readonly trips: TripsService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async report(user: AuthUser, dto: IncidentInputDto): Promise<IncidentDto> {
    const vehicle = await this.trips.crewVehicle(user);
    if (!vehicle) throw AppException.forbidden('You are not the driver or attendant of any bus', 'NO_BUS');
    if (dto.trip_id !== undefined) {
      const trip = await this.trips.find(vehicle.school_id, dto.trip_id);
      if (trip.vehicle_id !== vehicle.id) throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    }
    const incident = await this.create(vehicle, user, {
      type: dto.type,
      description: dto.description,
      trip_id: dto.trip_id ?? null,
      student_ids: dto.student_ids ?? [],
      photo_file_ids: dto.photo_file_ids ?? [],
      lat: dto.lat,
      lng: dto.lng,
    });
    return (await this.present([incident]))[0]!;
  }

  async breakdown(user: AuthUser, tripId: number, dto: BreakdownInputDto): Promise<IncidentDto> {
    const vehicle = await this.trips.crewVehicle(user);
    if (!vehicle) throw AppException.forbidden('You are not the driver or attendant of any bus', 'NO_BUS');
    const trip = await this.trips.find(vehicle.school_id, tripId);
    if (trip.vehicle_id !== vehicle.id) throw AppException.forbidden('This trip is not on your bus', 'NOT_YOUR_TRIP');
    if (trip.status !== 'active') throw AppException.conflict('This trip has ended', 'TRIP_ENDED');
    const incident = await this.create(vehicle, user, {
      type: 'breakdown',
      description: dto.note?.trim() || 'Bus broke down on the road',
      trip_id: trip.id,
      student_ids: [],
      photo_file_ids: dto.photo_file_ids ?? [],
      lat: dto.lat ?? trip.last_position?.lat,
      lng: dto.lng ?? trip.last_position?.lng,
    });
    return (await this.present([incident]))[0]!;
  }

  async mine(user: AuthUser): Promise<IncidentDto[]> {
    const rows = await this.incidents.find({
      where: { reported_by: user.id },
      order: { occurred_at: 'DESC' },
      take: 50,
    });
    return this.present(rows);
  }

  async list(schoolId: number, query: IncidentQueryDto): Promise<Paginated<IncidentDto>> {
    const qb = this.incidents.createQueryBuilder('i').where('i.school_id = :schoolId', { schoolId });
    if (query.status) qb.andWhere('i.status = :status', { status: query.status });
    if (query.type) qb.andWhere('i.type = :type', { type: query.type });
    if (query.vehicle_id) qb.andWhere('i.vehicle_id = :vehicle', { vehicle: query.vehicle_id });
    const page = await listQuery(qb, query, {
      searchable: ['i.description'],
      sortable: { occurred_at: 'i.occurred_at', created_at: 'i.created_at' },
      defaultSort: 'occurred_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async detail(schoolId: number, id: number): Promise<IncidentDto> {
    return (await this.present([await this.find(schoolId, id)]))[0]!;
  }

  async insights(schoolId: number): Promise<IncidentInsightsDto> {
    const today = todayIn(this.app.timeZone);
    const monthStart = monthStartIn(this.app.timeZone);
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'open') AS open,
              COUNT(*) FILTER (WHERE (occurred_at AT TIME ZONE $2)::date = $3::date) AS today,
              COUNT(*) FILTER (WHERE (occurred_at AT TIME ZONE $2)::date >= $4::date) AS this_month,
              COUNT(*) FILTER (WHERE type = 'breakdown' AND (occurred_at AT TIME ZONE $2)::date >= $4::date) AS breakdowns
       FROM transport_incidents WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId, this.app.timeZone, today, monthStart],
    );
    return {
      open: Number(row?.open ?? 0),
      today: Number(row?.today ?? 0),
      this_month: Number(row?.this_month ?? 0),
      breakdowns: Number(row?.breakdowns ?? 0),
    };
  }

  async resolve(schoolId: number, id: number, note: string, actor: AuthUser): Promise<IncidentDto> {
    const incident = await this.find(schoolId, id);
    if (incident.status === 'resolved') {
      throw AppException.conflict('This incident is already resolved', 'INCIDENT_RESOLVED');
    }
    await this.incidents.update(incident.id, {
      status: 'resolved',
      resolved_by: actor.id,
      resolved_at: new Date(),
      resolution_note: note,
    });
    const vehicle = incident.vehicle_id
      ? await this.dataSource.getRepository(Vehicle).findOneBy({ id: incident.vehicle_id })
      : null;
    await this.notifications
      .dispatch({
        template: TEMPLATES.TRANSPORT_INCIDENT_RESOLVED,
        audience: { user_ids: [incident.reported_by] },
        data: {
          type: TYPE_LABELS[incident.type],
          bus: vehicle ? `${vehicle.name} (${vehicle.registration_no})` : 'your bus',
          note,
          incident_id: String(incident.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`Incident ${incident.id} resolved notice failed: ${error.message}`));
    return this.detail(schoolId, id);
  }

  private async create(
    vehicle: Vehicle,
    user: AuthUser,
    input: {
      type: IncidentType;
      description: string;
      trip_id: number | null;
      student_ids: number[];
      photo_file_ids: number[];
      lat?: number;
      lng?: number;
    },
  ): Promise<TransportIncident> {
    const studentIds = [...new Set(input.student_ids)];
    if (studentIds.length) {
      const found: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM students WHERE id = ANY($1) AND school_id = $2 AND deleted_at IS NULL`,
        [studentIds, vehicle.school_id],
      );
      if (found.length !== studentIds.length) {
        throw AppException.validation([{ field: 'student_ids', message: 'Pick students of this school' }]);
      }
    }
    const photoIds = [...new Set(input.photo_file_ids)];
    if (photoIds.length) {
      const found: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM files WHERE id = ANY($1) AND school_id = $2`,
        [photoIds, vehicle.school_id],
      );
      if (found.length !== photoIds.length) {
        throw AppException.validation([{ field: 'photo_file_ids', message: 'Upload the photos first' }]);
      }
    }
    const incident = await this.incidents.save(
      this.incidents.create({
        school_id: vehicle.school_id,
        vehicle_id: vehicle.id,
        trip_id: input.trip_id,
        reported_by: user.id,
        type: input.type,
        description: input.description,
        student_ids: studentIds,
        photo_file_ids: photoIds,
        lat: typeof input.lat === 'number' ? String(input.lat) : null,
        lng: typeof input.lng === 'number' ? String(input.lng) : null,
        occurred_at: new Date(),
        status: 'open',
        created_by: user.id,
      }),
    );
    await this.notifications
      .dispatch({
        template: input.type === 'breakdown' ? TEMPLATES.TRANSPORT_BREAKDOWN : TEMPLATES.TRANSPORT_INCIDENT_REPORTED,
        audience: { roles: [ROLES.ADMIN, ROLES.TRANSPORT_INCHARGE, ROLES.PRINCIPAL], school_id: vehicle.school_id },
        data: {
          type: TYPE_LABELS[input.type],
          bus: `${vehicle.name} (${vehicle.registration_no})`,
          by: user.name,
          note: input.description.length > 140 ? `${input.description.slice(0, 137)}...` : input.description,
          incident_id: String(incident.id),
        },
      })
      .catch((error: Error) => this.logger.warn(`Incident ${incident.id} notice failed: ${error.message}`));
    return incident;
  }

  private async find(schoolId: number, id: number): Promise<TransportIncident> {
    const incident = await this.incidents.findOneBy({ id, school_id: schoolId });
    if (!incident) throw AppException.notFound('Incident not found', 'INCIDENT_NOT_FOUND');
    return incident;
  }

  private async present(rows: TransportIncident[]): Promise<IncidentDto[]> {
    if (!rows.length) return [];
    const userIds = [...new Set(rows.flatMap((row) => [row.reported_by, row.resolved_by]).filter(Boolean))];
    const studentIds = [...new Set(rows.flatMap((row) => row.student_ids))];
    const vehicleIds = [...new Set(rows.map((row) => row.vehicle_id).filter((id): id is number => Boolean(id)))];
    const [users, students, vehicles, files] = await Promise.all([
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [userIds]) as Promise<
        { id: number; name: string }[]
      >,
      studentIds.length
        ? (this.dataSource.query(
            `SELECT id, concat_ws(' ', first_name, last_name) AS name FROM students WHERE id = ANY($1)`,
            [studentIds],
          ) as Promise<{ id: number; name: string }[]>)
        : Promise.resolve([]),
      vehicleIds.length ? this.dataSource.getRepository(Vehicle).findBy({ id: In(vehicleIds) }) : Promise.resolve([]),
      this.files.presentMany(rows.flatMap((row) => row.photo_file_ids)),
    ]);
    const userName = new Map(users.map((row) => [Number(row.id), row.name]));
    const studentName = new Map(students.map((row) => [Number(row.id), row.name]));
    return rows.map((row) => {
      const vehicle = vehicles.find((item) => item.id === row.vehicle_id);
      return {
        id: row.id,
        type: row.type,
        description: row.description,
        status: row.status,
        vehicle: vehicle ? { id: vehicle.id, name: `${vehicle.name} (${vehicle.registration_no})` } : null,
        trip_id: row.trip_id,
        reported_by: { id: row.reported_by, name: userName.get(row.reported_by) ?? '' },
        students: row.student_ids.map((id) => ({ id, name: studentName.get(id) ?? '' })),
        photos: row.photo_file_ids
          .map((id) => files.get(id))
          .filter((file): file is NonNullable<typeof file> => Boolean(file))
          .map((file) => ({ id: file.id, url: file.url })),
        lat: row.lat === null ? null : Number(row.lat),
        lng: row.lng === null ? null : Number(row.lng),
        occurred_at: row.occurred_at,
        resolved_by: row.resolved_by ? { id: row.resolved_by, name: userName.get(row.resolved_by) ?? '' } : null,
        resolved_at: row.resolved_at,
        resolution_note: row.resolution_note,
      };
    });
  }
}
