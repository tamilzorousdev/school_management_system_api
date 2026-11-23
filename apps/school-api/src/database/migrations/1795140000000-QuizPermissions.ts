import { MigrationInterface, QueryRunner } from 'typeorm';

export class QuizPermissions1795140000000 implements MigrationInterface {
  name = 'QuizPermissions1795140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quiz_permissions" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "allow_all_teachers" boolean NOT NULL DEFAULT false,
        "permitted_user_ids" integer[] NOT NULL DEFAULT '{}',
        "updated_by" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quiz_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_quiz_permissions_school" UNIQUE ("school_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_quiz_permissions_school" ON "quiz_permissions" ("school_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "quiz_permissions"`);
  }
}
