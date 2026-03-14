'use strict';

const { Router } = require('express');

const router = Router();

/**
 * GET /health
 * Simple health check used by Docker healthcheck and load balancers.
 */
router.get('/', (_req, res) => {
    res.json({ status: 'ok' });
});

module.exports = router;
