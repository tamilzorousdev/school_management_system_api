import { MigrationInterface, QueryRunner } from 'typeorm';

export class SchoolSeal1793997000000 implements MigrationInterface {
  name = 'SchoolSeal1793997000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "schools"
      ADD COLUMN IF NOT EXISTS "seal_file_id" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "schools"
      DROP COLUMN IF EXISTS "seal_file_id"
    `);
  }
}
