import { MigrationInterface, QueryRunner } from 'typeorm';

export class BellSpecialSlots1794510000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bell_periods" ADD "is_special" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bell_periods" DROP COLUMN "is_special"`);
  }
}
