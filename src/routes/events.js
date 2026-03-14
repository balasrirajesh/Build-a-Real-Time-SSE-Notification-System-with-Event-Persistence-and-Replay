'use strict';

const { Router } = require('express');
const db = require('../db');
const cm = require('../connectionManager');

const router = Router();

// ─────────────────────────────────────────────────────────────
// POST /api/events/publish
// Persist + broadcast a new event.
// ─────────────────────────────────────────────────────────────
router.post('/publish', async (req, res) => {
    const { channel, eventType, payload } = req.body;

    if (
        !channel || typeof channel !== 'string' ||
        !eventType || typeof eventType !== 'string' ||
        payload === undefined || payload === null
    ) {
        return res.status(400).json({
            error: 'Missing or invalid required fields: channel, eventType, payload',
        });
    }

    try {
        const result = await db.query(
            `INSERT INTO events (channel, event_type, payload)
       VALUES ($1, $2, $3)
       RETURNING id, channel, event_type AS "eventType", payload, created_at AS "createdAt"`,
            [channel, eventType, payload],
        );

        const event = result.rows[0];

        // Broadcast to all active subscribers
        cm.broadcast(channel, { id: event.id, eventType: event.eventType, payload: event.payload });

        return res.status(202).end();
    } catch (err) {
        console.error('[publish] Error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /api/events/channels/subscribe
// ─────────────────────────────────────────────────────────────
router.post('/channels/subscribe', async (req, res) => {
    const { userId, channel } = req.body;

    if (!userId || !channel) {
        return res.status(400).json({ error: 'Missing required fields: userId, channel' });
    }

    try {
        await db.query(
            `INSERT INTO user_subscriptions (user_id, channel)
       VALUES ($1, $2)
       ON CONFLICT (user_id, channel) DO NOTHING`,
            [String(userId), channel],
        );

        return res.status(201).json({ status: 'subscribed', userId, channel });
    } catch (err) {
        console.error('[subscribe] Error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /api/events/channels/unsubscribe
// ─────────────────────────────────────────────────────────────
router.post('/channels/unsubscribe', async (req, res) => {
    const { userId, channel } = req.body;

    if (!userId || !channel) {
        return res.status(400).json({ error: 'Missing required fields: userId, channel' });
    }

    try {
        await db.query(
            `DELETE FROM user_subscriptions WHERE user_id = $1 AND channel = $2`,
            [String(userId), channel],
        );

        return res.status(200).json({ status: 'unsubscribed', userId, channel });
    } catch (err) {
        console.error('[unsubscribe] Error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/events/channels?userId=1
// List all channels a user is subscribed to.
// ─────────────────────────────────────────────────────────────
router.get('/channels', async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'Missing required query parameter: userId' });
    }

    try {
        const result = await db.query(
            `SELECT channel, created_at AS "createdAt"
       FROM user_subscriptions
       WHERE user_id = $1
       ORDER BY created_at ASC`,
            [String(userId)],
        );

        return res.json({ userId, channels: result.rows });
    } catch (err) {
        console.error('[list-channels] Error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/events/history
// Paginated event history for a channel.
// Query params: channel (required), afterId (opt), limit (opt, default 50)
// ─────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
    const { channel, afterId, limit } = req.query;

    if (!channel) {
        return res.status(400).json({ error: 'Missing required query parameter: channel' });
    }

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 500); // cap at 500
    const parsedAfterId = afterId ? parseInt(afterId, 10) : 0;

    try {
        const result = await db.query(
            `SELECT
         id,
         channel,
         event_type AS "eventType",
         payload,
         created_at AS "createdAt"
       FROM events
       WHERE channel = $1
         AND id > $2
       ORDER BY id ASC
       LIMIT $3`,
            [channel, parsedAfterId, parsedLimit],
        );

        return res.json({ events: result.rows });
    } catch (err) {
        console.error('[history] Error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/events/stream
// SSE streaming endpoint.
// Query params: userId (required), channels (required, comma-separated)
// Headers:      Last-Event-ID (optional, for replay)
// ─────────────────────────────────────────────────────────────
router.get('/stream', async (req, res) => {
    const { userId, channels: channelsParam } = req.query;

    // ── Validate required params ──────────────────────────────
    if (!userId) {
        return res.status(400).json({ error: 'Missing required query parameter: userId' });
    }
    if (!channelsParam) {
        return res.status(400).json({ error: 'Missing required query parameter: channels' });
    }

    const requestedChannels = channelsParam
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

    if (requestedChannels.length === 0) {
        return res.status(400).json({ error: 'At least one channel must be specified' });
    }

    // ── Verify user subscriptions ─────────────────────────────
    try {
        const subResult = await db.query(
            `SELECT channel FROM user_subscriptions
       WHERE user_id = $1 AND channel = ANY($2::text[])`,
            [String(userId), requestedChannels],
        );

        const subscribedChannels = subResult.rows.map((r) => r.channel);
        const unauthorised = requestedChannels.filter((c) => !subscribedChannels.includes(c));

        if (unauthorised.length > 0) {
            return res.status(403).json({
                error: 'User is not subscribed to one or more requested channels',
                unauthorisedChannels: unauthorised,
            });
        }
    } catch (err) {
        console.error('[stream] Subscription check error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }

    // ── Set SSE headers ───────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // ── Event Replay (Last-Event-ID) ──────────────────────────
    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
        const parsedLastId = parseInt(lastEventId, 10);
        if (!isNaN(parsedLastId)) {
            try {
                const replayResult = await db.query(
                    `SELECT
             id,
             channel,
             event_type AS "eventType",
             payload
           FROM events
           WHERE channel = ANY($1::text[])
             AND id > $2
           ORDER BY id ASC`,
                    [requestedChannels, parsedLastId],
                );

                console.log(
                    `[stream] Replaying ${replayResult.rows.length} events for userId=${userId} after id=${parsedLastId}`,
                );

                for (const event of replayResult.rows) {
                    res.write(cm.formatSSE(event.id, event.eventType, event.payload));
                }
            } catch (err) {
                console.error('[stream] Replay error:', err.message);
                // Non-fatal: continue with live stream
            }
        }
    }

    // ── Register connection ───────────────────────────────────
    const conn = cm.addConnection(String(userId), requestedChannels, res);

    // ── Heartbeat (every 30 seconds) ─────────────────────────
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        } catch {
            // Client disconnected; cleanup will happen in 'close' handler
        }
    }, 30_000);

    // ── Cleanup on client disconnect ──────────────────────────
    req.on('close', () => {
        console.log(`[stream] Client disconnected userId=${userId}`);
        clearInterval(heartbeatInterval);
        cm.removeConnection(conn);
    });
});

module.exports = router;
