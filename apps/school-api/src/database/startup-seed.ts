import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { dbConfig, DbConfig } from '../config/configuration';
import { seedCatalog } from './seeds/seed-helpers';

@Injectable()
export class StartupSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger('StartupSeed');

  constructor(
    private readonly dataSource: DataSource,
    @Inject(dbConfig.KEY) private readonly db: DbConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const pending = await this.dataSource.showMigrations().catch(() => false);
    if (pending) this.logger.warn('There are migrations not run yet. Set DB_MIGRATE_ON_START=true or run them.');
    if (!this.db.seedOnStart) return;
    await this.dataSource.transaction((manager) => seedCatalog(manager));
    this.logger.log('Roles, permissions and notification templates are up to date');
  }
}
