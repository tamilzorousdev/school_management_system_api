import { CanteenDashboardController, CanteenReportsController } from './canteen-dashboard.controller';
import { CanteenDashboardService } from './canteen-dashboard.service';
import { CanteenFeedbackController } from './canteen-feedback.controller';
import { CanteenFeedbackService } from './canteen-feedback.service';
import { CanteenReportsService } from './canteen-reports.service';
import { CanteenStaffAttendanceService } from './canteen-staff-attendance.service';
import { CanteenStaffAttendanceController, CanteenStaffController } from './canteen-staff.controller';
import { CanteenStaffService } from './canteen-staff.service';
import { CanteenFeedback, CanteenStaff, CanteenStaffAttendance } from './entities/canteen-people.entity';

export const PEOPLE_PARTS = {
  entities: [CanteenStaff, CanteenStaffAttendance, CanteenFeedback],
  controllers: [
    CanteenStaffController,
    CanteenStaffAttendanceController,
    CanteenFeedbackController,
    CanteenDashboardController,
    CanteenReportsController,
  ],
  providers: [
    CanteenStaffService,
    CanteenStaffAttendanceService,
    CanteenFeedbackService,
    CanteenDashboardService,
    CanteenReportsService,
  ],
};
