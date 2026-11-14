ALTER TABLE app.listings
  ADD COLUMN max_group_join_days SMALLINT NOT NULL DEFAULT 7
    CHECK (max_group_join_days BETWEEN 1 AND 7);
