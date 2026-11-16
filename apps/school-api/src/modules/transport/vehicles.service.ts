import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig, transportConfig, TransportConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { CREW_CHECKS, displayDate } from '../crew/crew.logic';
import { CrewService } from '../crew/crew.service';
import { readOverrides } from '../crew/overrides';
import { TelematicsClient } from '../fleet/telematics.client';
import { NotificationsService } from '../notifications/notifications.service';
import { Staff } from '../staff/entities/staff.entity';
import {
  DeviceOptionDto,
  DriverDto,
  ExpiryDto,
  ExpiryRunDto,
  LicenceInputDto,
  PersonContactDto,
  UpdateVehicleDto,
  VehicleDto,
  VehicleFlag,
  VehicleInputDto,
  VehicleInsightsDto,
  VehicleQueryDto,
} from './dto/transport.dto';
import { AlertKind, ExpiryAlert, ExpiryKind, VEHICLE_EXPIRY_KINDS } from './entities/expiry-alert.entity';
import { TransportRoute } from './entities/transport-route.entity';
import { VEHICLE_EXPIRY_FIELDS } from './entities/vehicle-document.entity';
import { Vehicle } from './entities/vehicle.entity';
import {
  alertThreshold,
  daysBetween,
  DUE_SOON_DAYS,
  EXPIRY_LABELS,
  expiryState,
  NEARLY_FULL_PERCENT,
  occupancy,
  ROAD_KINDS,
  roadBlockers,
  selfAlertThreshold,
  sendsSms,
} from './transport.logic';

const VEHICLE_DOCUMENTS: [ExpiryKind, keyof Vehicle][] = VEHICLE_EXPIRY_KINDS.map((kind) => [
  kind,
  VEHICLE_EXPIRY_FIELDS[kind] as keyof Vehicle,
]);

const STUDENTS_SQL = `(SELECT COUNT(*) FROM student_transport t JOIN transport_routes r ON r.id = t.route_id
  WHERE r.vehicle_id = v.id AND r.deleted_at IS NULL AND t.deleted_at IS NULL)`;

const anyExpiry = (kinds: readonly ExpiryKind[], condition: (column: string) => string) =>
  `(${kinds.map((kind) => condition(`v.${VEHICLE_EXPIRY_FIELDS[kind as keyof typeof VEHICLE_EXPIRY_FIELDS]}`)).join(' OR ')})`;

const FLAG_SQL: Record<VehicleFlag, string> = {
  not_road_worthy: anyExpiry(ROAD_KINDS, (column) => `${column} < CAST(:today AS date)`),
  expired: anyExpiry(VEHICLE_EXPIRY_KINDS, (column) => `${column} < CAST(:today AS date)`),
  due_soon: anyExpiry(
    VEHICLE_EXPIRY_KINDS,
    (column) => `${column} BETWEEN CAST(:today AS date) AND CAST(:today AS date) + ${DUE_SOON_DAYS}`,
  ),
  nearly_full: `${STUDENTS_SQL} * 100 >= v.capacity * ${NEARLY_FULL_PERCENT}`,
  contractor: `v.ownership = 'contractor'`,
};

type DueDocument = ExpiryDto & {
  school_id: number;
  user_id: number | null;
  approved: boolean;
  driver_user_id: number | null;
};

interface TelematicsDevice {
  id: number;
  imei: string;
  name: string;
  vehicle_no: string | null;
  last_seen_at: Date | null;
}

function whenText(daysLeft: number, date: string): string {
  if (daysLeft < 0) return `expired on ${date}`;
  if (daysLeft === 0) return 'ends today';
  return `ends on ${date} (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left)`;
}

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger('Transport');

  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(TransportRoute) private readonly routes: Repository<TransportRoute>,
    @InjectRepository(ExpiryAlert) private readonly alerts: Repository<ExpiryAlert>,
    private readonly telematics: TelematicsClient,
    private readonly notifications: NotificationsService,
    private readonly crew: CrewService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @Inject(transportConfig.KEY) private readonly transport: TransportConfig,
  ) {}

  async list(schoolId: number, query: VehicleQueryDto): Promise<Paginated<VehicleDto>> {
    const qb = this.vehicles
      .createQueryBuilder('v')
      .where('v.school_id = :schoolId', { schoolId })
      .setParameter('today', todayIn(this.app.timeZone));
    if (query.status) qb.andWhere('v.status = :status', { status: query.status });
    if (query.vehicle_type) qb.andWhere('v.vehicle_type = :type', { type: query.vehicle_type });
    if (query.flag) qb.andWhere(FLAG_SQL[query.flag]);
    const page = await listQuery(qb, query, {
      searchable: ['v.registration_no', 'v.name', 'v.make_model'],
      sortable: { name: 'v.name', registration_no: 'v.registration_no', created_at: 'v.created_at' },
      defaultSort: 'name',
    });
    return { ...page, items: await this.present(schoolId, page.items) };
  }

  async insights(schoolId: number): Promise<VehicleInsightsDto> {
    const count = (flag?: VehicleFlag) => {
      const qb = this.vehicles
        .createQueryBuilder('v')
        .where(`v.school_id = :schoolId AND v.status = 'active'`, { schoolId })
        .setParameter('today', todayIn(this.app.timeZone));
      if (flag) qb.andWhere(FLAG_SQL[flag]);
      return qb.getCount();
    };
    const [total, notRoadWorthy, expired, dueSoon, nearlyFull, contractor] = await Promise.all([
      count(),
      count('not_road_worthy'),
      count('expired'),
      count('due_soon'),
      count('nearly_full'),
      count('contractor'),
    ]);
    return {
      total,
      not_road_worthy: notRoadWorthy,
      expired,
      due_soon: dueSoon,
      nearly_full: nearlyFull,
      contractor,
    };
  }

  async get(schoolId: number, id: number): Promise<VehicleDto> {
    return (await this.present(schoolId, [await this.find(schoolId, id)]))[0]!;
  }

  async create(schoolId: number, dto: VehicleInputDto): Promise<VehicleDto> {
    await this.validate(schoolId, dto);
    const device = await this.device(dto.device_id ?? null);
    const saved = await this.vehicles.save(
      this.vehicles.create({
        school_id: schoolId,
        registration_no: dto.registration_no,
        name: dto.name,
        make_model: dto.make_model ?? null,
        capacity: dto.capacity ?? 40,
        vehicle_type: dto.vehicle_type ?? 'bus',
        fuel_type: dto.fuel_type ?? null,
        manufacture_year: dto.manufacture_year ?? null,
        chassis_no: dto.chassis_no ?? null,
        engine_no: dto.engine_no ?? null,
        ownership: dto.ownership ?? 'school',
        contractor_name: dto.ownership === 'contractor' ? (dto.contractor_name ?? null) : null,
        contractor_mobile: dto.ownership === 'contractor' ? (dto.contractor_mobile ?? null) : null,
        device_id: device?.id ?? null,
        device_imei: device?.imei ?? null,
        driver_user_id: dto.driver_user_id ?? null,
        attendant_user_id: dto.attendant_user_id ?? null,
        insurance_expiry: dto.insurance_expiry ?? null,
        fitness_expiry: dto.fitness_expiry ?? null,
        puc_expiry: dto.puc_expiry ?? null,
        permit_expiry: dto.permit_expiry ?? null,
        rc_expiry: dto.rc_expiry ?? null,
        road_tax_expiry: dto.road_tax_expiry ?? null,
        speed_governor_expiry: dto.speed_governor_expiry ?? null,
        fire_extinguisher_expiry: dto.fire_extinguisher_expiry ?? null,
        first_aid_expiry: dto.first_aid_expiry ?? null,
        status: dto.status ?? 'active',
      }),
    );
    return this.get(schoolId, saved.id);
  }

  async update(schoolId: number, id: number, dto: UpdateVehicleDto): Promise<VehicleDto> {
    const vehicle = await this.find(schoolId, id);
    await this.validate(schoolId, dto, id);
    if (dto.capacity !== undefined && dto.capacity < vehicle.capacity) {
      const students = await this.studentsOn(vehicle.id);
      if (dto.capacity < students) {
        throw AppException.badRequest(
          `${students} students ride this bus. Move some to another bus before lowering the seats below ${students}.`,
          'CAPACITY_BELOW_ASSIGNED',
        );
      }
    }
    const changes: Partial<Vehicle> = { ...dto };
    if ((dto.ownership ?? vehicle.ownership) === 'school') {
      changes.contractor_name = null;
      changes.contractor_mobile = null;
    }
    if (dto.device_id !== undefined) {
      const device = await this.device(dto.device_id);
      changes.device_id = device?.id ?? null;
      changes.device_imei = device?.imei ?? null;
    }
    await this.vehicles.save(this.vehicles.merge(vehicle, changes));
    return this.get(schoolId, id);
  }

  async studentsOn(vehicleId: number): Promise<number> {
    const [row] = await this.dataSource.query(`SELECT ${STUDENTS_SQL} AS students FROM vehicles v WHERE v.id = $1`, [
      vehicleId,
    ]);
    return Number(row?.students ?? 0);
  }

  async remove(schoolId: number, id: number): Promise<void> {
    await this.find(schoolId, id);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(TransportRoute, { school_id: schoolId, vehicle_id: id }, { vehicle_id: null });
      await manager.softDelete(Vehicle, id);
    });
  }

  async devices(schoolId: number): Promise<DeviceOptionDto[]> {
    const page = await this.telematics.get<{ items: TelematicsDevice[] }>('/devices', {
      limit: 100,
      sort: 'name',
      order: 'asc',
    });
    const linked = await this.vehicles.find({
      where: { device_id: In(page.items.map((item) => item.id)) },
      withDeleted: false,
    });
    const byDevice = new Map(linked.map((vehicle) => [vehicle.device_id, vehicle]));
    return page.items.map((item) => {
      const vehicle = byDevice.get(item.id);
      const ownSchool = vehicle?.school_id === schoolId;
      return {
        id: item.id,
        imei: item.imei,
        name: item.name,
        vehicle_no: item.vehicle_no,
        last_seen_at: item.last_seen_at,
        linked_vehicle: vehicle
          ? { id: ownSchool ? vehicle.id : 0, name: ownSchool ? vehicle.registration_no : 'Another school' }
          : null,
      };
    });
  }

  async drivers(schoolId: number): Promise<DriverDto[]> {
    const today = todayIn(this.app.timeZone);
    const rows: {
      user_id: number;
      name: string;
      mobile: string;
      role: string;
      licence_no: string | null;
      licence_expiry: string | null;
    }[] = await this.dataSource.query(
      `SELECT DISTINCT ON (u.id) u.id AS user_id, u.name, u.mobile, r.code AS role,
              st.licence_no, to_char(st.licence_expiry, 'YYYY-MM-DD') AS licence_expiry
       FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       LEFT JOIN staff st ON st.user_id = u.id AND st.deleted_at IS NULL
       WHERE u.school_id = $1 AND u.deleted_at IS NULL AND u.status = 'active' AND r.code = ANY($2)
       ORDER BY u.id, r.code`,
      [schoolId, [ROLES.DRIVER, ROLES.ATTENDANT]],
    );
    const vehicles = await this.vehicles.findBy({ school_id: schoolId });
    const duty = new Map(
      await Promise.all(
        rows.map(
          async (row) => [Number(row.user_id), (await this.crew.dutyOf(schoolId, Number(row.user_id))).status] as const,
        ),
      ),
    );
    return rows
      .map((row) => {
        const isDriver = row.role === ROLES.DRIVER;
        const vehicle = vehicles.find((item) =>
          isDriver ? item.driver_user_id === Number(row.user_id) : item.attendant_user_id === Number(row.user_id),
        );
        return {
          user_id: Number(row.user_id),
          name: row.name,
          mobile: row.mobile,
          role: isDriver ? ('driver' as const) : ('attendant' as const),
          licence_no: row.licence_no,
          licence_expiry: row.licence_expiry,
          licence: isDriver ? expiryState('licence', row.licence_expiry, today) : null,
          vehicle: vehicle ? { id: vehicle.id, name: vehicle.registration_no } : null,
          duty_status: duty.get(Number(row.user_id)) ?? ('pending' as const),
        };
      })
      .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  }

  async setLicence(schoolId: number, userId: number, dto: LicenceInputDto): Promise<DriverDto> {
    const driver = (await this.drivers(schoolId)).find((item) => item.user_id === userId && item.role === 'driver');
    if (!driver) throw AppException.notFound('Driver not found', 'DRIVER_NOT_FOUND');
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ school_id: schoolId, user_id: userId });
    if (!staff) {
      throw AppException.badRequest('Add this driver to Staff first, then save the licence', 'STAFF_RECORD_MISSING');
    }
    await this.dataSource
      .getRepository(Staff)
      .update(staff.id, { licence_no: dto.licence_no, licence_expiry: dto.licence_expiry ?? null });
    return (await this.drivers(schoolId)).find((item) => item.user_id === userId)!;
  }

  async upcoming(schoolId: number, days: number): Promise<ExpiryDto[]> {
    return (await this.dueDocuments(schoolId, days)).map((item) => ({
      kind: item.kind,
      label: item.label,
      subject: item.subject,
      ref_id: item.ref_id,
      vehicle_id: item.vehicle_id,
      staff_id: item.staff_id,
      date: item.date,
      days_left: item.days_left,
    }));
  }

  private async dueDocuments(schoolId: number | null, days: number): Promise<DueDocument[]> {
    const today = todayIn(this.app.timeZone);
    const vehicles = await this.vehicles.find({
      where: { ...(schoolId ? { school_id: schoolId } : {}), status: 'active' },
    });
    const items: DueDocument[] = [];
    for (const vehicle of vehicles) {
      for (const [kind, field] of VEHICLE_DOCUMENTS) {
        const date = vehicle[field] as string | null;
        if (!date) continue;
        const daysLeft = daysBetween(today, date);
        if (daysLeft <= days) {
          items.push({
            school_id: vehicle.school_id,
            kind,
            label: EXPIRY_LABELS[kind],
            subject: vehicle.registration_no,
            ref_id: vehicle.id,
            vehicle_id: vehicle.id,
            staff_id: null,
            user_id: null,
            approved: false,
            driver_user_id: vehicle.driver_user_id,
            date,
            days_left: daysLeft,
          });
        }
      }
    }
    const people: Record<string, string | number | boolean | null>[] = await this.dataSource.query(
      `SELECT st.school_id, st.id AS staff_id, st.user_id, u.name, st.duty_approved_at IS NOT NULL AS approved,
              ${CREW_CHECKS.map((check) => `to_char(st.${check.field}, 'YYYY-MM-DD') AS ${check.field}`).join(', ')}
       FROM staff st JOIN users u ON u.id = st.user_id
       WHERE st.deleted_at IS NULL AND st.status <> 'resigned'
         AND (${CREW_CHECKS.map((check) => `st.${check.field} <= ($1::date + $2::int)`).join(' OR ')})
         ${schoolId ? 'AND st.school_id = $3' : ''}`,
      schoolId ? [today, days, schoolId] : [today, days],
    );
    for (const row of people) {
      for (const check of CREW_CHECKS) {
        const date = row[check.field] as string | null;
        if (!date) continue;
        const daysLeft = daysBetween(today, date);
        if (daysLeft > days) continue;
        items.push({
          school_id: Number(row.school_id),
          kind: check.kind,
          label: EXPIRY_LABELS[check.kind],
          subject: String(row.name),
          ref_id: Number(row.user_id),
          vehicle_id: null,
          staff_id: Number(row.staff_id),
          user_id: Number(row.user_id),
          approved: Boolean(row.approved),
          driver_user_id: null,
          date,
          days_left: daysLeft,
        });
      }
    }
    return items.sort((a, b) => a.days_left - b.days_left);
  }

  @Cron('0 7 * * *', { name: 'fleet-expiry', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
  async dailyExpiryCheck(): Promise<void> {
    const sent = await this.sendExpiryAlerts(null);
    if (sent) this.logger.log(`Sent ${sent} document expiry alerts`);
  }

  async runExpiryCheck(schoolId: number): Promise<ExpiryRunDto> {
    const sent = await this.sendExpiryAlerts(schoolId);
    return { alerts_sent: sent, upcoming: await this.upcoming(schoolId, 30) };
  }

  async sendExpiryAlerts(schoolId: number | null): Promise<number> {
    const due = await this.dueDocuments(schoolId, 30);
    const admins = (item: DueDocument) => ({
      roles: [ROLES.TRANSPORT_INCHARGE, ROLES.ADMIN],
      school_id: item.school_id,
    });
    const schools: { id: number; name: string }[] = due.length
      ? await this.dataSource.query(`SELECT id, name FROM schools WHERE id = ANY($1)`, [
          [...new Set(due.map((item) => item.school_id))],
        ])
      : [];
    let sent = 0;
    for (const item of due) {
      const threshold = alertThreshold(item.days_left);
      if (threshold === null) continue;
      const data = {
        school: schools.find((school) => Number(school.id) === item.school_id)?.name ?? '',
        document: item.label,
        subject: item.subject,
        date: displayDate(item.date),
        days: String(Math.max(item.days_left, 0)),
        when: whenText(item.days_left, displayDate(item.date)),
      };
      if (await this.firstAlert(item, item.kind, threshold)) {
        const kind = item.user_id ? 'CREW' : 'FLEET';
        const template = sendsSms(threshold) ? `${kind}_DOCUMENT_EXPIRY_URGENT` : `${kind}_DOCUMENT_EXPIRY`;
        sent += await this.alert(item, template, admins(item), data);
      }
      if (!item.user_id) {
        const driverThreshold = selfAlertThreshold(item.days_left);
        if (
          item.driver_user_id &&
          this.transport.crewExpiryAutoNotify &&
          driverThreshold !== null &&
          (await this.firstAlert(item, `${item.kind}_self`, driverThreshold))
        ) {
          sent += await this.alert(
            item,
            'BUS_DOCUMENT_EXPIRY_DRIVER',
            { user_ids: [item.driver_user_id], school_id: item.school_id },
            data,
          );
        }
        continue;
      }
      const crew = { user_ids: [item.user_id], school_id: item.school_id };
      const selfThreshold = selfAlertThreshold(item.days_left);
      if (
        this.transport.crewExpiryAutoNotify &&
        selfThreshold !== null &&
        (await this.firstAlert(item, `${item.kind as 'licence'}_self`, selfThreshold))
      ) {
        const documents = `${item.label} ${item.days_left < 0 ? 'expired on' : 'ends on'} ${data.date}`;
        sent += await this.alert(item, 'CREW_DOCUMENT_EXPIRY_SELF', crew, { documents });
      }
      if (item.days_left < 0 && item.approved && (await this.firstAlert(item, 'blocked', 0))) {
        sent += await this.alert(item, 'CREW_BLOCKED', admins(item), data);
        if (this.transport.crewExpiryAutoNotify) await this.alert(item, 'CREW_BLOCKED', crew, data);
      }
    }
    return sent;
  }

  private async firstAlert(item: DueDocument, kind: AlertKind, threshold: number): Promise<boolean> {
    const inserted = await this.alerts
      .createQueryBuilder()
      .insert()
      .values({
        school_id: item.school_id,
        kind,
        ref_id: item.ref_id,
        expiry_date: item.date,
        threshold_days: threshold,
      })
      .orIgnore()
      .execute();
    return Boolean((inserted.raw as unknown[] | undefined)?.length);
  }

  private async alert(
    item: DueDocument,
    template: string,
    audience: { roles?: string[]; user_ids?: number[]; school_id: number },
    data: Record<string, string>,
  ): Promise<number> {
    return this.notifications
      .dispatch({ template, audience, data })
      .then(() => 1)
      .catch((error: Error) => {
        this.logger.warn(`Expiry alert ${template} ${item.kind} ${item.ref_id} not sent: ${error.message}`);
        return 0;
      });
  }

  private async validate(schoolId: number, dto: Partial<VehicleInputDto>, id?: number): Promise<void> {
    if (dto.registration_no) {
      const clash = await this.vehicles.findOneBy({ school_id: schoolId, registration_no: dto.registration_no });
      if (clash && clash.id !== id) {
        throw AppException.conflict(`${dto.registration_no} is already added`, 'VEHICLE_EXISTS');
      }
    }
    if (dto.device_id) {
      const clash = await this.vehicles.findOneBy({ device_id: dto.device_id });
      if (clash && clash.id !== id) {
        throw AppException.conflict(
          clash.school_id === schoolId
            ? `This tracker is already fitted to ${clash.registration_no}`
            : 'This tracker belongs to another school',
          'DEVICE_IN_USE',
        );
      }
    }
    const people = await this.drivers(schoolId);
    const current = id ? await this.vehicles.findOneBy({ id, school_id: schoolId }) : null;
    if (dto.driver_user_id && !people.some((item) => item.user_id === dto.driver_user_id && item.role === 'driver')) {
      throw AppException.validation([{ field: 'driver_user_id', message: 'Choose a user with the Driver role' }]);
    }
    if (
      dto.attendant_user_id &&
      !people.some((item) => item.user_id === dto.attendant_user_id && item.role === 'attendant')
    ) {
      throw AppException.validation([{ field: 'attendant_user_id', message: 'Choose a user with the Attendant role' }]);
    }
    for (const field of ['driver_user_id', 'attendant_user_id'] as const) {
      const userId = dto[field];
      if (!userId || userId === current?.[field]) continue;
      const duty = people.find((item) => item.user_id === userId)?.duty_status;
      if (duty !== 'approved') {
        throw AppException.validation([
          {
            field,
            message:
              duty === 'blocked'
                ? 'This person needs renewed documents before they can be put on a bus'
                : 'Approve this person for duty in Drivers and attendants first',
          },
        ]);
      }
    }
  }

  private async device(deviceId: number | null): Promise<TelematicsDevice | null> {
    if (!deviceId) return null;
    return this.telematics.get<TelematicsDevice>(`/devices/${deviceId}`).catch((error: AppException) => {
      if (error.getStatus?.() === 404) {
        throw AppException.validation([{ field: 'device_id', message: 'This tracker is not registered' }]);
      }
      throw error;
    });
  }

  private async find(schoolId: number, id: number): Promise<Vehicle> {
    const vehicle = await this.vehicles.findOneBy({ id, school_id: schoolId });
    if (!vehicle) throw AppException.notFound('Bus not found', 'VEHICLE_NOT_FOUND');
    return vehicle;
  }

  private async present(schoolId: number, rows: Vehicle[]): Promise<VehicleDto[]> {
    if (!rows.length) return [];
    const today = todayIn(this.app.timeZone);
    const allowed = await readOverrides(
      this.dataSource,
      schoolId,
      'vehicle',
      rows.map((row) => row.id),
      today,
    );
    const userIds = [
      ...new Set(rows.flatMap((row) => [row.driver_user_id, row.attendant_user_id]).filter((id): id is number => !!id)),
    ];
    const [people, routes]: [PersonContactDto[], { id: number; name: string; vehicle_id: number; students: string }[]] =
      await Promise.all([
        userIds.length
          ? this.dataSource.query(`SELECT id, name, mobile FROM users WHERE id = ANY($1)`, [userIds])
          : Promise.resolve([]),
        this.dataSource.query(
          `SELECT r.id, r.name, r.vehicle_id,
                  (SELECT COUNT(*) FROM student_transport t WHERE t.route_id = r.id AND t.deleted_at IS NULL) AS students
           FROM transport_routes r WHERE r.school_id = $1 AND r.deleted_at IS NULL AND r.vehicle_id = ANY($2)`,
          [schoolId, rows.map((row) => row.id)],
        ),
      ]);
    const person = (id: number | null) => {
      const found = people.find((item) => Number(item.id) === id);
      return found ? { id: Number(found.id), name: found.name, mobile: found.mobile } : null;
    };
    return rows.map((row) => {
      const own = routes.filter((route) => Number(route.vehicle_id) === row.id);
      const students = own.reduce((sum, route) => sum + Number(route.students), 0);
      const expiries = VEHICLE_DOCUMENTS.map(([kind, field]) => expiryState(kind, row[field] as string | null, today));
      const blockers = roadBlockers(expiries);
      return {
        id: row.id,
        registration_no: row.registration_no,
        name: row.name,
        make_model: row.make_model,
        capacity: row.capacity,
        device: row.device_id ? { id: row.device_id, imei: row.device_imei } : null,
        driver: person(row.driver_user_id),
        attendant: person(row.attendant_user_id),
        insurance_expiry: row.insurance_expiry,
        fitness_expiry: row.fitness_expiry,
        puc_expiry: row.puc_expiry,
        permit_expiry: row.permit_expiry,
        rc_expiry: row.rc_expiry,
        road_tax_expiry: row.road_tax_expiry,
        speed_governor_expiry: row.speed_governor_expiry,
        fire_extinguisher_expiry: row.fire_extinguisher_expiry,
        first_aid_expiry: row.first_aid_expiry,
        expiries,
        vehicle_type: row.vehicle_type,
        fuel_type: row.fuel_type,
        manufacture_year: row.manufacture_year,
        chassis_no: row.chassis_no,
        engine_no: row.engine_no,
        ownership: row.ownership,
        contractor_name: row.contractor_name,
        contractor_mobile: row.contractor_mobile,
        road_worthy: blockers.length === 0,
        road_blockers: blockers,
        allowed_today: allowed.get(row.id) ?? null,
        ...occupancy(students, row.capacity),
        routes: own.map((route) => ({ id: Number(route.id), name: route.name })),
        students,
        status: row.status,
      };
    });
  }
}
