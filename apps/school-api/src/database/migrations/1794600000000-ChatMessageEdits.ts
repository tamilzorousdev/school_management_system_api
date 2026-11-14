import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatMessageEdits1794600000000 implements MigrationInterface {
  name = 'ChatMessageEdits1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chat_message_edits" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "message_id" integer NOT NULL, "previous_body" text, "edited_by" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_chat_message_edits" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_chat_message_edits_school" ON "chat_message_edits" ("school_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_chat_message_edits_message" ON "chat_message_edits" ("message_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_chat_message_edits_message"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_chat_message_edits_school"`);
    await queryRunner.query(`DROP TABLE "chat_message_edits"`);
  }
}
