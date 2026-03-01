CREATE INDEX idx_source_items_source_id ON source_items (source_id);
CREATE INDEX idx_source_items_url ON source_items (url) WHERE url IS NOT NULL;
CREATE INDEX idx_source_items_created_at ON source_items (created_at DESC);
CREATE INDEX idx_feed_items_feed_status ON feed_items (feed_id, status);
CREATE INDEX idx_feed_items_source_item ON feed_items (source_item_id);
CREATE INDEX idx_source_payloads_source_id ON source_payloads (source_id);
CREATE INDEX idx_source_runs_source_id ON source_runs (source_id, started_at DESC);