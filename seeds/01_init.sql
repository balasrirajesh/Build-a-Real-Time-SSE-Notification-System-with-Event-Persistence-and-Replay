-- ============================================================
-- 01_init.sql  –  SSE Notification System Schema & Seed Data
-- ============================================================

-- ----------------------------
-- Table: users
-- ----------------------------
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY
);

INSERT INTO users (id) VALUES (1), (2) ON CONFLICT DO NOTHING;

-- ----------------------------
-- Table: events
-- Stores every published notification for persistence & replay.
-- ----------------------------
CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL    PRIMARY KEY,
  channel    VARCHAR(255) NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  payload    JSONB        NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index for efficient replay queries: WHERE channel = ? AND id > ?
CREATE INDEX IF NOT EXISTS idx_events_channel_id ON events (channel, id);
-- Additional index for time-based queries
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);

-- ----------------------------
-- Table: user_subscriptions
-- Tracks which users are subscribed to which channels.
-- ----------------------------
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id    VARCHAR(255) NOT NULL,
  channel    VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel)
);

-- ----------------------------
-- Seed Data
-- ----------------------------

-- User 1 subscriptions
INSERT INTO user_subscriptions (user_id, channel) VALUES
  ('1', 'notifications'),
  ('1', 'alerts'),
  ('1', 'channel-a'),
  ('1', 'replay-channel'),
  ('1', 'history-channel'),
  ('1', 'test-stream-channel')
ON CONFLICT (user_id, channel) DO NOTHING;

-- User 2 subscriptions
INSERT INTO user_subscriptions (user_id, channel) VALUES
  ('2', 'notifications'),
  ('2', 'updates'),
  ('2', 'channel-b'),
  ('2', 'replay-channel')
ON CONFLICT (user_id, channel) DO NOTHING;

-- Sample events for the notifications channel
INSERT INTO events (channel, event_type, payload) VALUES
  ('notifications', 'USER_NOTIFICATION', '{"message": "Welcome to the platform!", "userId": 1}'),
  ('notifications', 'USER_NOTIFICATION', '{"message": "Your profile has been updated.", "userId": 2}'),
  ('notifications', 'USER_NOTIFICATION', '{"message": "You have a new friend request.", "userId": 1}');

-- Sample events for alerts channel
INSERT INTO events (channel, event_type, payload) VALUES
  ('alerts', 'SYSTEM_ALERT', '{"message": "Scheduled maintenance in 1 hour.", "severity": "warning"}'),
  ('alerts', 'SYSTEM_ALERT', '{"message": "Server capacity at 80%.", "severity": "info"}');

-- Sample events for updates channel
INSERT INTO events (channel, event_type, payload) VALUES
  ('updates', 'UPDATE', '{"version": "1.0.1", "notes": "Bug fixes and performance improvements"}'),
  ('updates', 'UPDATE', '{"version": "1.1.0", "notes": "New SSE streaming feature added"}');

-- Sample events for replay-channel (for replay testing)
INSERT INTO events (channel, event_type, payload) VALUES
  ('replay-channel', 'REPLAY_TEST', '{"message": "Replay event 1", "seq": 1}'),
  ('replay-channel', 'REPLAY_TEST', '{"message": "Replay event 2", "seq": 2}'),
  ('replay-channel', 'REPLAY_TEST', '{"message": "Replay event 3", "seq": 3}');

-- Sample events for history-channel (10 events for pagination testing)
INSERT INTO events (channel, event_type, payload) VALUES
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 1",  "seq": 1}'),
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 2",  "seq": 2}'),
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 3",  "seq": 3}'),
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 4",  "seq": 4}'),
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 5",  "seq": 5}'),
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 6",  "seq": 6}'),
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 7",  "seq": 7}'),
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 8",  "seq": 8}'),
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 9",  "seq": 9}'),
  ('history-channel', 'HISTORY_EVENT', '{"message": "History event 10", "seq": 10}');

-- channel-a events (for channel isolation testing)
INSERT INTO events (channel, event_type, payload) VALUES
  ('channel-a', 'CHANNEL_EVENT', '{"message": "Event on channel-a"}');

-- channel-b events (user 1 should NOT receive these)
INSERT INTO events (channel, event_type, payload) VALUES
  ('channel-b', 'CHANNEL_EVENT', '{"message": "Event on channel-b"}');
