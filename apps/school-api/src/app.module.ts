import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ALL_CONFIGS } from './config/configuration';
import { validate } from './config/env.validation';
import { YearContextInterceptor } from './shared/year-context.interceptor';
import { DatabaseModule } from './database/database.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { AccessModule } from './modules/access/access.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { SetupModule } from './modules/setup/setup.module';
import { SmsModule } from './modules/sms/sms.module';
import { StudentsModule } from './modules/students/students.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { FleetOpsModule } from './modules/fleet-ops/fleet-ops.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { DiaryModule } from './modules/diary/diary.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { ChatModule } from './modules/chat/chat.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { MobileModule } from './modules/mobile/mobile.module';
import { SecurityModule } from './modules/security/security.module';
import { StaffModule } from './modules/staff/staff.module';
import { StaffAttendanceModule } from './modules/staff-attendance/staff-attendance.module';
import { StaffLeaveModule } from './modules/staff-leave/staff-leave.module';
import { TimetableModule } from './modules/timetable/timetable.module';
import { SubstitutesModule } from './modules/substitutes/substitutes.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { FeesModule } from './modules/fees/fees.module';
import { ExamsModule } from './modules/exams/exams.module';
import { TransportModule } from './modules/transport/transport.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { AchievementsModule } from './modules/achievements/achievements.module';
import { AppBannersModule } from './modules/app-banners/app-banners.module';
import { StudentLifecycleModule } from './modules/student-lifecycle/student-lifecycle.module';
import { StudentImportModule } from './modules/student-import/student-import.module';
import { StudentRecordsModule } from './modules/student-records/student-records.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate, load: ALL_CONFIGS }),
    DatabaseModule,
    HealthModule,
    SmsModule,
    SchoolsModule,
    SetupModule,
    StudentsModule,
    SecurityModule,
    StudentRecordsModule,
    StudentLifecycleModule,
    StudentImportModule,
    StaffModule,
    AttendanceModule,
    StaffAttendanceModule,
    StaffLeaveModule,
    TimetableModule,
    SubstitutesModule,
    PayrollModule,
    FeesModule,
    ExamsModule,
    TransportModule,
    TrackingModule,
    DashboardModule,
    PerformanceModule,
    AchievementsModule,
    AppBannersModule,
    MeetingsModule,
    DiaryModule,
    AnnouncementsModule,
    ChatModule,
    RealtimeModule,
    MobileModule,
    FleetModule,
    FleetOpsModule,
    AccessModule,
    UsersModule,
    AuthModule,
    NotificationsModule,
    FilesModule,
    JobsModule,
  ],
  providers: [
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: YearContextInterceptor },
  ],
})
export class AppModule {}
