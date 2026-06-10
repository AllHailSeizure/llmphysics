-- Adversarial reviewer async job queue
-- Each Reddit post gets at most one row (UNIQUE on post_id).
-- Devvit inserts a row; the DB webhook triggers the process-review Edge Function;
-- Devvit's scheduler polls for status = 'done' and posts the comment.

CREATE TABLE review_jobs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     TEXT        NOT NULL UNIQUE,
  pdf_url     TEXT,
  title       TEXT,
  body        TEXT,
  status      TEXT        NOT NULL DEFAULT 'queued',
    -- queued | processing | done | failed
  result      TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by the polling query: post_id + status
CREATE INDEX idx_review_jobs_post_status ON review_jobs (post_id, status);
