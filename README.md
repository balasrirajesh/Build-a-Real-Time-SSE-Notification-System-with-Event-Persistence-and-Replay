# Real-Time SSE Notification System

A production-ready **Server-Sent Events (SSE)** notification service built with **Node.js + Express** and **PostgreSQL**. Supports persistent event storage, real-time broadcasting, and client-side reconnection replay via the `Last-Event-ID` header.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       Docker Compose                         │
│                                                              │
│   ┌───────────────────────────┐   ┌──────────────────────┐  │
│   │   app  (Node.js/Express)  │   │   db  (PostgreSQL 13) │  │
│   │                           │   │                       │  │
│   │  /health                  │   │  events               │  │
│   │  /api/events/stream (SSE) │──▶│  user_subscriptions   │  │
│   │  /api/events/publish      │   │                       │  │
│   │  /api/events/channels/..  │   └──────────────────────┘  │
│   │  /api/events/history      │                              │
│   │  /api/events/active-..    │                              │
│   └───────────────────────────┘                              │
│           :8080                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **In-memory connection map** – channels mapped to `Set<Response>` for O(1) broadcast
- **Subscription gating** – SSE stream validates `user_subscriptions` before accepting connection
- **Event replay** – `Last-Event-ID` triggers a DB query for missed events before resuming live stream
- **Heartbeat** – `: heartbeat` comment sent every 30s to prevent proxy timeouts

---

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)

### Run

```bash
git clone <repo-url>
cd sse-notification-service
docker-compose up --build
```

The service is ready when you see:
```
app    | [app] SSE Notification Service listening on port 8080
```

Both containers include healthchecks. The app waits for PostgreSQL to be healthy before starting.

---

## Environment Variables

See `.env.example` for all variables:

| Variable        | Default                                        | Description             |
|-----------------|------------------------------------------------|-------------------------|
| `DATABASE_URL`  | `postgresql://user:password@db:5432/eventsdb`  | PostgreSQL connection   |
| `PORT`          | `8080`                                         | HTTP server port        |

---

## API Reference

### Health Check
```
GET /health
→ 200 { "status": "ok" }
```

### Publish Event
```
POST /api/events/publish
Content-Type: application/json

{ "channel": "alerts", "eventType": "SYSTEM_ALERT", "payload": { "message": "hello" } }

→ 202 (empty body)
```

### Subscribe to Channel
```
POST /api/events/channels/subscribe
Content-Type: application/json

{ "userId": 1, "channel": "alerts" }

→ 201 { "status": "subscribed", "userId": 1, "channel": "alerts" }
```

### Unsubscribe from Channel
```
POST /api/events/channels/unsubscribe
Content-Type: application/json

{ "userId": 1, "channel": "alerts" }

→ 200 { "status": "unsubscribed", "userId": 1, "channel": "alerts" }
```

### List User's Channels
```
GET /api/events/channels?userId=1
→ 200 { "userId": 1, "channels": [ ... ] }
```

### Event History (Paginated)
```
GET /api/events/history?channel=notifications&limit=5&afterId=0
→ 200 { "events": [ ... ] }
```

### Active Connections
```
GET /api/events/active-connections
→ 200 { "totalConnections": 2, "byChannel": { "alerts": 1 } }
```

### SSE Stream
```
GET /api/events/stream?userId=1&channels=notifications,alerts
→ text/event-stream

SSE message format:
id: 42
event: USER_NOTIFICATION
data: {"message":"Hello!"}
```

Heartbeat (every 30s):
```
: heartbeat
```

Reconnection replay:
```bash
curl -N -H "Last-Event-ID: 10" \
  "http://localhost:8080/api/events/stream?userId=1&channels=notifications"
# Streams all events with id > 10 before resuming live
```

---

## Testing Guide

### 1. Health check
```bash
curl http://localhost:8080/health
```

### 2. Open SSE stream (Terminal 1)
```bash
curl -N "http://localhost:8080/api/events/stream?userId=1&channels=notifications,alerts"
```

### 3. Publish an event (Terminal 2)
```bash
curl -X POST http://localhost:8080/api/events/publish \
  -H "Content-Type: application/json" \
  -d '{"channel":"notifications","eventType":"USER_NOTIFICATION","payload":{"message":"Live event!"}}'
```
You should see the event appear in Terminal 1 immediately.

### 4. Test event replay
```bash
# Publish a few events to replay-channel (user 1 is pre-subscribed)
curl -X POST http://localhost:8080/api/events/publish \
  -H "Content-Type: application/json" \
  -d '{"channel":"replay-channel","eventType":"REPLAY_TEST","payload":{"seq":4}}'

# Check history to see IDs
curl "http://localhost:8080/api/events/history?channel=replay-channel"

# Connect with Last-Event-ID to replay missed events
curl -N -H "Last-Event-ID: <first-id>" \
  "http://localhost:8080/api/events/stream?userId=1&channels=replay-channel"
```

### 5. Test heartbeat
```bash
# Connect and wait 35s – you'll see ": heartbeat" in the output
curl -N "http://localhost:8080/api/events/stream?userId=1&channels=notifications"
```

### 6. Test channel isolation
```bash
# Terminal 1: listen on channel-a (user 1 is subscribed)
curl -N "http://localhost:8080/api/events/stream?userId=1&channels=channel-a"

# Terminal 2: publish to channel-b (user 1 NOT subscribed, user 2 IS)
curl -X POST http://localhost:8080/api/events/publish \
  -H "Content-Type: application/json" \
  -d '{"channel":"channel-b","eventType":"CHANNEL_EVENT","payload":{"msg":"invisible to user1"}}'
# → No event appears in Terminal 1

# Publish to channel-a
curl -X POST http://localhost:8080/api/events/publish \
  -H "Content-Type: application/json" \
  -d '{"channel":"channel-a","eventType":"CHANNEL_EVENT","payload":{"msg":"visible to user1"}}'
# → Event appears in Terminal 1
```

---

## Database Schema

### `events`
| Column       | Type          | Notes                     |
|-------------|---------------|---------------------------|
| `id`         | BIGSERIAL PK  | Auto-increment             |
| `channel`    | VARCHAR(255)  | NOT NULL                   |
| `event_type` | VARCHAR(255)  | NOT NULL                   |
| `payload`    | JSONB         | NOT NULL                   |
| `created_at` | TIMESTAMPTZ   | DEFAULT NOW()              |

Index: `(channel, id)` for efficient replay queries.

### `user_subscriptions`
| Column       | Type          | Notes                     |
|-------------|---------------|---------------------------|
| `user_id`    | VARCHAR(255)  | Part of composite PK       |
| `channel`    | VARCHAR(255)  | Part of composite PK       |
| `created_at` | TIMESTAMPTZ   | DEFAULT NOW()              |

---

## Project Structure

```
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── submission.json
├── package.json
├── README.md
├── seeds/
│   └── 01_init.sql          # Schema + seed data
└── src/
    ├── app.js               # Express entry point
    ├── db.js                # PostgreSQL connection pool
    ├── connectionManager.js # In-memory SSE connection tracker
    └── routes/
        ├── health.js        # GET /health
        ├── connections.js   # GET /api/events/active-connections
        └── events.js        # All /api/events/* routes
```
#   B u i l d - a - R e a l - T i m e - S S E - N o t i f i c a t i o n - S y s t e m - w i t h - E v e n t - P e r s i s t e n c e - a n d - R e p l a y  
 