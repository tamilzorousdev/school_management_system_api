import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `"id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "school_id" integer NOT NULL`;

export class Alumni1795500000000 implements MigrationInterface {
  name = 'Alumni1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "alumni" (
        ${BASE},
        "created_by" integer,
        "alumni_no" character varying(40) NOT NULL,
        "student_id" integer,
        "source" character varying(12) NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'active',
        "first_name" character varying(60) NOT NULL,
        "last_name" character varying(60),
        "gender" character varying(10),
        "dob" date,
        "photo_file_id" integer,
        "admission_no" character varying(30),
        "admission_date" date,
        "batch_year" smallint NOT NULL,
        "left_on" date,
        "exit_type" character varying(12) NOT NULL DEFAULT 'graduated',
        "final_academic_year_id" integer,
        "final_academic_year_name" character varying(20),
        "final_class_name" character varying(30),
        "final_section_name" character varying(10),
        "final_percent" numeric(5,2),
        "final_grade" character varying(5),
        "final_result" character varying(10),
        "tc_no" character varying(40),
        "mobile" character varying(10),
        "alt_mobile" character varying(10),
        "email" character varying(120),
        "address_line" character varying(255),
        "city" character varying(80),
        "state" character varying(80),
        "pincode" character varying(10),
        "country" character varying(60),
        "linkedin_url" character varying(255),
        "contact_consent" boolean NOT NULL DEFAULT false,
        "occupation_status" character varying(20) NOT NULL DEFAULT 'unknown',
        "institution" character varying(150),
        "course" character varying(120),
        "organization" character varying(150),
        "designation" character varying(120),
        "notes" text,
        "profile_updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_alumni_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_alumni_school_id" ON "alumni" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_alumni_school_no" ON "alumni" ("school_id", "alumni_no") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_alumni_school_student" ON "alumni" ("school_id", "student_id") WHERE student_id IS NOT NULL AND deleted_at IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_alumni_school_batch" ON "alumni" ("school_id", "batch_year")`);
    await queryRunner.query(`CREATE INDEX "IDX_alumni_school_mobile" ON "alumni" ("school_id", "mobile")`);

    await queryRunner.query(
      `CREATE TABLE "alumni_academic_history" (
        ${BASE},
        "alumni_id" integer NOT NULL,
        "academic_year_name" character varying(20) NOT NULL,
        "class_name" character varying(30) NOT NULL,
        "section_name" character varying(10),
        "roll_no" smallint,
        "result" character varying(12),
        "percent" numeric(5,2),
        "grade" character varying(5),
        "source" character varying(8) NOT NULL,
        "sort_order" smallint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_alumni_academic_history_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alumni_history_alumni" ON "alumni_academic_history" ("alumni_id", "sort_order")`,
    );

    await queryRunner.query(
      `CREATE TABLE "alumni_submissions" (
        ${BASE},
        "type" character varying(12) NOT NULL,
        "alumni_id" integer,
        "status" character varying(10) NOT NULL DEFAULT 'pending',
        "payload" jsonb NOT NULL,
        "name" character varying(130) NOT NULL,
        "mobile" character varying(10),
        "reviewed_by" integer,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "review_note" character varying(255),
        "client_ip" character varying(64),
        CONSTRAINT "PK_alumni_submissions_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alumni_submissions_school_status" ON "alumni_submissions" ("school_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alumni_submissions_school_mobile" ON "alumni_submissions" ("school_id", "mobile")`,
    );

    await queryRunner.query(
      `CREATE TABLE "alumni_update_links" (
        ${BASE},
        "alumni_id" integer NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        CONSTRAINT "PK_alumni_update_links_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_alumni_update_links_hash" ON "alumni_update_links" ("token_hash")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_alumni_update_links_alumni" ON "alumni_update_links" ("alumni_id")`);

    await queryRunner.query(
      `CREATE TABLE "alumni_timeline" (
        ${BASE},
        "alumni_id" integer NOT NULL,
        "actor_user_id" integer,
        "actor_name" character varying(150),
        "action" character varying(30) NOT NULL,
        "changes" jsonb,
        "note" character varying(255),
        CONSTRAINT "PK_alumni_timeline_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alumni_timeline_alumni" ON "alumni_timeline" ("alumni_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_alumni_timeline_alumni"`);
    await queryRunner.query(`DROP TABLE "alumni_timeline"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_alumni_update_links_alumni"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_alumni_update_links_hash"`);
    await queryRunner.query(`DROP TABLE "alumni_update_links"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_alumni_submissions_school_mobile"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_alumni_submissions_school_status"`);
    await queryRunner.query(`DROP TABLE "alumni_submissions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_alumni_history_alumni"`);
    await queryRunner.query(`DROP TABLE "alumni_academic_history"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_alumni_school_mobile"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_alumni_school_batch"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_alumni_school_student"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_alumni_school_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_alumni_school_id"`);
    await queryRunner.query(`DROP TABLE "alumni"`);
  }
}
