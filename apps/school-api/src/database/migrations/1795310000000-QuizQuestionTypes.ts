import { MigrationInterface, QueryRunner } from 'typeorm';

export class QuizQuestionTypes1795310000000 implements MigrationInterface {
  name = 'QuizQuestionTypes1795310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quiz_questions" ADD COLUMN IF NOT EXISTS "question_type" character varying(20) NOT NULL DEFAULT 'single_choice'`,
    );
    await queryRunner.query(`ALTER TABLE "quiz_questions" ALTER COLUMN "correct_option" TYPE character varying(20)`);
    await queryRunner.query(`ALTER TABLE "quiz_answers" ALTER COLUMN "selected_option" TYPE character varying(20)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "quiz_answers" ALTER COLUMN "selected_option" TYPE character varying(10)`);
    await queryRunner.query(`ALTER TABLE "quiz_questions" ALTER COLUMN "correct_option" TYPE character varying(10)`);
    await queryRunner.query(`ALTER TABLE "quiz_questions" DROP COLUMN IF EXISTS "question_type"`);
  }
}
