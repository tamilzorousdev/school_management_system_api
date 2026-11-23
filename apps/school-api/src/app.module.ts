import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ALL_CONFIGS } from './config/configuration';
import { validate } from './config/env.validation';
import { YearContextInterceptor } from './shared/year-context.interceptor';
import { DatabaseModule } from './database/database.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EmergencyModule } from './modules/emergency/emergency.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { AppraisalsModule } from './modules/appraisals/appraisals.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
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
import { GateModule } from './modules/gate/gate.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { DiaryModule } from './modules/diary/diary.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { EventsModule } from './modules/events/events.module';
import { ChatModule } from './modules/chat/chat.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { MobileModule } from './modules/mobile/mobile.module';
import { SecurityModule } from './modules/security/security.module';
import { StaffModule } from './modules/staff/staff.module';
import { CrewModule } from './modules/crew/crew.module';
import { StaffAttendanceModule } from './modules/staff-attendance/staff-attendance.module';
import { StaffLeaveModule } from './modules/staff-leave/staff-leave.module';
import { TimetableModule } from './modules/timetable/timetable.module';
import { AcademicsModule } from './modules/academics/academics.module';
import { SubstitutesModule } from './modules/substitutes/substitutes.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { FeesModule } from './modules/fees/fees.module';
import { LibraryModule } from './modules/library/library.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ExamsModule } from './modules/exams/exams.module';
import { QuizzesModule } from './modules/quizzes/quizzes.module';
import { TransportModule } from './modules/transport/transport.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { AchievementsModule } from './modules/achievements/achievements.module';
import { AppBannersModule } from './modules/app-banners/app-banners.module';
import { StudentLifecycleModule } from './modules/student-lifecycle/student-lifecycle.module';
import { StudentImportModule } from './modules/student-import/student-import.module';
import { StudentRecordsModule } from './modules/student-records/student-records.module';
import { UsersModule } from './modules/users/users.module';
import { GrievancesModule } from './modules/grievances/grievances.module';
import { AlumniModule } from './modules/alumni/alumni.module';

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
    CrewModule,
    AttendanceModule,
    StaffAttendanceModule,
    StaffLeaveModule,
    TimetableModule,
    AcademicsModule,
    SubstitutesModule,
    PayrollModule,
    FeesModule,
    LibraryModule,
    AccountsModule,
    InventoryModule,
    ExamsModule,
    QuizzesModule,
    TransportModule,
    TrackingModule,
    DashboardModule,
    PerformanceModule,
    FeedbackModule,
    EmergencyModule,
    SurveysModule,
    AppraisalsModule,
    AchievementsModule,
    AppBannersModule,
    MeetingsModule,
    DiaryModule,
    AnnouncementsModule,
    EventsModule,
    ChatModule,
    RealtimeModule,
    MobileModule,
    FleetModule,
    FleetOpsModule,
    GateModule,
    AccessModule,
    UsersModule,
    AuthModule,
    NotificationsModule,
    FilesModule,
    JobsModule,
    GrievancesModule,
    AlumniModule,
  ],
  providers: [
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: YearContextInterceptor },
  ],
})
export class AppModule {}
