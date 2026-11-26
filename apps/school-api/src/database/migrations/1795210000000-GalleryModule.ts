import { MigrationInterface, QueryRunner } from 'typeorm';

export class GalleryModule1795210000000 implements MigrationInterface {
  name = 'GalleryModule1795210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "gallery_settings" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "is_enabled" boolean NOT NULL DEFAULT true, "app_gallery_enabled" boolean NOT NULL DEFAULT true, "class_gallery_enabled" boolean NOT NULL DEFAULT true, "section_gallery_enabled" boolean NOT NULL DEFAULT true, "videos_enabled" boolean NOT NULL DEFAULT true, "downloads_enabled" boolean NOT NULL DEFAULT true, "sharing_enabled" boolean NOT NULL DEFAULT true, "slideshow_enabled" boolean NOT NULL DEFAULT true, "download_audit_enabled" boolean NOT NULL DEFAULT false, "default_visibility" character varying(10) NOT NULL DEFAULT 'everyone', "upload_roles" character varying(20) array NOT NULL DEFAULT '{TEACHER,HOD}', "teachers_delete_own" boolean NOT NULL DEFAULT true, "storage_quota_mb" integer NOT NULL DEFAULT '20480', "storage_warning_percent" smallint NOT NULL DEFAULT '80', "max_image_mb" smallint NOT NULL DEFAULT '10', "max_video_mb" smallint NOT NULL DEFAULT '100', "max_video_seconds" integer NOT NULL DEFAULT '300', "max_files_per_upload" smallint NOT NULL DEFAULT '20', "image_formats" character varying(10) array NOT NULL DEFAULT '{jpeg,png,webp}', "video_formats" character varying(10) array NOT NULL DEFAULT '{mp4,mov,webm,3gp}', "image_quality" smallint NOT NULL DEFAULT '82', "image_max_side" smallint NOT NULL DEFAULT '2048', "thumbnail_side" smallint NOT NULL DEFAULT '400', "cleanup_enabled" boolean NOT NULL DEFAULT true, "cleanup_paused" boolean NOT NULL DEFAULT false, "retention_value" smallint NOT NULL DEFAULT '1', "retention_unit" character varying(6) NOT NULL DEFAULT 'years', "cleanup_frequency" character varying(7) NOT NULL DEFAULT 'daily', "cleanup_time" character varying(5) NOT NULL DEFAULT '02:00', "cleanup_weekday" smallint NOT NULL DEFAULT '1', "cleanup_month_day" smallint NOT NULL DEFAULT '1', "time_zone" character varying(40) NOT NULL DEFAULT 'Asia/Kolkata', "notice_days" smallint NOT NULL DEFAULT '30', "recovery_days" smallint NOT NULL DEFAULT '30', "auto_trash_enabled" boolean NOT NULL DEFAULT true, "permanent_delete_enabled" boolean NOT NULL DEFAULT true, "delete_empty_albums" boolean NOT NULL DEFAULT true, "purge_orphans" boolean NOT NULL DEFAULT true, "purge_stale_uploads" boolean NOT NULL DEFAULT true, "notify_in_app" boolean NOT NULL DEFAULT true, "notify_email" boolean NOT NULL DEFAULT false, "notify_roles" character varying(20) array NOT NULL DEFAULT '{ADMIN,PRINCIPAL}', "next_cleanup_at" TIMESTAMP WITH TIME ZONE, "last_cleanup_at" TIMESTAMP WITH TIME ZONE, "storage_alert_level" character varying(8), "updated_by" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1560fd9abfffec0c4e7169a78f2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_gallery_settings_school" ON "gallery_settings" ("school_id")`);
    await queryRunner.query(
      `CREATE TABLE "gallery_categories" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "key" character varying(30), "name" character varying(60) NOT NULL, "sort_order" smallint NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_85c0fc17e5f18a28d9ff2a97f2a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_2762bab89c0b2b18390c125360" ON "gallery_categories" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_gallery_categories_school_name" ON "gallery_categories" ("school_id", "name") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "gallery_albums" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "scope" character varying(7) NOT NULL, "class_id" integer, "section_id" integer, "category_id" integer, "title" character varying(150) NOT NULL, "description" text, "event_date" date, "tags" character varying(40) array NOT NULL DEFAULT '{}', "visibility" character varying(10) NOT NULL DEFAULT 'everyone', "class_ids" integer array, "section_ids" integer array, "status" character varying(10) NOT NULL DEFAULT 'draft', "is_featured" boolean NOT NULL DEFAULT false, "allow_download" boolean NOT NULL DEFAULT true, "cover_media_id" integer, "published_at" TIMESTAMP WITH TIME ZONE, "archived_at" TIMESTAMP WITH TIME ZONE, "deleted_reason" character varying(20), "deleted_by" integer, "purge_after" TIMESTAMP WITH TIME ZONE, "updated_by" integer, CONSTRAINT "PK_fe2edc1b9abda19559a9bf1df8d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ad9cc5e308fb4b415f913dffeb" ON "gallery_albums" ("school_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_gallery_albums_section" ON "gallery_albums" ("section_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_gallery_albums_class" ON "gallery_albums" ("class_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_albums_school_year_scope" ON "gallery_albums" ("school_id", "academic_year_id", "scope", "status")`,
    );
    await queryRunner.query(
      `CREATE TABLE "gallery_media" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "album_id" integer NOT NULL, "media_type" character varying(5) NOT NULL, "title" character varying(150), "description" character varying(1000), "original_name" character varying(255) NOT NULL, "storage_key" character varying(255) NOT NULL, "thumbnail_key" character varying(255), "mime_type" character varying(60) NOT NULL, "size_bytes" integer NOT NULL, "thumbnail_bytes" integer NOT NULL DEFAULT '0', "width" integer, "height" integer, "duration_seconds" integer, "content_hash" character(64) NOT NULL, "upload_session_id" integer, "sort_order" integer NOT NULL DEFAULT '0', "status" character varying(16) NOT NULL DEFAULT 'active', "expires_at" TIMESTAMP WITH TIME ZONE, "retention_source" character varying(40) NOT NULL DEFAULT 'default', "trash_at" TIMESTAMP WITH TIME ZONE, "notice_sent_at" TIMESTAMP WITH TIME ZONE, "deleted_reason" character varying(20), "deleted_by" integer, "purge_after" TIMESTAMP WITH TIME ZONE, "metadata" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_82fc6c612ce8d34fa6e50b8dbc4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_a6317ac850837cf722da6225d7" ON "gallery_media" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_gallery_media_album_hash" ON "gallery_media" ("album_id", "content_hash") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_media_school_purge" ON "gallery_media" ("school_id", "purge_after")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_media_school_expires" ON "gallery_media" ("school_id", "expires_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_media_school_trash_at" ON "gallery_media" ("school_id", "status", "trash_at")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_gallery_media_album" ON "gallery_media" ("album_id", "status")`);
    await queryRunner.query(
      `CREATE TABLE "gallery_retention_policies" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(80) NOT NULL, "target" character varying(14) NOT NULL, "album_id" integer, "category_id" integer, "academic_year_id" integer, "scope" character varying(7), "media_type" character varying(5), "retention_value" smallint, "retention_unit" character varying(6), "keep_forever" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_4a553535cd646fb5e0c8b066860" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_237a2a0421deee15f385603b2f" ON "gallery_retention_policies" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "gallery_retention_holds" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "album_id" integer, "media_id" integer, "reason" character varying(300) NOT NULL, "keep_until" date, "applied_by" integer NOT NULL, "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL, "released_by" integer, "released_at" TIMESTAMP WITH TIME ZONE, "release_reason" character varying(300), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4744455423a0f2454e24a113edd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_retention_holds_school" ON "gallery_retention_holds" ("school_id", "released_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_retention_holds_media" ON "gallery_retention_holds" ("media_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_retention_holds_album" ON "gallery_retention_holds" ("album_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "gallery_cleanup_jobs" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "trigger" character varying(8) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'running', "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "finished_at" TIMESTAMP WITH TIME ZONE, "duration_ms" integer, "scanned" integer NOT NULL DEFAULT '0', "marked" integer NOT NULL DEFAULT '0', "unmarked" integer NOT NULL DEFAULT '0', "trashed" integer NOT NULL DEFAULT '0', "purged" integer NOT NULL DEFAULT '0', "failed" integer NOT NULL DEFAULT '0', "held" integer NOT NULL DEFAULT '0', "albums_trashed" integer NOT NULL DEFAULT '0', "albums_purged" integer NOT NULL DEFAULT '0', "orphans_removed" integer NOT NULL DEFAULT '0', "uploads_cleared" integer NOT NULL DEFAULT '0', "bytes_reclaimed" bigint NOT NULL DEFAULT '0', "storage_bytes_after" bigint, "error" text, "triggered_by" integer, "retry_of_job_id" integer, CONSTRAINT "PK_8e161220f51ed343f62381e0b5f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_gallery_cleanup_jobs_running" ON "gallery_cleanup_jobs" ("school_id") WHERE status = 'running'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_cleanup_jobs_school_started" ON "gallery_cleanup_jobs" ("school_id", "started_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "gallery_cleanup_job_items" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "job_id" integer NOT NULL, "media_id" integer, "album_id" integer, "action" character varying(14) NOT NULL, "name" character varying(255), "size_bytes" integer NOT NULL DEFAULT '0', "error" character varying(500), "retried_job_id" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0d4ce7d6fc11f5b95c201c5941a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_cleanup_job_items_school" ON "gallery_cleanup_job_items" ("school_id", "action", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_cleanup_job_items_job" ON "gallery_cleanup_job_items" ("job_id", "action")`,
    );
    await queryRunner.query(
      `CREATE TABLE "gallery_upload_sessions" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "album_id" integer NOT NULL, "total" smallint NOT NULL DEFAULT '0', "accepted" smallint NOT NULL DEFAULT '0', "duplicates" smallint NOT NULL DEFAULT '0', "failed" smallint NOT NULL DEFAULT '0', "bytes" bigint NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'completed', "results" jsonb NOT NULL DEFAULT '[]', "orphan_keys" text array NOT NULL DEFAULT '{}', CONSTRAINT "PK_82e07f40269ba976c7fcc3b6a50" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_a49ecef30ec223af102398dce7" ON "gallery_upload_sessions" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_upload_sessions_school" ON "gallery_upload_sessions" ("school_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "gallery_audit_logs" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "user_id" integer, "user_name" character varying(150), "user_role" character varying(40), "action" character varying(40) NOT NULL, "album_id" integer, "media_id" integer, "class_id" integer, "section_id" integer, "result" character varying(8) NOT NULL DEFAULT 'success', "details" jsonb NOT NULL DEFAULT '{}', "ip" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1f09e98edc14715ad46dfe3d6c6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_audit_logs_school_action" ON "gallery_audit_logs" ("school_id", "action")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gallery_audit_logs_school_created" ON "gallery_audit_logs" ("school_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_albums" ADD CONSTRAINT "FK_6468c131bef098dae06fefd0d79" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_albums" ADD CONSTRAINT "FK_f49fca62dca4b5032620c767b32" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_albums" ADD CONSTRAINT "FK_92fb3c73ebc551c34e4cedca439" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_albums" ADD CONSTRAINT "FK_f74d947853ce6d897ce0035b4ff" FOREIGN KEY ("category_id") REFERENCES "gallery_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_media" ADD CONSTRAINT "FK_09e06e362f4573bf863aa5e72fe" FOREIGN KEY ("album_id") REFERENCES "gallery_albums"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_retention_policies" ADD CONSTRAINT "FK_c8a13926307c118459a6d5d34a2" FOREIGN KEY ("album_id") REFERENCES "gallery_albums"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_retention_holds" ADD CONSTRAINT "FK_7f75d49ddfd7851efd25e8041f5" FOREIGN KEY ("album_id") REFERENCES "gallery_albums"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_retention_holds" ADD CONSTRAINT "FK_05306ec2afaa37bdc3f2025aa90" FOREIGN KEY ("media_id") REFERENCES "gallery_media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_upload_sessions" ADD CONSTRAINT "FK_294b92ecd516dcecf6d848471ed" FOREIGN KEY ("album_id") REFERENCES "gallery_albums"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_albums" ADD CONSTRAINT "CHK_gallery_albums_scope" CHECK ("scope" IN ('school', 'class', 'section'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_albums" ADD CONSTRAINT "CHK_gallery_albums_status" CHECK ("status" IN ('draft', 'published', 'archived'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_albums" ADD CONSTRAINT "CHK_gallery_albums_visibility" CHECK ("visibility" IN ('everyone', 'staff', 'parents', 'classes'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_albums" ADD CONSTRAINT "CHK_gallery_albums_place" CHECK (("scope" = 'school' AND "class_id" IS NULL AND "section_id" IS NULL) OR ("scope" = 'class' AND "class_id" IS NOT NULL AND "section_id" IS NULL) OR ("scope" = 'section' AND "class_id" IS NOT NULL AND "section_id" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_media" ADD CONSTRAINT "CHK_gallery_media_type" CHECK ("media_type" IN ('image', 'video'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_media" ADD CONSTRAINT "CHK_gallery_media_status" CHECK ("status" IN ('active', 'pending_deletion'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_media" ADD CONSTRAINT "CHK_gallery_media_size" CHECK ("size_bytes" >= 0 AND "thumbnail_bytes" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_retention_policies" ADD CONSTRAINT "CHK_gallery_retention_policies_target" CHECK ("target" IN ('album', 'archived', 'category', 'academic_year', 'scope', 'media_type'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_retention_policies" ADD CONSTRAINT "CHK_gallery_retention_policies_period" CHECK ("keep_forever" OR ("retention_value" > 0 AND "retention_unit" IN ('days', 'months', 'years')))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_gallery_retention_policies_target" ON "gallery_retention_policies" ("school_id", "target", COALESCE("album_id", 0), COALESCE("category_id", 0), COALESCE("academic_year_id", 0), COALESCE("scope", ''), COALESCE("media_type", '')) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_retention_holds" ADD CONSTRAINT "CHK_gallery_retention_holds_target" CHECK (("album_id" IS NULL) <> ("media_id" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_cleanup_jobs" ADD CONSTRAINT "CHK_gallery_cleanup_jobs_trigger" CHECK ("trigger" IN ('schedule', 'manual', 'retry'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_cleanup_jobs" ADD CONSTRAINT "CHK_gallery_cleanup_jobs_status" CHECK ("status" IN ('running', 'completed', 'partial', 'failed'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_settings" ADD CONSTRAINT "CHK_gallery_settings_retention" CHECK ("retention_value" > 0 AND "retention_unit" IN ('days', 'months', 'years'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "gallery_settings" ADD CONSTRAINT "CHK_gallery_settings_frequency" CHECK ("cleanup_frequency" IN ('daily', 'weekly', 'monthly'))`,
    );
    await queryRunner.query(
      `CREATE FUNCTION gallery_audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'gallery_audit_logs rows cannot be changed or deleted'; END $$`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "TRG_gallery_audit_logs_append_only" BEFORE UPDATE OR DELETE ON "gallery_audit_logs" FOR EACH ROW EXECUTE FUNCTION gallery_audit_logs_append_only()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "TRG_gallery_audit_logs_append_only" ON "gallery_audit_logs"`);
    await queryRunner.query(`DROP FUNCTION gallery_audit_logs_append_only()`);
    await queryRunner.query(`DROP INDEX "public"."UQ_gallery_retention_policies_target"`);
    await queryRunner.query(`ALTER TABLE "gallery_upload_sessions" DROP CONSTRAINT "FK_294b92ecd516dcecf6d848471ed"`);
    await queryRunner.query(`ALTER TABLE "gallery_retention_holds" DROP CONSTRAINT "FK_05306ec2afaa37bdc3f2025aa90"`);
    await queryRunner.query(`ALTER TABLE "gallery_retention_holds" DROP CONSTRAINT "FK_7f75d49ddfd7851efd25e8041f5"`);
    await queryRunner.query(
      `ALTER TABLE "gallery_retention_policies" DROP CONSTRAINT "FK_c8a13926307c118459a6d5d34a2"`,
    );
    await queryRunner.query(`ALTER TABLE "gallery_media" DROP CONSTRAINT "FK_09e06e362f4573bf863aa5e72fe"`);
    await queryRunner.query(`ALTER TABLE "gallery_albums" DROP CONSTRAINT "FK_f74d947853ce6d897ce0035b4ff"`);
    await queryRunner.query(`ALTER TABLE "gallery_albums" DROP CONSTRAINT "FK_92fb3c73ebc551c34e4cedca439"`);
    await queryRunner.query(`ALTER TABLE "gallery_albums" DROP CONSTRAINT "FK_f49fca62dca4b5032620c767b32"`);
    await queryRunner.query(`ALTER TABLE "gallery_albums" DROP CONSTRAINT "FK_6468c131bef098dae06fefd0d79"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_audit_logs_school_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_audit_logs_school_action"`);
    await queryRunner.query(`DROP TABLE "gallery_audit_logs"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_upload_sessions_school"`);
    await queryRunner.query(`DROP TABLE "gallery_upload_sessions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_cleanup_job_items_job"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_cleanup_job_items_school"`);
    await queryRunner.query(`DROP TABLE "gallery_cleanup_job_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_cleanup_jobs_school_started"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_gallery_cleanup_jobs_running"`);
    await queryRunner.query(`DROP TABLE "gallery_cleanup_jobs"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_retention_holds_album"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_retention_holds_media"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_retention_holds_school"`);
    await queryRunner.query(`DROP TABLE "gallery_retention_holds"`);
    await queryRunner.query(`DROP TABLE "gallery_retention_policies"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_media_album"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_media_school_trash_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_media_school_expires"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_media_school_purge"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_gallery_media_album_hash"`);
    await queryRunner.query(`DROP TABLE "gallery_media"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_albums_school_year_scope"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_albums_class"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_gallery_albums_section"`);
    await queryRunner.query(`DROP TABLE "gallery_albums"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_gallery_categories_school_name"`);
    await queryRunner.query(`DROP TABLE "gallery_categories"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_gallery_settings_school"`);
    await queryRunner.query(`DROP TABLE "gallery_settings"`);
  }
}
