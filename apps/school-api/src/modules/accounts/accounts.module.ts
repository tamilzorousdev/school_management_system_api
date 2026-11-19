import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeesModule } from '../fees/fees.module';
import { FilesModule } from '../files/files.module';
import { AccountsReportsService } from './accounts-reports.service';
import { AccountCategoriesController, AccountEntriesController, AccountReportsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AccountCategory } from './entities/account-category.entity';
import { AccountEntry } from './entities/account-entry.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AccountCategory, AccountEntry]), FeesModule, FilesModule],
  controllers: [AccountCategoriesController, AccountReportsController, AccountEntriesController],
  providers: [AccountsService, AccountsReportsService],
})
export class AccountsModule {}
