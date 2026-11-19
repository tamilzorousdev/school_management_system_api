import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmergencyStaffGroups1794750000000 implements MigrationInterface {
  name = 'EmergencyStaffGroups1794750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "emergency_broadcasts" ADD IF NOT EXISTS "staff_groups" character varying(10) array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "emergency_broadcasts" DROP COLUMN IF EXISTS "staff_groups"`);
  }
}
