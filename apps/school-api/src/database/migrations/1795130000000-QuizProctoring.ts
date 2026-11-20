import { MigrationInterface, QueryRunner } from 'typeorm';

export class QuizProctoring1795130000000 implements MigrationInterface {
  name = 'QuizProctoring1795130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "online_quizzes"
      ADD COLUMN IF NOT EXISTS "expire_on_exit" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "require_camera" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "require_microphone" boolean NOT NULL DEFAULT false;
    `);

    await queryRunner.query(`
      ALTER TABLE "quiz_submissions"
      ADD COLUMN IF NOT EXISTS "exit_terminated" boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "quiz_submissions"
      DROP COLUMN IF EXISTS "exit_terminated";
    `);

    await queryRunner.query(`
      ALTER TABLE "online_quizzes"
      DROP COLUMN IF EXISTS "require_microphone",
      DROP COLUMN IF EXISTS "require_camera",
      DROP COLUMN IF EXISTS "expire_on_exit";
    `);
  }
}

