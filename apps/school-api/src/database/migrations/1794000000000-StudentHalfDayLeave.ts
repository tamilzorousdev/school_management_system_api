import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentHalfDayLeave1794000000000 implements MigrationInterface {
  name = 'StudentHalfDayLeave1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "student_leave_requests" ADD COLUMN IF NOT EXISTS "half_day" varchar(10)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "student_leave_requests" DROP COLUMN IF EXISTS "half_day"`);
  }
}
