import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditsService } from './audits.service';
import { CatalogueService } from './catalogue.service';
import { CirculationService } from './circulation.service';
import { Book, BookCategory, BookCopy } from './entities/book.entity';
import { LibraryFine, LibraryFinePayment } from './entities/library-fine.entity';
import { LibraryCopyEvent, LibraryFollowUp, LibraryIssue, LibraryReminder } from './entities/library-issue.entity';
import { LibraryMember } from './entities/library-member.entity';
import { LibrarySettings } from './entities/library-settings.entity';
import { LibraryStockAudit, LibraryStockAuditItem, LibraryVisit } from './entities/library-visit.entity';
import { FinesService } from './fines.service';
import { LibraryAlertsService } from './library-alerts.service';
import {
  LibraryCatalogueController,
  LibraryCirculationController,
  LibraryDeskController,
  PersonLibraryController,
} from './library.controller';
import { LibraryNotifyService } from './library-notify.service';
import { LibraryReadService } from './library-read.service';
import { LibrarySettingsService } from './library-settings.service';
import { MembersService } from './members.service';
import { ReportsService } from './reports.service';
import { VisitsService } from './visits.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LibrarySettings,
      BookCategory,
      Book,
      BookCopy,
      LibraryMember,
      LibraryIssue,
      LibraryFollowUp,
      LibraryReminder,
      LibraryCopyEvent,
      LibraryFine,
      LibraryFinePayment,
      LibraryVisit,
      LibraryStockAudit,
      LibraryStockAuditItem,
    ]),
  ],
  controllers: [
    LibraryCatalogueController,
    LibraryCirculationController,
    LibraryDeskController,
    PersonLibraryController,
  ],
  providers: [
    LibrarySettingsService,
    LibraryReadService,
    LibraryNotifyService,
    CatalogueService,
    MembersService,
    CirculationService,
    FinesService,
    VisitsService,
    AuditsService,
    ReportsService,
    LibraryAlertsService,
  ],
  exports: [MembersService, CatalogueService, LibraryReadService],
})
export class LibraryModule {}
