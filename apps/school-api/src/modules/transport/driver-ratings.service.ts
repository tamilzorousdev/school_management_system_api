import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AppException, listQuery, Paginated } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { todayIn } from '../../shared/dates';
import { ROLES } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DriverOwnRatingsDto,
  DriverRatingDto,
  DriverRatingInputDto,
  DriverRatingInsightsDto,
  DriverRatingQueryDto,
  DriverRatingSettingsDto,
  DriverRatingSettingsInputDto,
  DriverRatingSummaryDto,
  ParentDriverRatingDto,
  RatedBusDto,
  RatedDriverDto,
} from './dto/driver-rating.dto';
import { School } from '../schools/entities/school.entity';
import { DriverRating, RATING_TAGS, RatingTag } from './entities/driver-rating.entity';
import { StudentTransport } from './entities/student-transport.entity';
import { TransportRoute } from './entities/transport-route.entity';
import { Vehicle } from './entities/vehicle.entity';
import {
  lowRatingProblem,
  RATING_TAG_INFO,
  ratingMonth,
  ratingStats,
  ratingTags,
  topTags,
} from './driver-rating.logic';

interface ChildBus {
  vehicle: Vehicle | null;
  driver: RatedDriverDto | null;
}

@Injectable()
export class DriverRatingsService {
  private readonly logger = new Logger('DriverRatings');

  constructor(
    @InjectRepository(DriverRating) private readonly ratings: Repository<DriverRating>,
    @InjectRepository(StudentTransport) private readonly assignments: Repository<StudentTransport>,
    @InjectRepository(TransportRoute) private readonly routes: Repository<TransportRoute>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async forParent(schoolId: number, parentId: number, studentId: number): Promise<ParentDriverRatingDto> {
    const bus = await this.childBus(schoolId, studentId);
    const month = this.month();
    const mine = bus?.driver
      ? await this.ratings.findOneBy({ parent_user_id: parentId, driver_user_id: bus.driver.id, month })
      : null;
    return {
      driver: bus?.driver ?? null,
      vehicle: bus?.vehicle ? busRef(bus.vehicle) : null,
      month,
      can_rate: Boolean(bus?.driver),
      low_rating_max: await this.lowMax(schoolId),
      my_rating: mine
        ? { rating: mine.rating, tags: mine.tags, comment: mine.comment, updated_at: mine.updated_at }
        : null,
      tags: ratingTags(),
    };
  }

  async rate(
    schoolId: number,
    parentId: number,
    studentId: number,
    dto: DriverRatingInputDto,
  ): Promise<ParentDriverRatingDto> {
    const bus = await this.childBus(schoolId, studentId);
    if (!bus) throw AppException.badRequest('This child does not use the school bus', 'NOT_ON_BUS');
    if (!bus.driver) throw AppException.badRequest('This bus has no driver yet', 'NO_DRIVER');
    const tags = dto.tags ?? [];
    const comment = dto.comment || null;
    const lowMax = await this.lowMax(schoolId);
    const problem = lowRatingProblem(dto.rating, tags, comment, lowMax);
    if (problem) throw AppException.validation([{ field: 'comment', message: problem }]);
    const month = this.month();
    const existing = await this.ratings.findOneBy({ parent_user_id: parentId, driver_user_id: bus.driver.id, month });
    const wasLow = existing ? existing.rating <= lowMax : false;
    await this.ratings.save(
      existing
        ? this.ratings.merge(existing, { rating: dto.rating, tags, comment, student_id: studentId })
        : this.ratings.create({
            school_id: schoolId,
            driver_user_id: bus.driver.id,
            vehicle_id: bus.vehicle?.id ?? null,
            student_id: studentId,
            parent_user_id: parentId,
            month,
            rating: dto.rating,
            tags,
            comment,
            created_by: parentId,
          }),
    );
    if (dto.rating <= lowMax && !wasLow)
      await this.tellOffice(schoolId, parentId, studentId, bus, dto.rating, tags, comment);
    return this.forParent(schoolId, parentId, studentId);
  }

  async list(schoolId: number, query: DriverRatingQueryDto): Promise<Paginated<DriverRatingDto>> {
    const qb = this.ratings
      .createQueryBuilder('r')
      .innerJoin('users', 'd', 'd.id = r.driver_user_id')
      .innerJoin('users', 'p', 'p.id = r.parent_user_id')
      .innerJoin('students', 's', 's.id = r.student_id')
      .where('r.school_id = :schoolId', { schoolId });
    if (query.driver_user_id) qb.andWhere('r.driver_user_id = :driver', { driver: query.driver_user_id });
    if (query.vehicle_id) qb.andWhere('r.vehicle_id = :vehicle', { vehicle: query.vehicle_id });
    if (query.rating) qb.andWhere('r.rating = :rating', { rating: query.rating });
    if (query.low) qb.andWhere('r.rating <= :low', { low: await this.lowMax(schoolId) });
    if (query.from)
      qb.andWhere(`r.updated_at >= (:from::date AT TIME ZONE :tz)`, { from: query.from, tz: this.app.timeZone });
    if (query.to) {
      qb.andWhere(`r.updated_at < ((:to::date + 1) AT TIME ZONE :tz)`, { to: query.to, tz: this.app.timeZone });
    }
    const page = await listQuery(qb, query, {
      searchable: ['d.name', 'p.name', 's.first_name', 's.last_name', 'r.comment'],
      sortable: { created_at: 'r.created_at', updated_at: 'r.updated_at', rating: 'r.rating' },
      defaultSort: 'updated_at',
    });
    return { ...page, items: await this.present(page.items) };
  }

  async summary(schoolId: number): Promise<DriverRatingSummaryDto[]> {
    const [rows, buses] = await Promise.all([
      this.ratings.find({ where: { school_id: schoolId }, select: ['driver_user_id', 'rating', 'tags', 'month'] }),
      this.vehicles.find({ where: { school_id: schoolId, status: 'active' }, order: { name: 'ASC' } }),
    ]);
    const month = this.month();
    const lowMax = await this.lowMax(schoolId);
    const driverIds = [
      ...new Set([
        ...buses.map((bus) => bus.driver_user_id).filter((id): id is number => Boolean(id)),
        ...rows.map((row) => row.driver_user_id),
      ]),
    ];
    const drivers = await this.drivers(driverIds);
    return driverIds
      .flatMap((driverId) => {
        const driver = drivers.get(driverId);
        if (!driver) return [];
        const own = rows.filter((row) => row.driver_user_id === driverId);
        const thisMonth = ratingStats(own.filter((row) => row.month === month).map((row) => row.rating));
        const all = ratingStats(own.map((row) => row.rating));
        const bus = buses.find((item) => item.driver_user_id === driverId);
        return [
          {
            driver,
            vehicle: bus ? busRef(bus) : null,
            average: all.average,
            count: all.count,
            month_average: thisMonth.average,
            month_count: thisMonth.count,
            low_count: own.filter((row) => row.rating <= lowMax).length,
            distribution: all.distribution,
            top_tags: topTags(
              own.map((row) => row.tags),
              RATING_TAGS.length,
            ),
            needs_attention: thisMonth.average !== null && thisMonth.average <= lowMax,
          },
        ];
      })
      .sort((a, b) => (a.average ?? 99) - (b.average ?? 99) || a.driver.name.localeCompare(b.driver.name));
  }

  async insights(schoolId: number): Promise<DriverRatingInsightsDto> {
    const rows = await this.ratings.find({
      where: { school_id: schoolId },
      select: ['driver_user_id', 'rating', 'month'],
    });
    const month = this.month();
    const lowMax = await this.lowMax(schoolId);
    const thisMonth = rows.filter((row) => row.month === month);
    return {
      average: ratingStats(rows.map((row) => row.rating)).average,
      count: rows.length,
      month_count: thisMonth.length,
      month_low: thisMonth.filter((row) => row.rating <= lowMax).length,
      drivers_rated: new Set(rows.map((row) => row.driver_user_id)).size,
    };
  }

  private async childBus(schoolId: number, studentId: number): Promise<ChildBus | null> {
    const assignment = await this.assignments.findOneBy({ school_id: schoolId, student_id: studentId });
    if (!assignment) return null;
    const route = await this.routes.findOneBy({ id: assignment.route_id, school_id: schoolId });
    const vehicle = route?.vehicle_id
      ? await this.vehicles.findOneBy({ id: route.vehicle_id, school_id: schoolId })
      : null;
    const driver = vehicle?.driver_user_id
      ? ((await this.drivers([vehicle.driver_user_id])).get(vehicle.driver_user_id) ?? null)
      : null;
    return { vehicle, driver };
  }

  private async drivers(ids: number[]): Promise<Map<number, RatedDriverDto>> {
    if (!ids.length) return new Map();
    const rows: { id: number; name: string; photo_file_id: number | null }[] = await this.dataSource.query(
      `SELECT id, name, photo_file_id FROM users WHERE id = ANY($1)`,
      [ids],
    );
    return new Map(
      rows.map((row) => [
        Number(row.id),
        {
          id: Number(row.id),
          name: row.name,
          photo_url: this.files.linkFor(row.photo_file_id === null ? null : Number(row.photo_file_id)),
        },
      ]),
    );
  }

  private async present(rows: DriverRating[]): Promise<DriverRatingDto[]> {
    if (!rows.length) return [];
    const userIds = [...new Set(rows.flatMap((row) => [row.driver_user_id, row.parent_user_id]))];
    const studentIds = [...new Set(rows.map((row) => row.student_id))];
    const vehicleIds = [...new Set(rows.map((row) => row.vehicle_id).filter((id): id is number => Boolean(id)))];
    const [users, students, vehicles]: [
      { id: number; name: string }[],
      {
        id: number;
        first_name: string;
        last_name: string | null;
        class_name: string | null;
        section_name: string | null;
      }[],
      Vehicle[],
    ] = await Promise.all([
      this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [userIds]),
      this.dataSource.query(
        `SELECT s.id, s.first_name, s.last_name, c.name AS class_name, sec.name AS section_name
         FROM students s
         LEFT JOIN student_enrollments e ON e.student_id = s.id
           AND e.academic_year_id = (SELECT id FROM academic_years y WHERE y.school_id = s.school_id AND y.is_current LIMIT 1)
         LEFT JOIN sections sec ON sec.id = e.section_id
         LEFT JOIN classes c ON c.id = COALESCE(e.class_id, sec.class_id)
         WHERE s.id = ANY($1)`,
        [studentIds],
      ),
      vehicleIds.length ? this.vehicles.findBy({ id: In(vehicleIds) }) : Promise.resolve([] as Vehicle[]),
    ]);
    const userRef = (id: number) => ({ id, name: users.find((user) => Number(user.id) === id)?.name ?? '' });
    return rows.map((row) => {
      const student = students.find((item) => Number(item.id) === row.student_id);
      const vehicle = vehicles.find((item) => item.id === row.vehicle_id);
      return {
        id: row.id,
        rating: row.rating,
        tags: row.tags.map((code) => ({ code, ...RATING_TAG_INFO[code] })),
        comment: row.comment,
        month: row.month,
        driver: userRef(row.driver_user_id),
        vehicle: vehicle ? busRef(vehicle) : null,
        student: {
          id: row.student_id,
          full_name: [student?.first_name, student?.last_name].filter(Boolean).join(' '),
          class_section: student?.class_name
            ? [student.class_name, student.section_name].filter(Boolean).join(' - ')
            : null,
        },
        parent: userRef(row.parent_user_id),
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
  }

  private async tellOffice(
    schoolId: number,
    parentId: number,
    studentId: number,
    bus: ChildBus,
    rating: number,
    tags: RatingTag[],
    comment: string | null,
  ): Promise<void> {
    const [[parent], [student]]: [{ name: string }[], { first_name: string; last_name: string | null }[]] =
      await Promise.all([
        this.dataSource.query(`SELECT name FROM users WHERE id = $1`, [parentId]),
        this.dataSource.query(`SELECT first_name, last_name FROM students WHERE id = $1`, [studentId]),
      ]);
    const reasons = tags.filter((tag) => !RATING_TAG_INFO[tag].positive).map((tag) => RATING_TAG_INFO[tag].label);
    const reason = [reasons.join(', '), comment].filter(Boolean).join('. ');
    await this.notifications
      .dispatch({
        template: TEMPLATES.DRIVER_LOW_RATING,
        audience: { roles: [ROLES.ADMIN, ROLES.TRANSPORT_INCHARGE, ROLES.AO], school_id: schoolId },
        data: {
          driver: bus.driver?.name ?? '',
          bus: bus.vehicle ? `${bus.vehicle.name} (${bus.vehicle.registration_no})` : 'the school bus',
          rating: String(rating),
          parent: parent?.name ?? 'A parent',
          student: student ? [student.first_name, student.last_name].filter(Boolean).join(' ') : '',
          reason,
        },
      })
      .catch((error: Error) => this.logger.warn(`Low rating alert failed: ${error.message}`));
  }

  async settings(schoolId: number): Promise<DriverRatingSettingsDto> {
    const school = await this.dataSource.getRepository(School).findOneByOrFail({ id: schoolId });
    return { low_rating_max: school.driver_low_rating_max, min_responses: school.driver_rating_min_responses };
  }

  async updateSettings(schoolId: number, dto: DriverRatingSettingsInputDto): Promise<DriverRatingSettingsDto> {
    const changes: Partial<School> = {};
    if (dto.low_rating_max !== undefined) changes.driver_low_rating_max = dto.low_rating_max;
    if (dto.min_responses !== undefined) changes.driver_rating_min_responses = dto.min_responses;
    if (Object.keys(changes).length) await this.dataSource.getRepository(School).update(schoolId, changes);
    return this.settings(schoolId);
  }

  async ownRatings(schoolId: number, driverUserId: number): Promise<DriverOwnRatingsDto> {
    const { min_responses } = await this.settings(schoolId);
    const rows = await this.ratings.find({
      where: { school_id: schoolId, driver_user_id: driverUserId },
      select: ['rating', 'tags', 'month'],
    });
    const enough = rows.length >= min_responses;
    const month = this.month();
    const thisMonth = ratingStats(rows.filter((row) => row.month === month).map((row) => row.rating));
    const all = ratingStats(rows.map((row) => row.rating));
    return {
      min_responses,
      count: rows.length,
      enough,
      average: enough ? all.average : null,
      month_average: enough ? thisMonth.average : null,
      month_count: thisMonth.count,
      distribution: enough ? all.distribution : [0, 0, 0, 0, 0],
      top_tags: enough
        ? topTags(
            rows.map((row) => row.tags),
            RATING_TAGS.length,
          )
        : [],
    };
  }

  private async lowMax(schoolId: number): Promise<number> {
    return (await this.settings(schoolId)).low_rating_max;
  }

  private month(): string {
    return ratingMonth(todayIn(this.app.timeZone));
  }
}

function busRef(vehicle: Vehicle): RatedBusDto {
  return { id: vehicle.id, registration_no: vehicle.registration_no, name: vehicle.name };
}
