'use strict';

/**
 * ConnectionManager
 *
 * Tracks active SSE connections in memory.
 *
 * Structure:
 *   channelMap: Map<channel, Set<Connection>>
 *
 * where Connection = { userId, res, channels }
 */

/** @type {Map<string, Set<object>>} */
const channelMap = new Map();

/** Total connection count (for the active-connections endpoint). */
let totalConnections = 0;

/**
 * Register a new SSE connection.
 *
 * @param {string}   userId   - User identifier
 * @param {string[]} channels - List of channels this connection listens to
 * @param {object}   res      - Express Response object (the SSE stream)
 * @returns {object} connection handle (pass to removeConnection on close)
 */
function addConnection(userId, channels, res) {
    const conn = { userId, channels, res };

    for (const channel of channels) {
        if (!channelMap.has(channel)) {
            channelMap.set(channel, new Set());
        }
        channelMap.get(channel).add(conn);
    }

    totalConnections += 1;
    console.log(`[CM] +connection userId=${userId} channels=[${channels}] total=${totalConnections}`);
    return conn;
}

/**
 * Remove a connection from all channel sets.
 *
 * @param {object} conn - The connection handle returned by addConnection
 */
function removeConnection(conn) {
    for (const channel of conn.channels) {
        const set = channelMap.get(channel);
        if (set) {
            set.delete(conn);
            if (set.size === 0) {
                channelMap.delete(channel);
            }
        }
    }
    totalConnections = Math.max(0, totalConnections - 1);
    console.log(`[CM] -connection userId=${conn.userId} total=${totalConnections}`);
}

/**
 * Broadcast a formatted SSE event to all active connections on a channel.
 *
 * @param {string} channel
 * @param {{ id: number|string, eventType: string, payload: object }} event
 */
function broadcast(channel, event) {
    const set = channelMap.get(channel);
    if (!set || set.size === 0) {
        console.log(`[CM] broadcast channel=${channel} – no active subscribers`);
        return;
    }

    const message = formatSSE(event.id, event.eventType, event.payload);
    let delivered = 0;

    for (const conn of set) {
        try {
            conn.res.write(message);
            delivered += 1;
        } catch (err) {
            console.error(`[CM] Failed to write to userId=${conn.userId}: ${err.message}`);
        }
    }

    console.log(`[CM] broadcast channel=${channel} eventId=${event.id} delivered=${delivered}`);
}

/**
 * Format a single SSE message.
 *
 * @param {number|string} id
 * @param {string}        eventType
 * @param {object}        payload
 * @returns {string}
 */
function formatSSE(id, eventType, payload) {
    return `id: ${id}\nevent: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Return the current total number of active SSE connections.
 * @returns {number}
 */
function getConnectionCount() {
    return totalConnections;
}

/**
 * Return a summary of active connections per channel.
 * @returns {object}
 */
function getConnectionSummary() {
    const summary = {};
    for (const [channel, set] of channelMap.entries()) {
        summary[channel] = set.size;
    }
    return summary;
}

module.exports = {
    addConnection,
    removeConnection,
    broadcast,
    formatSSE,
    getConnectionCount,
    getConnectionSummary,
};
