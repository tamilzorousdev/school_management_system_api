import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentFeedbackEdited1795690000000 implements MigrationInterface {
  name = 'StudentFeedbackEdited1795690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "student_feedback" ADD "edited_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "student_feedback" DROP COLUMN "edited_at"`);
  }
}
