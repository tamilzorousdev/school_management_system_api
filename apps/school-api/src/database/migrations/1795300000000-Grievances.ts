import { MigrationInterface, QueryRunner } from 'typeorm';

export class Grievances1795300000000 implements MigrationInterface {
  name = 'Grievances1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "grievances" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL,
        "ticket_no" character varying(30) NOT NULL,
        "complainant_type" character varying(20) NOT NULL,
        "complainant_user_id" integer,
        "complainant_name" character varying(150),
        "complainant_mobile" character varying(20),
        "student_id" integer,
        "category" character varying(30) NOT NULL,
        "subcategory" character varying(100),
        "priority" character varying(20) NOT NULL,
        "is_anonymous" boolean NOT NULL DEFAULT false,
        "subject" character varying(200) NOT NULL,
        "description" text NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'submitted',
        "assigned_to_user_id" integer,
        "assigned_at" TIMESTAMP WITH TIME ZONE,
        "sla_due_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "escalated_at" TIMESTAMP WITH TIME ZONE,
        "escalation_reason" text,
        "resolution_summary" text,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "satisfaction_rating" smallint,
        "linked_entity_type" character varying(50),
        "linked_entity_id" integer,
        "linked_entity_label" character varying(150),
        CONSTRAINT "PK_grievances_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_grievances_school_ticket" ON "grievances" ("school_id", "ticket_no") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_grievances_school_status" ON "grievances" ("school_id", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_grievances_school_category" ON "grievances" ("school_id", "category")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_grievances_school_assigned" ON "grievances" ("school_id", "assigned_to_user_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_grievances_school_sla" ON "grievances" ("school_id", "sla_due_at")`);

    await queryRunner.query(
      `CREATE TABLE "grievance_timeline" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "school_id" integer NOT NULL,
        "grievance_id" integer NOT NULL,
        "actor_user_id" integer,
        "actor_name" character varying(150),
        "actor_role" character varying(50),
        "action" character varying(50) NOT NULL,
        "from_status" character varying(20),
        "to_status" character varying(20),
        "message" text NOT NULL,
        "is_internal" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_grievance_timeline_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_grievance_timeline_grievance" ON "grievance_timeline" ("grievance_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_grievance_timeline_school" ON "grievance_timeline" ("school_id")`);

    await queryRunner.query(
      `CREATE TABLE "grievance_attachments" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "school_id" integer NOT NULL,
        "grievance_id" integer NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "file_url" text NOT NULL,
        "file_size" integer,
        "mime_type" character varying(100),
        "is_internal" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_grievance_attachments_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_grievance_attachments_grievance" ON "grievance_attachments" ("grievance_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_grievance_attachments_school" ON "grievance_attachments" ("school_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_grievance_attachments_school"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_grievance_attachments_grievance"`);
    await queryRunner.query(`DROP TABLE "grievance_attachments"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_grievance_timeline_school"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_grievance_timeline_grievance"`);
    await queryRunner.query(`DROP TABLE "grievance_timeline"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_grievances_school_sla"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_grievances_school_assigned"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_grievances_school_category"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_grievances_school_status"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_grievances_school_ticket"`);
    await queryRunner.query(`DROP TABLE "grievances"`);
  }
}
