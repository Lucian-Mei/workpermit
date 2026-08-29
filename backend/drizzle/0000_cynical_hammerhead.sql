CREATE TABLE IF NOT EXISTS "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50),
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"building" varchar(50),
	"floor" varchar(50),
	"responsible_dept" varchar(100),
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
	"ocr_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"ocr_raw" text,
	"ocr_fields" jsonb DEFAULT '{}'::jsonb,
	"need_manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
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
	"risk_level" varchar(50) DEFAULT 'normal' NOT NULL,
	"status" varchar(30) DEFAULT 'pending_assign' NOT NULL,
	"allocated_department" varchar(100),
	"assignee_id" uuid,
	"assignee_name" varchar(100),
	"deadline" timestamp with time zone,
	"rectification_desc" text,
	"rectification_files" jsonb DEFAULT '[]'::jsonb,
	"rectification_date" timestamp with time zone,
	"acceptance_result" varchar(20),
	"rejection_reason" text,
	"is_public" varchar(10) DEFAULT '是' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_dept_id" uuid,
	"archived_reason" text,
	"archived_at" timestamp with time zone,
	"archived_by_name" varchar(100),
	CONSTRAINT "hazards_hazard_no_unique" UNIQUE("hazard_no")
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
CREATE TABLE IF NOT EXISTS "risk_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" varchar(20) NOT NULL,
	"name" varchar(50) NOT NULL,
	"color" varchar(30) DEFAULT '#f59e0b' NOT NULL,
	"default_deadline" integer DEFAULT 7 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "risk_levels_level_unique" UNIQUE("level")
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
	"check_items" jsonb DEFAULT '{}'::jsonb,
	"check_photo" varchar(512),
	"note" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permit_no" varchar(50) NOT NULL,
	"application_id" uuid,
	"type" varchar(30) NOT NULL,
	"is_hazardous" boolean DEFAULT false NOT NULL,
	"area" varchar(100),
	"location" varchar(255),
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"applicant_id" uuid,
	"applicant_name" varchar(100),
	"department" varchar(100),
	"operator_names" jsonb DEFAULT '[]'::jsonb,
	"supervisor_name" varchar(100),
	"supervisor_contact" varchar(50),
	"operator_contact" varchar(50),
	"content" text,
	"ai_risk_analysis" text,
	"safety_measures" jsonb DEFAULT '[]'::jsonb,
	"ai_review_analysis" text,
	"status" varchar(30) DEFAULT 'pending_review' NOT NULL,
	"reviewer_id" uuid,
	"reviewer_name" varchar(100),
	"review_opinion" text,
	"approver_id" uuid,
	"approver_name" varchar(100),
	"approval_opinion" text,
	"print_count" integer DEFAULT 0 NOT NULL,
	"qr_code" text,
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
 ALTER TABLE "hazards" ADD CONSTRAINT "hazards_submitter_user_id_users_id_fk" FOREIGN KEY ("submitter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
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
 ALTER TABLE "work_permit_checks" ADD CONSTRAINT "work_permit_checks_work_permit_id_work_permits_id_fk" FOREIGN KEY ("work_permit_id") REFERENCES "public"."work_permits"("id") ON DELETE cascade ON UPDATE no action;
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
 ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_areas_name" ON "areas" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cert_wp" ON "certificate_ocr" ("work_permit_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "department_managers_pk" ON "department_managers" ("user_id","department_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hazards_status" ON "hazards" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hazards_dept" ON "hazards" ("allocated_department");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hazards_submitter" ON "hazards" ("submitter_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_subject_action" ON "permissions" ("subject","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qr_name" ON "qr_codes" ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_pk" ON "role_permissions" ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_submission_ip" ON "submission_log" ("client_ip","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "system_config_key" ON "system_config" ("key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_pk" ON "user_roles" ("user_id","role_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_check_wp" ON "work_permit_checks" ("work_permit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wp_status" ON "work_permits" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wp_type" ON "work_permits" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wp_dept" ON "work_permits" ("department");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wp_applicant" ON "work_permits" ("applicant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_permit_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permit_no" varchar(50) NOT NULL,
	"applicant_id" uuid,
	"applicant_name" varchar(100),
	"department" varchar(100),
	"area" varchar(100),
	"location" varchar(255),
	"job_name" varchar(255),
	"content" text,
	"plan_start" timestamp with time zone,
	"plan_end" timestamp with time zone,
	"operator_names" jsonb DEFAULT '[]'::jsonb,
	"supervisor_name" varchar(100),
	"supervisor_contact" varchar(50),
	"operator_contact" varchar(50),
	"involves_hazardous" boolean DEFAULT false NOT NULL,
	"training_id" uuid,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"reviewer_id" uuid,
	"reviewer_name" varchar(100),
	"review_opinion" text,
	"reviewed_at" timestamp with time zone,
	"approver_id" uuid,
	"approver_name" varchar(100),
	"approval_opinion" text,
	"approved_at" timestamp with time zone,
	"print_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_permit_applications_permit_no_unique" UNIQUE ("permit_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_permit_trainings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"trainer" varchar(100),
	"training_topics" text,
	"trainee_names" jsonb DEFAULT '[]'::jsonb,
	"trainee_signatures" jsonb DEFAULT '[]'::jsonb,
	"training_date" timestamp with time zone,
	"test_result" varchar(50),
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_permits' AND column_name='application_id') THEN
		ALTER TABLE "work_permits" ADD COLUMN "application_id" uuid;
	END IF;
EXCEPTION WHEN others THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_permit_trainings" ADD CONSTRAINT "work_permit_trainings_application_id_work_permit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."work_permit_applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_permit_applications" ADD CONSTRAINT "work_permit_applications_training_id_work_permit_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."work_permit_trainings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_application_id_work_permit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."work_permit_applications"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wpa_status" ON "work_permit_applications" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wpa_dept" ON "work_permit_applications" ("department");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wpa_applicant" ON "work_permit_applications" ("applicant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wpt_app" ON "work_permit_trainings" ("application_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "safety_briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
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
CREATE TABLE IF NOT EXISTS "inspection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"work_permit_id" uuid,
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
DO $$ BEGIN
	ALTER TABLE "safety_briefings" ADD CONSTRAINT "safety_briefings_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."work_permit_applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."work_permit_applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inspection_records" ADD CONSTRAINT "inspection_records_work_permit_id_fk" FOREIGN KEY ("work_permit_id") REFERENCES "public"."work_permits"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_briefing_app" ON "safety_briefings" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_insp_app" ON "inspection_records" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_insp_at" ON "inspection_records" ("inspected_at");--> statement-breakpoint

DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "printed_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "signatures" jsonb DEFAULT '[]'::jsonb; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "paused_by" uuid; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "paused_by_name" varchar(100); EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "pause_reason" text; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "voided_by" uuid; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "voided_by_name" varchar(100); EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "void_reason" text; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "replaced_by_permit_no" varchar(50); EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permits" ADD COLUMN IF NOT EXISTS "daily_override" varchar(20); EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "printed_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "paused_by" uuid; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "paused_by_name" varchar(100); EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "pause_reason" text; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "voided_by" uuid; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "voided_by_name" varchar(100); EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "void_reason" text; EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "replaced_by_permit_no" varchar(50); EXCEPTION WHEN others THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_permit_applications" ADD COLUMN IF NOT EXISTS "daily_override" varchar(20); EXCEPTION WHEN others THEN null; END $$;