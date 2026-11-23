import { MigrationInterface, QueryRunner } from 'typeorm';

export class QuizOptionalPassMarks1795320000000 implements MigrationInterface {
  name = 'QuizOptionalPassMarks1795320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "online_quizzes" ALTER COLUMN "pass_marks" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "online_quizzes" ALTER COLUMN "pass_marks" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "quiz_submissions" ALTER COLUMN "passed" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "quiz_submissions" ALTER COLUMN "passed" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "quiz_submissions" SET "passed" = false WHERE "passed" IS NULL`);
    await queryRunner.query(`ALTER TABLE "quiz_submissions" ALTER COLUMN "passed" SET DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "quiz_submissions" ALTER COLUMN "passed" SET NOT NULL`);
    await queryRunner.query(`UPDATE "online_quizzes" SET "pass_marks" = 0 WHERE "pass_marks" IS NULL`);
    await queryRunner.query(`ALTER TABLE "online_quizzes" ALTER COLUMN "pass_marks" SET DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "online_quizzes" ALTER COLUMN "pass_marks" SET NOT NULL`);
  }
}
