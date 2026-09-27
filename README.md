# Real-Time Chat Backend

Backend for the assignment using:

- Node.js + Express
- TypeScript
- PostgreSQL
- Socket.io
- JWT access tokens
- Rotating refresh tokens in an httpOnly cookie
- bcrypt password hashing
- Zod validation

## 1. Local setup

Requirements:

- Node.js 20+
- PostgreSQL 14+

Copy:

```bash
cp .env.example .env
```

Create the database, then:

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Server:

```text
http://localhost:4000
```

Health:

```text
GET http://localhost:4000/health
```

Seed users all use:

```text
Password123!
```

Emails:

```text
rahul@example.com
priya@example.com
amit@example.com
sneha@example.com
vikram@example.com
neha@example.com
```

## 2. Docker

```bash
docker compose up --build
```

Postgres:

```text
localhost:5432
```

API:

```text
localhost:4000
```

The schema is loaded automatically when the PostgreSQL volume is first created.

If you need a clean database:

```bash
docker compose down -v
docker compose up --build
```

## 3. Authentication

Signup:

```http
POST /api/auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password123!",
  "name": "User"
}
```

Login:

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password123!"
}
```

Response:

```json
{
  "accessToken": "...",
  "user": {
    "id": "...",
    "email": "...",
    "name": "User",
    "avatarUrl": null
  }
}
```

The refresh token is stored in:

```text
httpOnly cookie: refresh_token
```

Refresh:

```http
POST /api/auth/refresh
```

Logout:

```http
POST /api/auth/logout
```

Protected APIs require:

```http
Authorization: Bearer <accessToken>
```

## 4. REST endpoints

### Users

```text
GET /api/users/search?q=rahul
GET /api/users/:id
```

### Conversations

```text
GET  /api/conversations
POST /api/conversations/direct
POST /api/conversations/group

GET    /api/conversations/:id
GET    /api/conversations/:id/messages?cursor=<messageId>&limit=30
POST   /api/conversations/:id/read
GET    /api/conversations/:id/members

PATCH  /api/conversations/:id
DELETE /api/conversations/:id

POST   /api/conversations/:id/members
DELETE /api/conversations/:id/members/:memberId
PATCH  /api/conversations/:id/members/:memberId/role
POST   /api/conversations/:id/transfer-ownership
```

### Messages

```text
PATCH  /api/messages/:id
DELETE /api/messages/:id

POST   /api/messages/:id/reactions
DELETE /api/messages/:id/reactions?emoji=❤️
```

## 5. Socket.io

Connect with:

```ts
const socket = io("http://localhost:4000", {
  auth: {
    token: accessToken
  }
});
```

Events:

```text
conversation:join
conversation:leave

message:send
message:edit
message:delete

reaction:add
reaction:remove

message:read

typing:start
typing:stop

group:remove-member
```

Server events:

```text
socket:ready
message:new
message:updated
reaction:updated
message:read
typing:update
presence:update
member:removed
conversation:removed
```

Every sensitive event verifies membership/ownership on the server.

## 6. Security notes

- Passwords are bcrypt hashed.
- Refresh tokens are hashed before storage.
- Refresh tokens rotate on refresh.
- Access tokens are short-lived.
- REST endpoints use Authorization bearer tokens.
- Socket handshake verifies the access token.
- Socket events verify conversation membership.
- Group permissions are checked from PostgreSQL membership rows.
- Direct conversations use a deterministic unique key.
- Messages use `(sender_id, client_message_id)` for retry deduplication.
- Deleted messages can only be deleted by their sender and within 10 minutes.
- JSON payloads are size-limited.
- Authentication routes are rate-limited.
- CORS requires the configured frontend origin.

## 7. Important production additions

Before production, also add:

- Redis adapter for Socket.io if running multiple server instances.
- CSRF protection appropriate to your deployment topology.
- Strong randomly generated JWT secrets.
- HTTPS and secure cookies.
- More aggressive per-user/socket rate limits.
- Structured logging.
- Audit logs for membership/role changes.
- Automated tests for every authorization rule.
- File storage such as S3/Supabase Storage for uploads.
