import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmergencyBroadcast1794620000000 implements MigrationInterface {
  name = 'EmergencyBroadcast1794620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "emergency_broadcasts" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "batch_id" uuid NOT NULL, "title" character varying(120) NOT NULL, "message" text NOT NULL, "title_ta" character varying(120), "message_ta" text, "category" character varying(20) NOT NULL, "severity" character varying(10) NOT NULL, "audience" character varying(10) NOT NULL, "class_ids" integer array, "section_ids" integer array, "student_ids" integer array, "include_teachers" boolean NOT NULL DEFAULT false, "channels" character varying(10) array NOT NULL, "status" character varying(16) NOT NULL, "total" integer NOT NULL DEFAULT '0', "client_id" character varying(64), "follow_up_of" integer, "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL, "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_116be3c890bc887d072b7419263" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_f0872d0fadfd2bdcf0a733d9ae" ON "emergency_broadcasts" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_emergency_broadcasts_client" ON "emergency_broadcasts" ("school_id", "client_id") WHERE client_id IS NOT NULL AND deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "emergency_recipients" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "broadcast_id" integer NOT NULL, "kind" character varying(6) NOT NULL, "user_id" integer, "guardian_id" integer, "name" character varying(150) NOT NULL, "mobile" character varying(15), "language" character varying(2) NOT NULL DEFAULT 'en', "students" jsonb NOT NULL DEFAULT '[]', "push_status" character varying(8) NOT NULL, "push_attempts" smallint NOT NULL DEFAULT '0', "push_error" character varying(255), "push_next_at" TIMESTAMP WITH TIME ZONE, "sms_status" character varying(8) NOT NULL, "sms_attempts" smallint NOT NULL DEFAULT '0', "sms_error" character varying(255), "sms_next_at" TIMESTAMP WITH TIME ZONE, "read_at" TIMESTAMP WITH TIME ZONE, "acknowledged_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c7672b1571e74164b5f40d1789d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_emergency_recipients_sms_due" ON "emergency_recipients" ("sms_status", "sms_next_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_emergency_recipients_push_due" ON "emergency_recipients" ("push_status", "push_next_at") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_emergency_recipients_user" ON "emergency_recipients" ("user_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_emergency_recipients_broadcast" ON "emergency_recipients" ("broadcast_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_emergency_recipients_broadcast"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_emergency_recipients_user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_emergency_recipients_push_due"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_emergency_recipients_sms_due"`);
    await queryRunner.query(`DROP TABLE "emergency_recipients"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_emergency_broadcasts_client"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f0872d0fadfd2bdcf0a733d9ae"`);
    await queryRunner.query(`DROP TABLE "emergency_broadcasts"`);
  }
}
