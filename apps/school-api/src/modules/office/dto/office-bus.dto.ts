import { ApiProperty } from '@nestjs/swagger';

export class CrewRefDto {
  @ApiProperty({ example: 41 })
  user_id: number;

  @ApiProperty({ example: 'Ganesan Pillai' })
  name: string;

  @ApiProperty({ example: '9000000007', nullable: true, type: String })
  mobile: string | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;
}

export class DriverRatingSummaryDto {
  @ApiProperty({ example: 4.2, nullable: true, type: Number })
  average: number | null;

  @ApiProperty({ example: 36 })
  count: number;
}

export class TripTodayDto {
  @ApiProperty({ example: 'pickup', enum: ['pickup', 'drop'] })
  kind: 'pickup' | 'drop';

  @ApiProperty({ example: 'reached', enum: ['not_started', 'running', 'reached'] })
  state: 'not_started' | 'running' | 'reached';

  @ApiProperty({ example: '2026-11-24T07:30:00.000+05:30', nullable: true, type: Date })
  started_at: Date | null;

  @ApiProperty({ example: '2026-11-24T08:32:00.000+05:30', nullable: true, type: Date })
  ended_at: Date | null;

  @ApiProperty({ example: 10, nullable: true, type: Number, description: 'Minutes late reported by the driver' })
  delay_minutes: number | null;
}

export class BusStudentDto {
  @ApiProperty({ example: 6 })
  student_id: number;

  @ApiProperty({ example: 'Aadhavan Senthil' })
  name: string;

  @ApiProperty({ example: 1, nullable: true, type: Number })
  roll_no: number | null;

  @ApiProperty({ nullable: true, type: String })
  photo_url: string | null;

  @ApiProperty({ example: 'both', description: 'both, pickup or drop' })
  mode: string;

  @ApiProperty({ example: 'Anna Nagar West', nullable: true, type: String })
  pickup_stop: string | null;

  @ApiProperty({ example: '07:50', nullable: true, type: String })
  pickup_time: string | null;

  @ApiProperty({ example: 'Anna Nagar West', nullable: true, type: String })
  drop_stop: string | null;

  @ApiProperty({ example: '16:20', nullable: true, type: String })
  drop_time: string | null;

  @ApiProperty({ example: 'active', nullable: true, type: String })
  pass_status: string | null;

  @ApiProperty({
    example: 'boarded',
    enum: ['boarded', 'not_boarded', 'away', 'waiting', 'not_by_bus'],
    description:
      'Morning: boarded; not_boarded (trip reached without them and no leave); away (absent or on leave); waiting (trip not reached yet); not_by_bus (drop only)',
  })
  morning: 'boarded' | 'not_boarded' | 'away' | 'waiting' | 'not_by_bus';

  @ApiProperty({ example: '2026-11-24T07:52:00.000+05:30', nullable: true, type: Date })
  boarded_at: Date | null;

  @ApiProperty({
    example: '2026-11-24T16:20:00.000+05:30',
    nullable: true,
    type: Date,
    description: 'Got off in the evening',
  })
  dropped_at: Date | null;
}

export class SectionRouteDto {
  @ApiProperty({ example: 3 })
  route_id: number;

  @ApiProperty({ example: 'R1 · Mogappair - Anna Nagar West - School' })
  route: string;

  @ApiProperty({ example: 'TN 01 AB 1234', nullable: true, type: String })
  bus: string | null;

  @ApiProperty({ example: 40, nullable: true, type: Number })
  capacity: number | null;

  @ApiProperty({ type: CrewRefDto, nullable: true })
  driver: CrewRefDto | null;

  @ApiProperty({ type: DriverRatingSummaryDto })
  driver_rating: DriverRatingSummaryDto;

  @ApiProperty({ type: CrewRefDto, nullable: true })
  attendant: CrewRefDto | null;

  @ApiProperty({ type: [TripTodayDto] })
  trips: TripTodayDto[];

  @ApiProperty({ example: 11 })
  boarded: number;

  @ApiProperty({ example: 12, description: 'Students of this section who take this bus in the morning' })
  expected: number;

  @ApiProperty({ type: [BusStudentDto] })
  students: BusStudentDto[];
}

export class SectionBusDto {
  @ApiProperty({ example: '6 - A' })
  class_section: string;

  @ApiProperty({ example: 9 })
  by_bus: number;

  @ApiProperty({ example: 4, description: 'Students without school bus' })
  not_by_bus: number;

  @ApiProperty({ type: [SectionRouteDto] })
  routes: SectionRouteDto[];
}

export class NotBoardedDto {
  @ApiProperty({ example: 6 })
  student_id: number;

  @ApiProperty({ example: 'Aadhavan Senthil' })
  name: string;

  @ApiProperty({ example: '6 - A', nullable: true, type: String })
  class_section: string | null;

  @ApiProperty({ example: 'R1 · Mogappair' })
  route: string;
}

export class BusesTodayDto {
  @ApiProperty({ example: 6, description: 'Buses carrying students of my wings' })
  buses: number;

  @ApiProperty({ example: 5 })
  reached: number;

  @ApiProperty({ example: 1 })
  running: number;

  @ApiProperty({ example: 0 })
  not_started: number;

  @ApiProperty({ example: 1, description: 'Morning trips reported late' })
  late: number;

  @ApiProperty({ example: 120, description: 'Students of my wings who come by bus' })
  students: number;

  @ApiProperty({ type: [NotBoardedDto], description: 'Did not board this morning and have no leave or absence' })
  not_boarded: NotBoardedDto[];
}

export class StudentBusTodayDto {
  @ApiProperty({ example: '2026-11-24T07:52:00.000+05:30', nullable: true, type: Date })
  boarded_at: Date | null;

  @ApiProperty({ example: 'Anna Nagar West', nullable: true, type: String })
  boarded_stop: string | null;

  @ApiProperty({
    example: '2026-11-24T08:32:00.000+05:30',
    nullable: true,
    type: Date,
    description: 'Morning trip reached school',
  })
  reached_school_at: Date | null;

  @ApiProperty({ example: '2026-11-24T16:20:00.000+05:30', nullable: true, type: Date })
  dropped_at: Date | null;

  @ApiProperty({ example: 'Anna Nagar West', nullable: true, type: String })
  dropped_stop: string | null;
}

export class DriverRemarkDto {
  @ApiProperty({ example: 4 })
  rating: number;

  @ApiProperty({ example: ['safe_driving', 'on_time'] })
  tags: string[];

  @ApiProperty({ example: 'Very careful driver', nullable: true, type: String })
  comment: string | null;

  @ApiProperty({ example: '2026-11' })
  month: string;
}

export class OfficeDriverDto {
  @ApiProperty({ type: CrewRefDto })
  driver: CrewRefDto;

  @ApiProperty({ example: 'TN0120190012345', nullable: true, type: String })
  licence_no: string | null;

  @ApiProperty({ example: '2029-04-30', nullable: true, type: String })
  licence_expiry: string | null;

  @ApiProperty({
    example: [],
    description: 'Warnings only: licence_expired, badge_expired, medical_expired (documents are not shown)',
  })
  warnings: string[];

  @ApiProperty({ example: ['R1 · Mogappair - Anna Nagar West - School'] })
  routes: string[];

  @ApiProperty({ example: 'TN 01 AB 1234', nullable: true, type: String })
  bus: string | null;

  @ApiProperty({ type: DriverRatingSummaryDto })
  rating: DriverRatingSummaryDto;

  @ApiProperty({ example: { '1': 0, '2': 1, '3': 4, '4': 15, '5': 16 } })
  stars: Record<string, number>;

  @ApiProperty({ type: [DriverRemarkDto], description: 'Latest 5 parent remarks (no parent names)' })
  recent: DriverRemarkDto[];
}
