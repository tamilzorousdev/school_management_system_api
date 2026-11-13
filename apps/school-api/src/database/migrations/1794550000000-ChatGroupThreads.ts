import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatGroupThreads1794550000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_threads" ALTER COLUMN "teacher_user_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ALTER COLUMN "parent_user_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ALTER COLUMN "student_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ADD "is_group" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ADD "title" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ADD "created_by_user_id" integer`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_chat_threads_pair"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_chat_threads_pair" ON "chat_threads" ("academic_year_id", "teacher_user_id", "parent_user_id", "student_id") WHERE deleted_at IS NULL AND is_group = false`,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_group_members" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "thread_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "role" character varying(20) NOT NULL DEFAULT 'member',
        "unread_count" integer NOT NULL DEFAULT 0,
        "cleared_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_group_members" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_chat_group_members_thread" ON "chat_group_members" ("thread_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_chat_group_members_user" ON "chat_group_members" ("user_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_chat_group_members_thread_user" ON "chat_group_members" ("thread_id", "user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_group_members"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_chat_threads_pair"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_chat_threads_pair" ON "chat_threads" ("academic_year_id", "teacher_user_id", "parent_user_id", "student_id") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "chat_threads" DROP COLUMN IF EXISTS "created_by_user_id"`);
    await queryRunner.query(`ALTER TABLE "chat_threads" DROP COLUMN IF EXISTS "title"`);
    await queryRunner.query(`ALTER TABLE "chat_threads" DROP COLUMN IF EXISTS "is_group"`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ALTER COLUMN "student_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ALTER COLUMN "parent_user_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ALTER COLUMN "teacher_user_id" SET NOT NULL`);
  }
}
