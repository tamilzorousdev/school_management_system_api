import { MigrationInterface, QueryRunner } from 'typeorm';

export class AttendanceMode1794470000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "attendance_mode" character varying(10) NOT NULL DEFAULT 'session'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "attendance_mode"`);
  }
}
