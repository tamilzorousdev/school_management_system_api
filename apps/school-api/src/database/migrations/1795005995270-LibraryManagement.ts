import { MigrationInterface, QueryRunner } from 'typeorm';

export class LibraryManagement1795005995270 implements MigrationInterface {
  name = 'LibraryManagement1795005995270';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "library_visits" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "kind" character varying(8) NOT NULL, "member_type" character varying(8) NOT NULL, "student_id" integer, "user_id" integer, "class_id" integer, "section_id" integer, "visit_date" date NOT NULL, "in_at" TIMESTAMP WITH TIME ZONE, "out_at" TIMESTAMP WITH TIME ZONE, "purpose" character varying(8) NOT NULL DEFAULT 'read', "present" boolean NOT NULL DEFAULT true, "slot_id" integer, "period_no" smallint, "marked_by" integer, CONSTRAINT "PK_3d452defcdf9a0846f50b5ed9e7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_4b743022cffa92df6724e07017" ON "library_visits" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_library_visits_period_student" ON "library_visits" ("school_id", "slot_id", "visit_date", "student_id") WHERE kind = 'period' AND deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_library_visits_school_date" ON "library_visits" ("school_id", "visit_date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "library_stock_audits" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(80) NOT NULL, "status" character varying(8) NOT NULL DEFAULT 'open', "category_id" integer, "rack" character varying(20), "closed_at" TIMESTAMP WITH TIME ZONE, "closed_by" integer, "expected_count" integer NOT NULL DEFAULT '0', "found_count" integer NOT NULL DEFAULT '0', "missing_count" integer NOT NULL DEFAULT '0', "notes" character varying(255), CONSTRAINT "PK_a0f97dd485406a8322f6579b6eb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e0ebc4e89eb6ed76bb5dce2dca" ON "library_stock_audits" ("school_id") `);
    await queryRunner.query(
      `CREATE TABLE "library_stock_audit_items" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "audit_id" integer NOT NULL, "copy_id" integer, "code" character varying(60) NOT NULL, "finding" character varying(12) NOT NULL, "scanned_by" integer, "scanned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_aa4b41a643fe4c439b09a5326e9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_library_stock_audit_items_code" ON "library_stock_audit_items" ("audit_id", "code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "library_settings" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "student_loan_days" smallint NOT NULL DEFAULT '14', "staff_loan_days" smallint NOT NULL DEFAULT '30', "student_max_books" smallint NOT NULL DEFAULT '2', "staff_max_books" smallint NOT NULL DEFAULT '5', "fine_per_day" numeric(12,2) NOT NULL DEFAULT '1', "grace_days" smallint NOT NULL DEFAULT '0', "max_fine_per_book" numeric(12,2) DEFAULT '100', "lost_processing_fee" numeric(12,2) NOT NULL DEFAULT '50', "max_renewals" smallint NOT NULL DEFAULT '1', "block_issue_above_fine" numeric(12,2) NOT NULL DEFAULT '50', "skip_holidays" boolean NOT NULL DEFAULT true, "charge_staff_fines" boolean NOT NULL DEFAULT false, "due_soon_days" smallint NOT NULL DEFAULT '2', "escalate_after_days" smallint NOT NULL DEFAULT '7', "long_overdue_days" smallint NOT NULL DEFAULT '30', "opening_time" character varying(5) NOT NULL DEFAULT '08:00', "closing_time" character varying(5) NOT NULL DEFAULT '16:30', "isbn_lookup" boolean NOT NULL DEFAULT true, "updated_by" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3d2b1db76ddbf56a837eb806049" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_library_settings_school" ON "library_settings" ("school_id") `);
    await queryRunner.query(
      `CREATE TABLE "library_members" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "member_type" character varying(8) NOT NULL, "student_id" integer, "user_id" integer, "card_no" character varying(30) NOT NULL, "max_books" smallint, "loan_days" smallint, "status" character varying(10) NOT NULL DEFAULT 'active', "status_reason" character varying(255), "joined_on" date NOT NULL, CONSTRAINT "PK_b8eba3243d67815457d61a9a8f8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_205f19bdbefbde24e0292d7c6d" ON "library_members" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_library_members_user" ON "library_members" ("school_id", "user_id") WHERE deleted_at IS NULL AND user_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_library_members_student" ON "library_members" ("school_id", "student_id") WHERE deleted_at IS NULL AND student_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_library_members_card" ON "library_members" ("school_id", "card_no") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "library_issues" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "copy_id" integer NOT NULL, "book_id" integer NOT NULL, "member_id" integer NOT NULL, "academic_year_id" integer, "class_id" integer, "section_id" integer, "purpose" character varying(10) NOT NULL DEFAULT 'personal', "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL, "due_date" date NOT NULL, "returned_at" TIMESTAMP WITH TIME ZONE, "return_condition" character varying(8), "renew_count" smallint NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'issued', "issued_by" integer, "returned_by" integer, "remarks" character varying(255), CONSTRAINT "PK_df1dc7aaa981044edbcf75a0dfc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_f6d8ff2315fea091e9eb6a4f7c" ON "library_issues" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_4327dd98414210bc38ef37a38b" ON "library_issues" ("book_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_library_issues_due" ON "library_issues" ("school_id", "status", "due_date") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_library_issues_member" ON "library_issues" ("member_id", "status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_library_issues_open_copy" ON "library_issues" ("copy_id") WHERE status = 'issued' AND deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "library_follow_ups" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "issue_id" integer NOT NULL, "member_id" integer NOT NULL, "action" character varying(20) NOT NULL, "note" character varying(500), "promised_on" date, "next_follow_up_on" date, CONSTRAINT "PK_9292352855b58cc40c18c247204" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_a10cef7226f63b349a4275b064" ON "library_follow_ups" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_library_follow_ups_issue" ON "library_follow_ups" ("issue_id") `);
    await queryRunner.query(
      `CREATE TABLE "library_reminders" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "issue_id" integer NOT NULL, "kind" character varying(20) NOT NULL, "recipients" integer NOT NULL DEFAULT '0', "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2c151fcdf86e3d4a8ba3b4e1666" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_library_reminders_issue_kind" ON "library_reminders" ("issue_id", "kind") `,
    );
    await queryRunner.query(
      `CREATE TABLE "library_copy_events" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "copy_id" integer NOT NULL, "kind" character varying(12) NOT NULL, "issue_id" integer, "member_id" integer, "note" character varying(255), "actor_id" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3614a3baf85cfded3d933ff64c8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_79e08d90b9d625910c2dbc2825" ON "library_copy_events" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_library_copy_events_copy" ON "library_copy_events" ("copy_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "library_fines" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "issue_id" integer, "member_id" integer NOT NULL, "kind" character varying(8) NOT NULL, "amount" numeric(12,2) NOT NULL DEFAULT '0', "waived" numeric(12,2) NOT NULL DEFAULT '0', "paid" numeric(12,2) NOT NULL DEFAULT '0', "balance" numeric(12,2) NOT NULL DEFAULT '0', "status" character varying(12) NOT NULL DEFAULT 'unpaid', "days_late" smallint, "reason" character varying(200) NOT NULL, "waived_by" integer, "waived_at" TIMESTAMP WITH TIME ZONE, "waive_reason" character varying(255), CONSTRAINT "PK_4a3cab067bd054bf1dfb2f1d884" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_51af17eafe9523aa1137f35d1b" ON "library_fines" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_library_fines_member" ON "library_fines" ("member_id", "status") `);
    await queryRunner.query(
      `CREATE TABLE "library_fine_payments" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "fine_id" integer NOT NULL, "member_id" integer NOT NULL, "amount" numeric(12,2) NOT NULL DEFAULT '0', "mode" character varying(15) NOT NULL, "reference" character varying(60), "receipt_no" character varying(40) NOT NULL, "paid_on" date NOT NULL, "received_by" integer, "notes" character varying(255), CONSTRAINT "PK_0103aebc64870cd362bf193f10a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_27270be2ecda7d41885ad15e73" ON "library_fine_payments" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_cb2abd498323d5245a193a57e5" ON "library_fine_payments" ("fine_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_library_fine_payments_receipt" ON "library_fine_payments" ("school_id", "receipt_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "book_categories" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(60) NOT NULL, "code" character varying(20) NOT NULL, "is_reference" boolean NOT NULL DEFAULT false, "description" character varying(255), CONSTRAINT "PK_23cd2d376c4ce915f1f5994a4a4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_b45af98ab78db0180ddb03edde" ON "book_categories" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_book_categories_school_code" ON "book_categories" ("school_id", "code") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "books" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "title" character varying(200) NOT NULL, "subtitle" character varying(200), "isbn" character varying(13), "authors" character varying(200), "publisher" character varying(120), "edition" character varying(40), "published_year" smallint, "language" character varying(30) NOT NULL DEFAULT 'English', "category_id" integer, "subject_id" integer, "pages" smallint, "rack" character varying(20), "shelf" character varying(20), "price" numeric(12,2), "cover_file_id" integer, "description" text, "keywords" character varying(200), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_f3f2f25a099d24e12545b70b022" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_bdef14085ea004c6f6b95cb441" ON "books" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_46f5b35b90175a660f99810bc9" ON "books" ("category_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_books_school_isbn" ON "books" ("school_id", "isbn") WHERE deleted_at IS NULL AND isbn IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "book_copies" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "book_id" integer NOT NULL, "accession_no" character varying(30) NOT NULL, "barcode" character varying(60) NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'available', "condition" character varying(8) NOT NULL DEFAULT 'good', "source" character varying(10) NOT NULL DEFAULT 'purchase', "vendor" character varying(120), "bill_no" character varying(40), "acquired_on" date, "price" numeric(12,2), "notes" character varying(255), CONSTRAINT "PK_f79606d3fd05df7dcce9542d438" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_08edf47990edba18c7a26e7588" ON "book_copies" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_d8c3c9e0b8d41aa149ac58f23f" ON "book_copies" ("book_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_book_copies_school_barcode" ON "book_copies" ("school_id", "barcode") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_book_copies_school_accession" ON "book_copies" ("school_id", "accession_no") WHERE deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "book_copies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "books"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "book_categories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_fine_payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_fines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_copy_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_reminders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_follow_ups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_issues"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_stock_audit_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_stock_audits"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "library_visits"`);
  }
}
