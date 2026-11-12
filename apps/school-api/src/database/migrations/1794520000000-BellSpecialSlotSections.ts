import { MigrationInterface, QueryRunner } from 'typeorm';

export class BellSpecialSlotSections1794520000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bell_periods" ADD "section_ids" integer array`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bell_periods" DROP COLUMN "section_ids"`);
  }
}
