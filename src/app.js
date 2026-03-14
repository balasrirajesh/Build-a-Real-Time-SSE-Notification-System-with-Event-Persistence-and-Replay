'use strict';

require('dotenv').config();
const express = require('express');

const healthRouter = require('./routes/health');
const eventsRouter = require('./routes/events');
const connectionsRouter = require('./routes/connections');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 8080;

// ── Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Logging (simple request logger) ────────────────────────
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ── Routes ──────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/api/events/active-connections', connectionsRouter);
app.use('/api/events', eventsRouter);

// ── 404 fallback ────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ─────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
    console.error('[app] Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[app] SSE Notification Service listening on port ${PORT}`);
});

module.exports = app;
