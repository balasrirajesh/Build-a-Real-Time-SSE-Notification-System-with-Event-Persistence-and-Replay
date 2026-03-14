'use strict';

const { Router } = require('express');
const cm = require('../connectionManager');

const router = Router();

/**
 * GET /api/events/active-connections
 * Returns the current number of active SSE connections.
 */
router.get('/', (_req, res) => {
    res.json({
        totalConnections: cm.getConnectionCount(),
        byChannel: cm.getConnectionSummary(),
    });
});

module.exports = router;
