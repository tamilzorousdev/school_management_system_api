import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatDeleteAndMedia1794530000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "kind" character varying(10) NOT NULL DEFAULT 'text'`);
    await queryRunner.query(`UPDATE "chat_messages" SET "kind" = 'file' WHERE "file_id" IS NOT NULL`);
    await queryRunner.query(
      `UPDATE "chat_messages" m SET "kind" = 'image' FROM "files" f WHERE f.id = m.file_id AND f.mime_type LIKE 'image/%'`,
    );
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "duration_seconds" integer`);
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "deleted_for_all_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "deleted_for_all_by" integer`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ADD "teacher_cleared_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ADD "parent_cleared_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE TABLE "chat_message_hides" ("id" SERIAL NOT NULL, "message_id" integer NOT NULL, "user_id" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_chat_message_hides" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_chat_message_hides_message" ON "chat_message_hides" ("message_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_chat_message_hides_user" ON "chat_message_hides" ("user_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_chat_message_hides" ON "chat_message_hides" ("message_id", "user_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chat_message_hides"`);
    await queryRunner.query(`ALTER TABLE "chat_threads" DROP COLUMN "parent_cleared_at"`);
    await queryRunner.query(`ALTER TABLE "chat_threads" DROP COLUMN "teacher_cleared_at"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "deleted_for_all_by"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "deleted_for_all_at"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "duration_seconds"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "kind"`);
  }
}
