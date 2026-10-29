CREATE TABLE IF NOT EXISTS scheduler_account (
 id integer PRIMARY KEY CHECK(id=1), sequence bigint NOT NULL DEFAULT 0
);
INSERT INTO scheduler_account(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS scheduler_users (
 id text PRIMARY KEY, last_served bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS business_batches (
 id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES scheduler_users(id), descriptor jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PREPARING' CHECK(status IN ('PREPARING','READY','ABORTED')),
 projected_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES scheduler_users(id), request_id uuid NOT NULL,
 params jsonb NOT NULL, status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN
 ('QUEUED','SUBMITTING','SUBMISSION_UNKNOWN','GENERATING','REMOTE_SUCCEEDED','DOWNLOADING','DOWNLOADED','PROCESSING','SUCCEEDED','FAILED','CANCELLED','DOWNLOAD_FAILED','PROCESS_FAILED')),
 provider_task_id text UNIQUE, slot_reserved boolean NOT NULL DEFAULT false,
 submit_started boolean NOT NULL DEFAULT false, lease_token uuid, lease_until timestamptz,
 source_url text, file_path text, result_path text, error_code text,
 poll_attempts integer NOT NULL DEFAULT 0, download_attempts integer NOT NULL DEFAULT 0, process_attempts integer NOT NULL DEFAULT 0,
 next_action_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_id)
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,next_action_at);
CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_batch ON jobs((params->>'batchId'));
CREATE INDEX IF NOT EXISTS business_batches_task ON business_batches(user_id,(descriptor->>'taskId'),created_at DESC);
CREATE TABLE IF NOT EXISTS job_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs(id),
 status text NOT NULL, code text, created_at timestamptz NOT NULL DEFAULT now()
);
