import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventoryManagement1795079799157 implements MigrationInterface {
  name = 'InventoryManagement1795079799157';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "asset_maintenance_tickets" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "ticket_no" character varying(30) NOT NULL, "asset_id" integer NOT NULL, "kind" character varying(10) NOT NULL DEFAULT 'breakdown', "title" character varying(120) NOT NULL, "description" character varying(1000), "priority" character varying(6) NOT NULL DEFAULT 'medium', "status" character varying(11) NOT NULL DEFAULT 'open', "reported_by" integer, "assigned_to_user_id" integer, "vendor_id" integer, "under_warranty" boolean NOT NULL DEFAULT false, "cost" numeric(12,2), "parts" character varying(255), "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL, "resolved_at" TIMESTAMP WITH TIME ZONE, "resolution" character varying(1000), "schedule_id" integer, CONSTRAINT "PK_d248ec1cb9f51aa0c04d177564e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9e7d68db94a3d925b7c66f23b" ON "asset_maintenance_tickets" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_asset_maintenance_tickets_asset" ON "asset_maintenance_tickets" ("asset_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_asset_maintenance_tickets_no" ON "asset_maintenance_tickets" ("school_id", "ticket_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_maintenance_schedules" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "asset_id" integer NOT NULL, "title" character varying(120) NOT NULL, "interval_days" smallint NOT NULL, "next_due_on" date NOT NULL, "last_done_on" date, "vendor_id" integer, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_fe647e28f92ab7ee0f78992cac4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e0063ec2ae6d8a728cb2478a5" ON "asset_maintenance_schedules" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_asset_maintenance_schedules_due" ON "asset_maintenance_schedules" ("school_id", "next_due_on") `,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_items" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(120) NOT NULL, "code" character varying(30) NOT NULL, "category_id" integer NOT NULL, "unit" character varying(8) NOT NULL DEFAULT 'pcs', "reorder_level" numeric(12,2) NOT NULL DEFAULT '0', "description" character varying(255), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_52a266aa3e04b8ad1f01088f3f0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_adf8e4cba3cdabc9653c9f2c9f" ON "stock_items" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_c342d1b8e90bb3af870ef991d2" ON "stock_items" ("category_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_items_code" ON "stock_items" ("school_id", "code") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_balances" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "item_id" integer NOT NULL, "store_id" integer NOT NULL, "quantity" numeric(12,2) NOT NULL DEFAULT '0', "value" numeric(12,2) NOT NULL DEFAULT '0', CONSTRAINT "PK_4c0d249ce58f9a559eb7df31b23" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_balances_item_store" ON "stock_balances" ("item_id", "store_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_movements" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "item_id" integer NOT NULL, "store_id" integer NOT NULL, "kind" character varying(10) NOT NULL, "quantity" numeric(12,2) NOT NULL DEFAULT '0', "rate" numeric(12,2) NOT NULL DEFAULT '0', "value" numeric(12,2) NOT NULL DEFAULT '0', "balance_after" numeric(12,2) NOT NULL DEFAULT '0', "ref_type" character varying(12), "ref_id" integer, "department_id" integer, "user_id" integer, "section_id" integer, "note" character varying(255), "moved_on" date NOT NULL, CONSTRAINT "PK_57a26b190618550d8e65fb860e7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_4a4be83ff2efd97f18f4ddbc06" ON "stock_movements" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_movements_school_date" ON "stock_movements" ("school_id", "moved_on") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_movements_item" ON "stock_movements" ("item_id", "store_id", "id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_receipts" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "receipt_no" character varying(30) NOT NULL, "store_id" integer NOT NULL, "vendor_id" integer, "invoice_no" character varying(40), "invoice_date" date, "received_on" date NOT NULL, "total" numeric(12,2) NOT NULL DEFAULT '0', "notes" character varying(255), CONSTRAINT "PK_6f49d1b67edbd0e5bb63b215748" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_b483cbe950bbcfe8aaac4d1a48" ON "stock_receipts" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_receipts_no" ON "stock_receipts" ("school_id", "receipt_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_receipt_lines" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "receipt_id" integer NOT NULL, "item_id" integer NOT NULL, "quantity" numeric(12,2) NOT NULL DEFAULT '0', "rate" numeric(12,2) NOT NULL DEFAULT '0', "amount" numeric(12,2) NOT NULL DEFAULT '0', CONSTRAINT "PK_c7eef3c5225842673b4d239dbb3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_stock_receipt_lines_receipt" ON "stock_receipt_lines" ("receipt_id") `);
    await queryRunner.query(
      `CREATE TABLE "requisitions" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "requisition_no" character varying(30) NOT NULL, "store_id" integer NOT NULL, "department_id" integer, "requested_for_user_id" integer, "section_id" integer, "purpose" character varying(255) NOT NULL, "needed_by" date, "status" character varying(13) NOT NULL DEFAULT 'pending', "decided_by" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" character varying(255), "issued_at" TIMESTAMP WITH TIME ZONE, "issued_by" integer, CONSTRAINT "PK_be24649237292ddbd473f3ded92" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_084aac19aa55fc6a67067f5240" ON "requisitions" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_requisitions_no" ON "requisitions" ("school_id", "requisition_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "requisition_lines" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "requisition_id" integer NOT NULL, "item_id" integer NOT NULL, "quantity" numeric(12,2) NOT NULL DEFAULT '0', "approved_quantity" numeric(12,2), "issued_quantity" numeric(12,2) NOT NULL DEFAULT '0', CONSTRAINT "PK_ebdd4658b3ac0ecf0d6ab608c24" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_requisition_lines_requisition" ON "requisition_lines" ("requisition_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_audits" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(80) NOT NULL, "kind" character varying(6) NOT NULL, "status" character varying(6) NOT NULL DEFAULT 'open', "location_id" integer, "category_id" integer, "department_id" integer, "store_id" integer, "notes" character varying(255), "closed_at" TIMESTAMP WITH TIME ZONE, "closed_by" integer, "expected_count" integer NOT NULL DEFAULT '0', "found_count" integer NOT NULL DEFAULT '0', "missing_count" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_1d7c75be5bfbcf38b0ac1c4016f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_8b79796ac2acd055d15bed4966" ON "inventory_audits" ("school_id") `);
    await queryRunner.query(
      `CREATE TABLE "asset_audit_items" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "audit_id" integer NOT NULL, "asset_id" integer, "code" character varying(60) NOT NULL, "finding" character varying(14) NOT NULL, "found_location_id" integer, "scanned_by" integer, "scanned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f26154d2b201dc5ee12920b4176" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_asset_audit_items_code" ON "asset_audit_items" ("audit_id", "code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_count_lines" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "audit_id" integer NOT NULL, "item_id" integer NOT NULL, "system_quantity" numeric(12,2) NOT NULL DEFAULT '0', "counted_quantity" numeric(12,2), "note" character varying(255), CONSTRAINT "PK_526b5df4e6f4fa1d2408d7de772" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_count_lines_item" ON "stock_count_lines" ("audit_id", "item_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_settings" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "approve_transfers" boolean NOT NULL DEFAULT true, "approve_requisitions" boolean NOT NULL DEFAULT true, "approve_disposals" boolean NOT NULL DEFAULT true, "depreciation_method" character varying(14) NOT NULL DEFAULT 'straight_line', "warranty_alert_days" smallint NOT NULL DEFAULT '30', "maintenance_alert_days" smallint NOT NULL DEFAULT '7', "updated_by" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5c8601d134c7f679933f5903088" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_settings_school" ON "inventory_settings" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_categories" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(60) NOT NULL, "code" character varying(20) NOT NULL, "kind" character varying(6) NOT NULL, "parent_id" integer, "depreciation_rate" numeric(5,2), "useful_life_years" smallint, "maintenance_interval_days" smallint, "description" character varying(255), CONSTRAINT "PK_9903ce18e20acdba3c32c997dc7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_d4eeac9437420f76f9a9c5794a" ON "inventory_categories" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_categories_code" ON "inventory_categories" ("school_id", "code") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_locations" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(80) NOT NULL, "code" character varying(30) NOT NULL, "kind" character varying(10) NOT NULL DEFAULT 'classroom', "building" character varying(40), "floor" character varying(20), "section_id" integer, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_b9591ced2c9d787495d19639575" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ddf634903e03125883817297eb" ON "inventory_locations" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_locations_code" ON "inventory_locations" ("school_id", "code") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "departments" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(60) NOT NULL, "code" character varying(20) NOT NULL, "head_user_id" integer, "description" character varying(255), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_839517a681a86bb84cbcc6a1e9d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_c48d09e6334d3c2552ed9cf743" ON "departments" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_departments_school_name" ON "departments" ("school_id", "name") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_vendors" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(120) NOT NULL, "contact_person" character varying(80), "phone" character varying(15), "email" character varying(120), "gstin" character varying(15), "address" character varying(255), "supplies" character varying(255), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_b0adc6a88d08bbce6ddf9f6ee44" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e00be34663ce8b62993e2e7bc0" ON "inventory_vendors" ("school_id") `);
    await queryRunner.query(
      `CREATE TABLE "inventory_stores" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(60) NOT NULL, "code" character varying(20) NOT NULL, "location_id" integer, "keeper_user_id" integer, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_94ed4d5e004b7e0c5a376fd96ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_0312c68d0a6182869c38b596eb" ON "inventory_stores" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_stores_code" ON "inventory_stores" ("school_id", "code") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "assets" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "asset_tag" character varying(30) NOT NULL, "name" character varying(120) NOT NULL, "category_id" integer NOT NULL, "make" character varying(60), "model" character varying(60), "serial_no" character varying(80), "description" character varying(500), "vendor_id" integer, "invoice_no" character varying(40), "invoice_file_id" integer, "purchase_date" date, "cost" numeric(12,2), "residual_value" numeric(12,2), "warranty_until" date, "amc_until" date, "amc_vendor_id" integer, "funding_source" character varying(12) NOT NULL DEFAULT 'school', "condition" character varying(8) NOT NULL DEFAULT 'new', "status" character varying(14) NOT NULL DEFAULT 'in_store', "location_id" integer, "department_id" integer, "custodian_user_id" integer, "store_id" integer, "photo_file_id" integer, "notes" character varying(500), "disposed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_da96729a8b113377cfb6a62439c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_745daece44e7436bca1e3c03a6" ON "assets" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_bfdc3fe63eb7269f4a28625264" ON "assets" ("category_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_916f79b60e63293b23def86da6" ON "assets" ("location_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_ffa40bb901d5ac322adb15d088" ON "assets" ("department_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_ad8d62df5352c35ebd891243db" ON "assets" ("custodian_user_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_assets_school_status" ON "assets" ("school_id", "status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_assets_school_tag" ON "assets" ("school_id", "asset_tag") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_allocations" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "asset_id" integer NOT NULL, "assignee_type" character varying(10) NOT NULL, "user_id" integer, "department_id" integer, "location_id" integer, "allocated_on" date NOT NULL, "expected_return_on" date, "acknowledged_at" TIMESTAMP WITH TIME ZONE, "returned_on" date, "return_condition" character varying(8), "status" character varying(8) NOT NULL DEFAULT 'active', "allocated_by" integer, "returned_by" integer, "remarks" character varying(255), CONSTRAINT "PK_6e85a69e2e1521af68a15feff28" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_4b66a4f50f20e120de08db2abb" ON "asset_allocations" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_asset_allocations_user" ON "asset_allocations" ("school_id", "user_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_asset_allocations_active" ON "asset_allocations" ("asset_id") WHERE status = 'active' AND deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_transfers" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "transfer_no" character varying(30) NOT NULL, "to_type" character varying(10) NOT NULL, "to_user_id" integer, "to_department_id" integer, "to_location_id" integer, "reason" character varying(255) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'requested', "requested_by" integer, "decided_by" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" character varying(255), "completed_at" TIMESTAMP WITH TIME ZONE, "completed_by" integer, CONSTRAINT "PK_ba9dc8ea271c20ab7375000e4af" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_29c24a076af70c980b7fdc40af" ON "asset_transfers" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_asset_transfers_no" ON "asset_transfers" ("school_id", "transfer_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_transfer_items" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "transfer_id" integer NOT NULL, "asset_id" integer NOT NULL, "from_label" character varying(120), CONSTRAINT "PK_8897232b72cf8fbbe22a91071d7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_asset_transfer_items_transfer" ON "asset_transfer_items" ("transfer_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_events" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "asset_id" integer NOT NULL, "kind" character varying(20) NOT NULL, "note" character varying(500), "ref_type" character varying(20), "ref_id" integer, "actor_id" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1a73fcca3bea5c19d1a53d331f5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_6905f4a1b9c8aadff814900977" ON "asset_events" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_asset_events_asset" ON "asset_events" ("asset_id", "created_at") `);
    await queryRunner.query(
      `CREATE TABLE "asset_disposals" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "disposal_no" character varying(30) NOT NULL, "asset_id" integer NOT NULL, "method" character varying(12) NOT NULL, "reason" character varying(255) NOT NULL, "value_realised" numeric(12,2), "book_value" numeric(12,2), "status" character varying(10) NOT NULL DEFAULT 'requested', "requested_by" integer, "decided_by" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" character varying(255), CONSTRAINT "PK_62e410aa7046276d0258482f585" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ad6b7d289433daca88f3f46cd3" ON "asset_disposals" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_asset_disposals_no" ON "asset_disposals" ("school_id", "disposal_no") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_asset_disposals_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ad6b7d289433daca88f3f46cd3"`);
    await queryRunner.query(`DROP TABLE "asset_disposals"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_asset_events_asset"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6905f4a1b9c8aadff814900977"`);
    await queryRunner.query(`DROP TABLE "asset_events"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_asset_transfer_items_transfer"`);
    await queryRunner.query(`DROP TABLE "asset_transfer_items"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_asset_transfers_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_29c24a076af70c980b7fdc40af"`);
    await queryRunner.query(`DROP TABLE "asset_transfers"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_asset_allocations_active"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_asset_allocations_user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4b66a4f50f20e120de08db2abb"`);
    await queryRunner.query(`DROP TABLE "asset_allocations"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_assets_school_tag"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_assets_school_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ad8d62df5352c35ebd891243db"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ffa40bb901d5ac322adb15d088"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_916f79b60e63293b23def86da6"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bfdc3fe63eb7269f4a28625264"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_745daece44e7436bca1e3c03a6"`);
    await queryRunner.query(`DROP TABLE "assets"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_inventory_stores_code"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0312c68d0a6182869c38b596eb"`);
    await queryRunner.query(`DROP TABLE "inventory_stores"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e00be34663ce8b62993e2e7bc0"`);
    await queryRunner.query(`DROP TABLE "inventory_vendors"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_departments_school_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c48d09e6334d3c2552ed9cf743"`);
    await queryRunner.query(`DROP TABLE "departments"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_inventory_locations_code"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ddf634903e03125883817297eb"`);
    await queryRunner.query(`DROP TABLE "inventory_locations"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_inventory_categories_code"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d4eeac9437420f76f9a9c5794a"`);
    await queryRunner.query(`DROP TABLE "inventory_categories"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_inventory_settings_school"`);
    await queryRunner.query(`DROP TABLE "inventory_settings"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_stock_count_lines_item"`);
    await queryRunner.query(`DROP TABLE "stock_count_lines"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_asset_audit_items_code"`);
    await queryRunner.query(`DROP TABLE "asset_audit_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8b79796ac2acd055d15bed4966"`);
    await queryRunner.query(`DROP TABLE "inventory_audits"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_requisition_lines_requisition"`);
    await queryRunner.query(`DROP TABLE "requisition_lines"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_requisitions_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_084aac19aa55fc6a67067f5240"`);
    await queryRunner.query(`DROP TABLE "requisitions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_receipt_lines_receipt"`);
    await queryRunner.query(`DROP TABLE "stock_receipt_lines"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_stock_receipts_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b483cbe950bbcfe8aaac4d1a48"`);
    await queryRunner.query(`DROP TABLE "stock_receipts"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_movements_item"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_movements_school_date"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4a4be83ff2efd97f18f4ddbc06"`);
    await queryRunner.query(`DROP TABLE "stock_movements"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_stock_balances_item_store"`);
    await queryRunner.query(`DROP TABLE "stock_balances"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_stock_items_code"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c342d1b8e90bb3af870ef991d2"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_adf8e4cba3cdabc9653c9f2c9f"`);
    await queryRunner.query(`DROP TABLE "stock_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_asset_maintenance_schedules_due"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9e0063ec2ae6d8a728cb2478a5"`);
    await queryRunner.query(`DROP TABLE "asset_maintenance_schedules"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_asset_maintenance_tickets_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_asset_maintenance_tickets_asset"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a9e7d68db94a3d925b7c66f23b"`);
    await queryRunner.query(`DROP TABLE "asset_maintenance_tickets"`);
  }
}
