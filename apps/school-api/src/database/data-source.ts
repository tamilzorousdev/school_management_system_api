import 'dotenv/config';
import { join } from 'path';
import { DataSource } from 'typeorm';

const root = join(__dirname, '..', '..', '..', '..');

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true',
  entities: [join(root, '{apps,libs}', '**', 'entities', '*.entity{.ts,.js}').replace(/\\/g, '/')],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}').replace(/\\/g, '/')],
});
