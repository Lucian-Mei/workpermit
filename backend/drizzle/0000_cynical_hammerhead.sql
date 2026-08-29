CREATE TABLE IF NOT EXISTS "action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"purpose" varchar(30) NOT NULL,
	"target_type" varchar(30) NOT NULL,
	"target_id" uuid NOT NULL,
	"step" varchar(30),
	"role" varchar(30),
	"signer_name" varchar(100),
	"multi" boolean DEFAULT false NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50),
	"description" text,
	"building" varchar(50),
	"floor" varchar(50),
	"responsible_dept" varchar(100),
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "areas_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backup_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(20) DEFAULT 'download' NOT NULL,
	"target" varchar(255),
	"status" varchar(20) DEFAULT 'success' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificate_ocr" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_permit_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_path" varchar(512) NOT NULL,
	"file_type" varchar(20) DEFAULT 'image' NOT NULL,
	"issuer" varchar(100),
	"cert_type" varchar(30),
	"required" boolean DEFAULT false NOT NULL,
	"ocr_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"ocr_raw" text,
	"ocr_fields" jsonb DEFAULT '{}'::jsonb,
	"need_manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"head" varchar(100),
	"phone" varchar(50),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "department_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"abbreviation" varchar(50),
	"responsible_person" varchar(100),
	"coordinator" varchar(100),
	"coordinator_phone" varchar(50),
	"default_rectifier_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entry_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_permit_id" uuid NOT NULL,
	"contractor_unit" varchar(200) NOT NULL,
	"worker_name" varchar(100) NOT NULL,
	"worker_id_card" varchar(50),
	"worker_phone" varchar(50),
	"training_passed" boolean DEFAULT false NOT NULL,
	"training_record_id" uuid,
	"sign_img" text,
	"gate" varchar(50),
	"status" varchar(10) DEFAULT 'in' NOT NULL,
	"sign_out_at" timestamp with time zone,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hazard_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hazard_id" uuid NOT NULL,
	"operator_id" uuid,
	"operator_name" varchar(100) NOT NULL,
	"action" varchar(30) NOT NULL,
	"from_status" varchar(30),
	"to_status" varchar(30),
	"comment" text,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hazard_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"regulations" jsonb DEFAULT '[]'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "hazard_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hazards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hazard_no" varchar(50) NOT NULL,
	"submitter_user_id" uuid,
	"submitter_name" varchar(100),
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"building" varchar(100),
	"floor" varchar(50),
	"location" varchar(255),
	"area" varchar(100),
	"department" varchar(100),
	"photos" jsonb DEFAULT '[]'::jsonb,
	"description" text,
	"suggest_department" varchar(100),
	"suggest_action" text,
	"ai_description" text,
	"ai_category" varchar(100),
	"ai_risk_level" varchar(50),
	"ai_regulation" text,
	"ai_suggestion" text,
	"ai_root_cause" text,
	"ai_5why" text,
	"ai_control_measures" text,
	"category_approved" jsonb DEFAULT '[]'::jsonb,
	"risk_level" varchar(50) DEFAULT 'low' NOT NULL,
	"status" varchar(30) DEFAULT 'pending_assign' NOT NULL,
	"allocated_department" varchar(100),
	"assigned_dept_id" uuid,
	"assignee_id" uuid,
	"assignee_name" varchar(100),
	"deadline" timestamp with time zone,
	"rectification_desc" text,
	"rectification_files" jsonb DEFAULT '[]'::jsonb,
	"rectification_date" timestamp with time zone,
	"acceptance_result" varchar(20),
	"rejection_reason" text,
	"archived_reason" text,
	"archived_at" timestamp with time zone,
	"archived_by_name" varchar(100),
	"is_public" varchar(10) DEFAULT '是' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hazards_hazard_no_unique" UNIQUE("hazard_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_permit_id" uuid NOT NULL,
	"inspected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inspector" varchar(100),
	"result" varchar(20) DEFAULT 'normal' NOT NULL,
	"note" text,
	"photo" varchar(512),
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"ocr_raw" text,
	"created_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lottery_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_name" varchar(100),
	"prize" varchar(100) NOT NULL,
	"source" varchar(40),
	"ref_id" varchar(100),
	"ref_no" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measure_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(30) NOT NULL,
	"category" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"note" varchar(100),
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" varchar(50) NOT NULL,
	"action" varchar(50) NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"scene" varchar(50),
	"area" varchar(100),
	"target_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"ua" varchar(255),
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "safety_briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_permit_id" uuid NOT NULL,
	"briefer" varchar(100),
	"points" jsonb DEFAULT '[]'::jsonb,
	"ai_draft" text,
	"content" text,
	"photos" jsonb DEFAULT '[]'::jsonb,
	"signatures" jsonb DEFAULT '[]'::jsonb,
	"briefed_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submission_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_ip" varchar(45) NOT NULL,
	"kind" varchar(20) DEFAULT 'hazard' NOT NULL,
	"ref_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_permit_id" uuid,
	"worker_name" varchar(100) NOT NULL,
	"worker_id_card" varchar(50) NOT NULL,
	"step" varchar(20) NOT NULL,
	"score" integer,
	"training_record_id" uuid,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"answer" varchar(10) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"id_card" varchar(50),
	"phone" varchar(50),
	"score" integer,
	"total" integer,
	"passed" boolean DEFAULT false NOT NULL,
	"passed_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"answers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"password_hash" varchar(100) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"department" varchar(100),
	"area" varchar(100),
	"manager_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_permit_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_permit_id" uuid NOT NULL,
	"checker_name" varchar(100) NOT NULL,
	"check_slot" varchar(10),
	"unlock_at" timestamp with time zone,
	"check_items" jsonb DEFAULT '{}'::jsonb,
	"check_photo" varchar(512),
	"note" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_permit_trainings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_permit_id" uuid NOT NULL,
	"trainer" varchar(100),
	"training_topics" text,
	"trainee_names" jsonb DEFAULT '[]'::jsonb,
	"trainee_signatures" jsonb DEFAULT '[]'::jsonb,
	"training_date" timestamp with time zone,
	"test_result" varchar(50),
	"valid_until" timestamp with time zone,
	"remark" text,
	"sign_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permit_no" varchar(50) NOT NULL,
	"type" varchar(30) NOT NULL,
	"is_hazardous" boolean DEFAULT false NOT NULL,
	"channel" varchar(16) DEFAULT 'paper' NOT NULL,
	"measure_selections" jsonb DEFAULT '[]'::jsonb,
	"linked_routine_id" uuid,
	"linked_routine_no" varchar(50),
	"building" varchar(100),
	"floor" varchar(100),
	"area" varchar(100),
	"location" varchar(255),
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"applicant_id" uuid,
	"applicant_name" varchar(100),
	"department" varchar(100),
	"operator_names" jsonb DEFAULT '[]'::jsonb,
	"expected_operator_count" integer,
	"material_missing" boolean DEFAULT false NOT NULL,
	"auto_archived_at" timestamp,
	"supervisor_name" varchar(100),
	"supervisor_contact" varchar(50),
	"operator_contact" varchar(50),
	"content" text,
	"job_name" varchar(255),
	"project_name" varchar(255),
	"contractor_unit" varchar(255),
	"contractor_head" varchar(100),
	"contractor_phone" varchar(50),
	"contractor_email" varchar(255),
	"materials_list" text,
	"equipment_list" text,
	"management_dept" varchar(100),
	"management_person" varchar(100),
	"hazard_type_list" jsonb DEFAULT '[]'::jsonb,
	"guardian_signatures" jsonb DEFAULT '[]'::jsonb,
	"contractor_invite_token" varchar(64),
	"contractor_invite_expires_at" timestamp with time zone,
	"contractor_submitted_at" timestamp with time zone,
	"entry_qr_token" varchar(64),
	"entry_qr_url" text,
	"renewal_count" integer DEFAULT 0 NOT NULL,
	"renewal_parent_id" uuid,
	"ai_risk_analysis" text,
	"safety_measures" jsonb DEFAULT '[]'::jsonb,
	"jsas" jsonb DEFAULT '[]'::jsonb,
	"ai_review_analysis" text,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"reviewer_id" uuid,
	"reviewer_name" varchar(100),
	"review_opinion" text,
	"reviewed_at" timestamp with time zone,
	"ehs_approver_id" uuid,
	"ehs_approver_name" varchar(100),
	"ehs_approval_opinion" text,
	"ehs_approved_at" timestamp with time zone,
	"approver_id" uuid,
	"approver_name" varchar(100),
	"approval_opinion" text,
	"approved_at" timestamp with time zone,
	"print_count" integer DEFAULT 0 NOT NULL,
	"qr_code" text,
	"risk_level" varchar(20) DEFAULT 'low' NOT NULL,
	"approval_chain" jsonb,
	"work_code" varchar(20),
	"training_qr_token" varchar(64),
	"training_qr_expires_at" timestamp with time zone,
	"printed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"signatures" jsonb DEFAULT '[]'::jsonb,
	"paused_at" timestamp with time zone,
	"paused_by" uuid,
	"paused_by_name" varchar(100),
	"pause_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_by_name" varchar(100),
	"void_reason" text,
	"replaced_by_permit_no" varchar(50),
	"daily_override" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_permits_permit_no_unique" UNIQUE("permit_no")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certificate_ocr" ADD CONSTRAINT "certificate_ocr_work_permit_id_work_permits_id_fk" FOREIGN KEY ("work_permit_id") REFERENCES "public"."work_permits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "departments" ADD CONSTRAINT "departments_default_rectifier_id_users_id_fk" FOREIGN KEY ("default_rectifier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hazard_activities" ADD CONSTRAINT "hazard_activities_hazard_id_hazards_id_fk" FOREIGN KEY ("hazard_id") REFERENCES "public"."hazards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hazard_activities" ADD CONSTRAINT "hazard_activities_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hazards" ADD CONSTRAINT "hazards_submitter_user_id_users_id_fk" FOREIGN KEY ("submitter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hazards" ADD CONSTRAINT "hazards_assigned_dept_id_departments_id_fk" FOREIGN KEY ("assigned_dept_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hazards" ADD CONSTRAINT "hazards_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_work_permit_id_work_permits_id_fk" FOREIGN KEY ("work_permit_id") REFERENCES "public"."work_permits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "safety_briefings" ADD CONSTRAINT "safety_briefings_work_permit_id_work_permits_id_fk" FOREIGN KEY ("work_permit_id") REFERENCES "public"."work_permits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_permit_checks" ADD CONSTRAINT "work_permit_checks_work_permit_id_work_permits_id_fk" FOREIGN KEY ("work_permit_id") REFERENCES "public"."work_permits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_permit_trainings" ADD CONSTRAINT "work_permit_trainings_work_permit_id_work_permits_id_fk" FOREIGN KEY ("work_permit_id") REFERENCES "public"."work_permits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_ehs_approver_id_users_id_fk" FOREIGN KEY ("ehs_approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atoken_token" ON "action_tokens" ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atoken_target" ON "action_tokens" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_areas_name" ON "areas" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cert_wp" ON "certificate_ocr" ("work_permit_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "department_managers_pk" ON "department_managers" ("user_id","department_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entry_reg_wp" ON "entry_registrations" ("work_permit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entry_reg_idcard" ON "entry_registrations" ("worker_id_card");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hazard_activities_hazard" ON "hazard_activities" ("hazard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hazards_status" ON "hazards" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hazards_dept" ON "hazards" ("allocated_department");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hazards_submitter" ON "hazards" ("submitter_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_insp_wp" ON "inspection_records" ("work_permit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_insp_at" ON "inspection_records" ("inspected_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lottery_user" ON "lottery_records" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_measure_type" ON "measure_templates" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_measure_cat" ON "measure_templates" ("category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_subject_action" ON "permissions" ("subject","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qr_name" ON "qr_codes" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rt_user" ON "refresh_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rt_expires" ON "refresh_tokens" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_pk" ON "role_permissions" ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_briefing_wp" ON "safety_briefings" ("work_permit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_submission_ip" ON "submission_log" ("client_ip","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "system_config_key" ON "system_config" ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_training_attempts_wp" ON "training_attempts" ("work_permit_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_pk" ON "user_roles" ("user_id","role_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_check_wp" ON "work_permit_checks" ("work_permit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wpt_wp" ON "work_permit_trainings" ("work_permit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wp_status" ON "work_permits" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wp_type" ON "work_permits" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wp_dept" ON "work_permits" ("department");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wp_applicant" ON "work_permits" ("applicant_id");