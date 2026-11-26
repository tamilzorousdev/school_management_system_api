import { MigrationInterface, QueryRunner } from 'typeorm';

export class Canteen1795695869992 implements MigrationInterface {
  name = 'Canteen1795695869992';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "canteen_suppliers" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(120) NOT NULL, "contact_person" character varying(100), "mobile" character varying(15), "email" character varying(120), "address" character varying(300), "gstin" character varying(20), "supplies" character varying(200), "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_d0b52843b9c41883e457c7a1ef3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_2e017bf89568947e965e2b8d42" ON "canteen_suppliers" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_suppliers_name" ON "canteen_suppliers" ("school_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_stock_items" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(120) NOT NULL, "code" character varying(20), "unit" character varying(6) NOT NULL DEFAULT 'kg', "quantity_on_hand" numeric(12,3) NOT NULL DEFAULT '0', "reorder_level" numeric(12,3) NOT NULL DEFAULT '0', "cost_per_unit" numeric(12,2) NOT NULL DEFAULT '0', "expiry_date" date, "supplier_id" integer, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_40ab398126b052681c42ed80dc5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_400f1abf348a3bd5823a239f32" ON "canteen_stock_items" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_stock_items_name" ON "canteen_stock_items" ("school_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_stock_movements" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "stock_item_id" integer NOT NULL, "kind" character varying(12) NOT NULL, "quantity" numeric(12,3) NOT NULL, "balance_after" numeric(12,3) NOT NULL, "unit_cost" numeric(12,2), "reference_type" character varying(20), "reference_id" integer, "note" character varying(200), CONSTRAINT "PK_1ea9e3b6f11a6997f8692e39b48" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ce8c2fb22b8c86503717d12e2" ON "canteen_stock_movements" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_canteen_stock_movements_item" ON "canteen_stock_movements" ("stock_item_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_purchase_orders" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "po_no" character varying(24) NOT NULL, "supplier_id" integer NOT NULL, "order_date" date NOT NULL, "expected_date" date, "status" character varying(10) NOT NULL DEFAULT 'draft', "total_amount" numeric(12,2) NOT NULL DEFAULT '0', "note" character varying(300), "received_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_44c961f11a09d74cde158bdf0ae" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_637a734105c978268288560f48" ON "canteen_purchase_orders" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_purchase_orders_no" ON "canteen_purchase_orders" ("school_id", "po_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_purchase_lines" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "purchase_order_id" integer NOT NULL, "stock_item_id" integer NOT NULL, "quantity" numeric(12,3) NOT NULL, "unit_cost" numeric(12,2) NOT NULL, "received_quantity" numeric(12,3) NOT NULL DEFAULT '0', CONSTRAINT "PK_f2098cab20e9c1ce64867f35044" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ad477a59b2185d812698bc721e" ON "canteen_purchase_lines" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_canteen_purchase_lines_po" ON "canteen_purchase_lines" ("purchase_order_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_kitchen_batches" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "batch_date" date NOT NULL, "slot" character varying(10) NOT NULL, "food_item_id" integer NOT NULL, "planned_quantity" integer NOT NULL, "prepared_quantity" integer NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'planned', "cook_id" integer, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "note" character varying(300), CONSTRAINT "PK_e9fcf22c7c57b080ba251254c51" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c72208a9dfc536ec3a8f3fb4ca" ON "canteen_kitchen_batches" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_canteen_kitchen_batches_day" ON "canteen_kitchen_batches" ("school_id", "batch_date", "slot") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_tables" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(40) NOT NULL, "area" character varying(60), "seats" smallint NOT NULL DEFAULT '4', "status" character varying(10) NOT NULL DEFAULT 'free', "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_40e4becbdc085880eac7360ea89" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_02db7843744b6aedceca919b95" ON "canteen_tables" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_tables_name" ON "canteen_tables" ("school_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_table_bookings" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "table_id" integer NOT NULL, "booking_date" date NOT NULL, "slot" character varying(10) NOT NULL, "party_size" smallint NOT NULL, "diner_id" integer, "guest_name" character varying(100), "status" character varying(10) NOT NULL DEFAULT 'reserved', "seated_at" TIMESTAMP WITH TIME ZONE, "released_at" TIMESTAMP WITH TIME ZONE, "order_id" integer, CONSTRAINT "PK_9b8b5b3c6d0c19c30cde56342ca" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_cb27a8af89ca93330b79e93d76" ON "canteen_table_bookings" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_canteen_table_bookings_day" ON "canteen_table_bookings" ("school_id", "booking_date", "slot") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_waste_logs" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "waste_date" date NOT NULL, "food_item_id" integer, "stock_item_id" integer, "item_name" character varying(120) NOT NULL, "quantity" numeric(12,3) NOT NULL, "unit" character varying(6) NOT NULL DEFAULT 'pcs', "reason" character varying(20) NOT NULL, "cost" numeric(12,2) NOT NULL DEFAULT '0', "note" character varying(300), CONSTRAINT "PK_5daf143814e99f28637f0038582" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_08b16f5e2b01f0c1c94d5f84bf" ON "canteen_waste_logs" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_canteen_waste_logs_day" ON "canteen_waste_logs" ("school_id", "waste_date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_diners" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "person_type" character varying(8) NOT NULL, "student_id" integer, "staff_id" integer, "card_no" character varying(20) NOT NULL, "card_status" character varying(10) NOT NULL DEFAULT 'active', "card_version" integer NOT NULL DEFAULT '1', "card_issued_at" TIMESTAMP WITH TIME ZONE, "wallet_balance" numeric(12,2) NOT NULL DEFAULT '0', "daily_limit" numeric(10,2), "diet" character varying(8) NOT NULL DEFAULT 'veg', "allergies" character varying(300), "meal_slots" character varying(60), "status" character varying(10) NOT NULL DEFAULT 'active', "notes" character varying(300), CONSTRAINT "PK_e31e435f84f7dc1db6d38c9cd8a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_6129f082758b4535dca36094a6" ON "canteen_diners" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_diners_staff" ON "canteen_diners" ("school_id", "staff_id") WHERE "staff_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_diners_student" ON "canteen_diners" ("school_id", "student_id") WHERE "student_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_diners_card" ON "canteen_diners" ("school_id", "card_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_wallet_transactions" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "diner_id" integer NOT NULL, "kind" character varying(12) NOT NULL, "amount" numeric(12,2) NOT NULL, "balance_after" numeric(12,2) NOT NULL, "mode" character varying(12), "reference" character varying(60), "order_id" integer, "note" character varying(200), CONSTRAINT "PK_e72bb4c0d2837ca69cced8f6852" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7fe097481391ea9c2302e2235" ON "canteen_wallet_transactions" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_canteen_wallet_transactions_diner" ON "canteen_wallet_transactions" ("diner_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_orders" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "order_no" character varying(24) NOT NULL, "token_no" integer NOT NULL, "token_label" character varying(12) NOT NULL, "order_date" date NOT NULL, "slot" character varying(10), "diner_id" integer, "customer_name" character varying(100), "channel" character varying(10) NOT NULL DEFAULT 'counter', "status" character varying(10) NOT NULL DEFAULT 'placed', "subtotal" numeric(12,2) NOT NULL DEFAULT '0', "tax_amount" numeric(12,2) NOT NULL DEFAULT '0', "discount_amount" numeric(12,2) NOT NULL DEFAULT '0', "total_amount" numeric(12,2) NOT NULL DEFAULT '0', "paid_amount" numeric(12,2) NOT NULL DEFAULT '0', "payment_status" character varying(10) NOT NULL DEFAULT 'unpaid', "counter_id" integer, "table_id" integer, "note" character varying(300), "ready_at" TIMESTAMP WITH TIME ZONE, "served_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancel_reason" character varying(200), CONSTRAINT "PK_2ff9da0809c08afd3e4d522b40e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_aa225669e36bc9faa60880aaa8" ON "canteen_orders" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_canteen_orders_day" ON "canteen_orders" ("school_id", "order_date", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_orders_no" ON "canteen_orders" ("school_id", "order_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_order_items" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "order_id" integer NOT NULL, "food_item_id" integer, "meal_id" integer, "name" character varying(120) NOT NULL, "unit_price" numeric(10,2) NOT NULL, "quantity" integer NOT NULL, "line_total" numeric(12,2) NOT NULL, CONSTRAINT "PK_2d12ccfacf78e0e4ce95c5b0f6a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_a5ed8fcee1dcbb649883b7e130" ON "canteen_order_items" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_canteen_order_items_order" ON "canteen_order_items" ("order_id") `);
    await queryRunner.query(
      `CREATE TABLE "canteen_payments" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "order_id" integer NOT NULL, "receipt_no" character varying(24) NOT NULL, "mode" character varying(8) NOT NULL, "amount" numeric(12,2) NOT NULL, "reference" character varying(60), "is_refund" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_b97665f1e10485f1ae726c23e72" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_1dfc1720e9ff54e0278a4f7086" ON "canteen_payments" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_canteen_payments_order" ON "canteen_payments" ("order_id") `);
    await queryRunner.query(
      `CREATE TABLE "canteen_staff" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(100) NOT NULL, "mobile" character varying(15), "role" character varying(10) NOT NULL, "staff_id" integer, "joined_on" date, "daily_wage" numeric(10,2), "status" character varying(10) NOT NULL DEFAULT 'active', "address" character varying(300), CONSTRAINT "PK_d047a179bf0671a5f21c74ccdb5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_55f009d7e81f6b0cc8a5768043" ON "canteen_staff" ("school_id") `);
    await queryRunner.query(
      `CREATE TABLE "canteen_staff_attendance" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "canteen_staff_id" integer NOT NULL, "attendance_date" date NOT NULL, "status" character varying(10) NOT NULL, "check_in_at" TIMESTAMP WITH TIME ZONE, "check_out_at" TIMESTAMP WITH TIME ZONE, "note" character varying(200), CONSTRAINT "PK_f778cfd00f78efcd11e18559d3f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c4e217e9d59d50838c9e30cfcf" ON "canteen_staff_attendance" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_staff_attendance_day" ON "canteen_staff_attendance" ("canteen_staff_id", "attendance_date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_feedback" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "kind" character varying(10) NOT NULL, "category" character varying(14) NOT NULL DEFAULT 'other', "rating" smallint, "subject" character varying(150) NOT NULL, "message" text NOT NULL, "diner_id" integer, "order_id" integer, "status" character varying(12) NOT NULL DEFAULT 'open', "resolution" text, "resolved_at" TIMESTAMP WITH TIME ZONE, "resolved_by" integer, CONSTRAINT "PK_71ae44a86fc0aabd8765a20426f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_2c47ad9eda7111044b5c3cfc3a" ON "canteen_feedback" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_canteen_feedback_status" ON "canteen_feedback" ("school_id", "kind", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_settings" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "opens_at" character varying(5) NOT NULL DEFAULT '08:00', "closes_at" character varying(5) NOT NULL DEFAULT '17:00', "accepts_orders" boolean NOT NULL DEFAULT true, "wallet_enabled" boolean NOT NULL DEFAULT true, "allow_negative_balance" boolean NOT NULL DEFAULT false, "allow_walk_in" boolean NOT NULL DEFAULT true, "low_balance_limit" numeric(10,2) NOT NULL DEFAULT '50', "default_daily_limit" numeric(10,2), "order_cutoff_minutes" smallint NOT NULL DEFAULT '15', "token_prefix" character varying(4) NOT NULL DEFAULT 'T', "tax_percent" numeric(5,2) NOT NULL DEFAULT '0', "receipt_footer" character varying(200), "updated_by" integer, CONSTRAINT "PK_e52b6301f45a2321f74e9ae9e0b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_c698b4cfa58a4afb13aa564b0d" ON "canteen_settings" ("school_id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_canteen_settings_school" ON "canteen_settings" ("school_id") `);
    await queryRunner.query(
      `CREATE TABLE "canteen_counters" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(60) NOT NULL, "description" character varying(200), "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_7b4b57b6115a12f9a31313f1130" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_484440261d1d08d6c97252cbae" ON "canteen_counters" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_counters_name" ON "canteen_counters" ("school_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_food_categories" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(80) NOT NULL, "description" character varying(300), "sort_order" smallint NOT NULL DEFAULT '0', "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_7dfcd1853c0cf46064cd7e53d77" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd33d16780df08a5518c479713" ON "canteen_food_categories" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_food_categories_name" ON "canteen_food_categories" ("school_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_food_items" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "category_id" integer NOT NULL, "name" character varying(120) NOT NULL, "code" character varying(20), "description" character varying(400), "price" numeric(10,2) NOT NULL, "is_veg" boolean NOT NULL DEFAULT true, "prep_minutes" smallint NOT NULL DEFAULT '10', "calories" integer, "allergens" character varying(200), "available" boolean NOT NULL DEFAULT true, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_00031bf8d29e244c207570213f3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_bea002d8809fc800a9a2cc03e8" ON "canteen_food_items" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_food_items_name" ON "canteen_food_items" ("school_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_recipe_lines" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "food_item_id" integer NOT NULL, "stock_item_id" integer NOT NULL, "quantity" numeric(12,3) NOT NULL, CONSTRAINT "PK_fe877a06482ac498df47856d772" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_b6a1ed2e1264b155733ba2e8b3" ON "canteen_recipe_lines" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_recipe_lines" ON "canteen_recipe_lines" ("food_item_id", "stock_item_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_meals" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(120) NOT NULL, "code" character varying(20), "kind" character varying(10) NOT NULL DEFAULT 'meal', "description" character varying(400), "price" numeric(10,2) NOT NULL, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_a7b6b22e823c911e0b61ce1fdd0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_5a851228de78bd03d32e0287eb" ON "canteen_meals" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_meals_name" ON "canteen_meals" ("school_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_meal_items" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "meal_id" integer NOT NULL, "food_item_id" integer NOT NULL, "quantity" smallint NOT NULL DEFAULT '1', CONSTRAINT "PK_b553faf163866e2c5375b9f66a1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_b238306ec435c65101f1f70d07" ON "canteen_meal_items" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_canteen_meal_items" ON "canteen_meal_items" ("meal_id", "food_item_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "canteen_daily_menu" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "menu_date" date NOT NULL, "slot" character varying(10) NOT NULL, "food_item_id" integer, "meal_id" integer, "price" numeric(10,2), "quantity_limit" integer, "sold_quantity" integer NOT NULL DEFAULT '0', "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_c8baf2b63f1778c8b00142f5dd4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_b3bc47bc11d9afffc254c433ab" ON "canteen_daily_menu" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_canteen_daily_menu_day" ON "canteen_daily_menu" ("school_id", "menu_date", "slot") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_daily_menu_day"`);
    await queryRunner.query(`DROP TABLE "canteen_daily_menu"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_meal_items"`);
    await queryRunner.query(`DROP TABLE "canteen_meal_items"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_meals_name"`);
    await queryRunner.query(`DROP TABLE "canteen_meals"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_recipe_lines"`);
    await queryRunner.query(`DROP TABLE "canteen_recipe_lines"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_food_items_name"`);
    await queryRunner.query(`DROP TABLE "canteen_food_items"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_food_categories_name"`);
    await queryRunner.query(`DROP TABLE "canteen_food_categories"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_counters_name"`);
    await queryRunner.query(`DROP TABLE "canteen_counters"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_settings_school"`);
    await queryRunner.query(`DROP TABLE "canteen_settings"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_feedback_status"`);
    await queryRunner.query(`DROP TABLE "canteen_feedback"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_staff_attendance_day"`);
    await queryRunner.query(`DROP TABLE "canteen_staff_attendance"`);
    await queryRunner.query(`DROP TABLE "canteen_staff"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_payments_order"`);
    await queryRunner.query(`DROP TABLE "canteen_payments"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_order_items_order"`);
    await queryRunner.query(`DROP TABLE "canteen_order_items"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_orders_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_orders_day"`);
    await queryRunner.query(`DROP TABLE "canteen_orders"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_wallet_transactions_diner"`);
    await queryRunner.query(`DROP TABLE "canteen_wallet_transactions"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_diners_card"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_diners_student"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_diners_staff"`);
    await queryRunner.query(`DROP TABLE "canteen_diners"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_waste_logs_day"`);
    await queryRunner.query(`DROP TABLE "canteen_waste_logs"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_table_bookings_day"`);
    await queryRunner.query(`DROP TABLE "canteen_table_bookings"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_tables_name"`);
    await queryRunner.query(`DROP TABLE "canteen_tables"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_kitchen_batches_day"`);
    await queryRunner.query(`DROP TABLE "canteen_kitchen_batches"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_purchase_lines_po"`);
    await queryRunner.query(`DROP TABLE "canteen_purchase_lines"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_purchase_orders_no"`);
    await queryRunner.query(`DROP TABLE "canteen_purchase_orders"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_canteen_stock_movements_item"`);
    await queryRunner.query(`DROP TABLE "canteen_stock_movements"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_stock_items_name"`);
    await queryRunner.query(`DROP TABLE "canteen_stock_items"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_canteen_suppliers_name"`);
    await queryRunner.query(`DROP TABLE "canteen_suppliers"`);
  }
}
