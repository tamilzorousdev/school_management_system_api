import { join } from 'path';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreatedBySubscriber } from '@app/common';
import { dbConfig, DbConfig } from '../config/configuration';
import { StartupSeed } from './startup-seed';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [dbConfig.KEY],
      useFactory: (db: DbConfig) => ({
        type: 'postgres',
        host: db.host,
        port: db.port,
        username: db.username,
        password: db.password,
        database: db.database,
        ssl: db.ssl,
        extra: { max: db.poolSize },
        autoLoadEntities: true,
        synchronize: false,
        migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
        migrationsRun: db.migrateOnStart,
      }),
    }),
  ],
  providers: [CreatedBySubscriber, StartupSeed],
})
export class DatabaseModule {}
