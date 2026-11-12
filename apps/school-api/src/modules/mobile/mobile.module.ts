import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { AppBannersModule } from '../app-banners/app-banners.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExamsModule } from '../exams/exams.module';
import { FeesModule } from '../fees/fees.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { DiaryModule } from '../diary/diary.module';
import { ChatModule } from '../chat/chat.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { StaffModule } from '../staff/staff.module';
import { StaffAttendanceModule } from '../staff-attendance/staff-attendance.module';
import { StaffLeaveModule } from '../staff-leave/staff-leave.module';
import { StudentLifecycleModule } from '../student-lifecycle/student-lifecycle.module';
import { StudentRecordsModule } from '../student-records/student-records.module';
import { StudentsModule } from '../students/students.module';
import { SubstitutesModule } from '../substitutes/substitutes.module';
import { TimetableModule } from '../timetable/timetable.module';
import { TrackingModule } from '../tracking/tracking.module';
import { TransportModule } from '../transport/transport.module';
import { MobileAccessService } from './mobile-access.service';
import { MobileParentMeetingsController, MobileTeacherMeetingsController } from './mobile-meetings.controller';
import {
  MobileParentMeetingRecordsController,
  MobileTeacherMeetingRecordsController,
} from './mobile-meeting-records.controller';
import { MobileParentDiaryController, MobileTeacherDiaryController } from './mobile-diary.controller';
import { MobileParentChatController, MobileTeacherChatController } from './mobile-chat.controller';
import { MobileParentAttendanceController, MobileTeacherAttendanceController } from './mobile-attendance.controller';
import { MobileParentChildController, MobileTeacherController } from './mobile.controller';
import {
  MobileParentAchievementsController,
  MobileParentBannerController,
  MobileTeacherAppController,
} from './mobile-teacher-app.controller';
import { BannerService } from './banner.service';
import { ParentPreviewController } from './parent-preview.controller';
import { ParentPreviewService } from './parent-preview.service';
import { TeacherAppService } from './teacher-app.service';
import { ParentTeachersService } from './parent-teachers.service';
import { TeacherInsightsService } from './teacher-insights.service';
import { TeacherPreviewController } from './teacher-preview.controller';
import { TeacherPreviewService } from './teacher-preview.service';

@Module({
  imports: [
    AppBannersModule,
    StudentsModule,
    StudentRecordsModule,
    StudentLifecycleModule,
    StaffModule,
    AttendanceModule,
    StaffAttendanceModule,
    StaffLeaveModule,
    TimetableModule,
    SubstitutesModule,
    TransportModule,
    TrackingModule,
    AchievementsModule,
    ExamsModule,
    FeesModule,
    MeetingsModule,
    DiaryModule,
    ChatModule,
    AnnouncementsModule,
  ],
  controllers: [
    MobileParentChildController,
    MobileTeacherController,
    MobileParentAttendanceController,
    MobileTeacherAttendanceController,
    MobileTeacherAppController,
    MobileParentAchievementsController,
    MobileParentBannerController,
    MobileTeacherMeetingsController,
    MobileParentMeetingsController,
    MobileTeacherMeetingRecordsController,
    MobileParentMeetingRecordsController,
    MobileTeacherDiaryController,
    MobileParentDiaryController,
    MobileTeacherChatController,
    MobileParentChatController,
    ParentPreviewController,
    TeacherPreviewController,
  ],
  providers: [
    MobileAccessService,
    ParentTeachersService,
    TeacherAppService,
    TeacherInsightsService,
    BannerService,
    ParentPreviewService,
    TeacherPreviewService,
  ],
  exports: [MobileAccessService],
})
export class MobileModule {}
