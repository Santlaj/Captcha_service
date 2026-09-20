# CAPTCHA-as-a-Service Platform

A self-hostable CAPTCHA service built with Node.js, Express.js, TypeScript, and React. Designed to protect web forms using numeric image challenges and cryptographically signed JWT verification tokens.

---

## Tech Stack

- **Backend**: Node.js + Express.js + TypeScript (Strict MVC Architecture)
- **Monorepo**: pnpm workspaces + Turborepo
- **Storage & Rate Limiting**: Redis 7 (via `ioredis` with atomic Lua scripts)
- **Token Signing**: JSON Web Tokens via `jose`
- **Challenge Rendering**: `@napi-rs/canvas`
- **Validation**: Zod
- **Infrastructure**: Docker Compose (PostgreSQL 16 & Redis 7)

---

## Backend MVC Architecture (`apps/api/src/`)

```text
HTTP Request
     │
     ▼
[Middleware Layer]
  ├── Security headers (Helmet)
  ├── CORS origin checks
  ├── Body parsing (express.json)
  ├── Rate limiter (Redis-backed, 429 on abuse)
  └── Request body validation (Zod)
     │
     ▼
[Routes Layer] (`src/routes/`)
  ├── GET  /health                     -> HealthController
  ├── GET  /api/v1/challenge           -> ChallengeController.createChallenge
  ├── GET  /api/v1/challenge/preview   -> ChallengeController.getPreview (Dev only)
  └── POST /api/v1/solution            -> SolutionController.verifySolution
     │
     ▼
[Controllers Layer] (`src/controllers/`)
  └── Parses HTTP params/body, delegates to Services, sends JSON. No business logic.
     │
     ▼
[Services Layer] (`src/services/`)
  ├── ChallengeService (answer generation, canvas rendering, verification flow)
  └── TokenService (JWT signing and token verification utility with jose)
     │
     ▼
[Repositories Layer] (`src/repositories/`)
  └── RedisChallengeRepository (Atomic Lua verification, TTL expiration)
```

---

## API Endpoints

### 1. Create a Challenge

Request a new numeric image CAPTCHA.

- **URL**: `GET /api/v1/challenge`
- **Rate Limit**: Default 60 requests/minute per IP
- **Cache-Control**: `no-store, no-cache, must-revalidate`

**Response (`200 OK`)**:
```json
{
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAABQCAY...",
  "expiresAt": "2026-09-19T18:35:00.000Z"
}
```
*Note: The correct numeric answer is kept exclusively server-side in Redis and is NEVER returned in the response.*

---

### 2. Submit a Solution

Verify the user's solved 6-digit answer.

- **URL**: `POST /api/v1/solution`
- **Content-Type**: `application/json`
- **Rate Limit**: Default 30 requests/minute per IP

**Request Body**:
```json
{
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "answer": "004281"
}
```

**Success Response (`200 OK`)**:
```json
{
  "success": true,
  "verificationToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2026-09-19T18:35:00.000Z"
}
```
*Upon a correct answer, the challenge is atomically deleted from Redis so it cannot be reused.*

**Error Responses (`400 Bad Request`)**:
- Incorrect answer:
  ```json
  {
    "success": false,
    "error": "Incorrect CAPTCHA answer",
    "details": {
      "code": "INVALID_ANSWER",
      "remainingAttempts": 4
    }
  }
  ```
- Maximum attempts exceeded (challenge invalidated):
  ```json
  {
    "success": false,
    "error": "Maximum verification attempts exceeded. Challenge has been invalidated.",
    "details": {
      "code": "ATTEMPTS_EXCEEDED"
    }
  }
  ```
- Expired or missing challenge:
  ```json
  {
    "success": false,
    "error": "Challenge has expired or does not exist. Please request a new CAPTCHA.",
    "details": {
      "code": "CHALLENGE_EXPIRED_OR_NOT_FOUND"
    }
  }
  ```

---

## Verifying the Token in Backend Applications

When your frontend submits a protected form with the `verificationToken`, verify it on your backend using the `TokenService` utility or any standard JWT verification library with your shared `JWT_SECRET`:

```typescript
import { TokenService } from '@captcha-service/api/services/token.service';

const tokenService = new TokenService(process.env.JWT_SECRET, 'HS256', 300);

try {
  const claims = await tokenService.verifyVerificationToken(verificationToken);
  console.log('Verified challenge ID:', claims.sub);
  console.log('Token ID (JTI):', claims.jti);
  // Valid token — proceed with user registration or sensitive action
} catch (error) {
  // Token is expired, invalid, tampered, or wrong type
  throw new Error('CAPTCHA verification failed');
}
```

### Important Security Note: Replay Protection
A signed JWT proves that a CAPTCHA was successfully verified within the token's validity window. However, a signed JWT is **not automatically single-use by itself**. To prevent token reuse in your application backend, record the token's unique ID (`claims.jti`) in a database or Redis cache upon redemption.

---

## Environment Variables Configuration

Copy `.env.example` to `.env` and set appropriate values:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `4000` | API port |
| `HOST` | `0.0.0.0` | API listening host |
| `NODE_ENV` | `development` | Environment mode (`development`, `production`, `test`) |
| `REDIS_URL` | `redis://localhost:6379` | Connection string for Redis |
| `CAPTCHA_TTL_SECONDS` | `300` | Expiration lifetime for active challenges (5 min) |
| `MAX_VERIFICATION_ATTEMPTS` | `5` | Maximum failed attempts allowed before challenge is deleted |
| `JWT_SECRET` | *(secret string)* | Secret for signing tokens (minimum 32 characters in production) |
| `JWT_ALGORITHM` | `HS256` | Explicit signing algorithm (`HS256`, `HS384`, `HS512`) |
| `JWT_EXPIRES_IN_SECONDS` | `300` | Token expiration time (5 min) |
| `RATE_LIMIT_CHALLENGE_PER_MINUTE` | `60` | Max challenge creation requests per minute per IP |
| `RATE_LIMIT_SOLUTION_PER_MINUTE` | `30` | Max solution submissions per minute per IP |
| `TRUST_PROXY` | `false` | Express `trust proxy` setting (`false`, `1`, `true`, or subnet CIDR) |
| `ENABLE_PREVIEW_ENDPOINT` | `true` (false in prod) | Whether `GET /api/v1/challenge/preview` is accessible |

---

## Production Security & Deployment Architecture

### 1. Safe Token Signing Flow
In high-throughput distributed architectures, token issuance must never desynchronize from challenge consumption:
- **Pre-Sign in Memory First**: The JWT token is created and signed in-memory *before* issuing the Redis deletion command.
- **Fail-Safe**: If cryptographic signing fails (e.g. key fault), Redis is completely untouched, preserving the user's challenge and remaining attempt counts.
- **Atomic Single-Use**: If signing succeeds, Redis executes an atomic Lua script `verifyAndConsume` that verifies the answer and deletes the key in a single atomic transaction. No race condition can ever issue multiple valid tokens for the same challenge.

### 2. Trusted Proxy & Client IP Handling
To prevent IP spoofing and ensure rate limits apply to actual client IPs:
- **Direct Internet Deployment**: Default `TRUST_PROXY=false`. Express strictly ignores client-supplied `X-Forwarded-*` headers and uses the TCP socket address.
- **Behind Reverse Proxy (AWS ALB, Cloudflare, Nginx)**: Set `TRUST_PROXY=1` (or your proxy's subnet/CIDR, e.g. `10.0.0.0/8`). Express extracts the correct client IP from the rightmost untrusted hop, preventing attackers from injecting spoofed IPs.
- **Never blindly trust arbitrary headers**: Setting `trust proxy` to `true` is only recommended within private VPCs where ingress headers are stripped at the perimeter.

### 3. Fail-Closed Rate Limiting
- **Production**: If Redis becomes unavailable, the rate limiter middleware returns `HTTP 503 Service Unavailable` with `Retry-After: 30` and code `RATE_LIMIT_UNAVAILABLE`. This ensures attackers cannot overwhelm protected endpoints during cache outages.
- **Development & Testing**: Logs a warning and allows requests through to enable offline local development without requiring a live Redis daemon.

### 5. CORS, Request Size Limits & HTTP Security
- **Configurable CORS Allowlist**: Controlled by `CORS_ORIGINS`. In development, defaults to local Vite/React ports (`localhost:3000,localhost:5173,localhost:5174,localhost:5175,localhost:5180`). In production, specify exact trusted frontend domains.
- **Credential Protection**: Wildcard origins (`*`) automatically disable `credentials` (`Access-Control-Allow-Credentials: false`).
- **Strict Request Size Limit**: Express body parser enforces a strict **10KB** limit (`express.json({ limit: '10kb' })`). Requests exceeding this limit receive `HTTP 413 Payload Too Large` (`PAYLOAD_TOO_LARGE`).
- **Helmet Security Headers**: Configured with `Cross-Origin-Resource-Policy: cross-origin` so protected client web apps can load challenges securely while enforcing `X-Content-Type-Options: nosniff` and `X-Frame-Options: SAMEORIGIN`.
- **Pre-Validation Shield**: Inbound POST bodies are strictly validated with Zod `.strict()` *before* invoking rate limiting or Redis queries, rejecting unexpected or malicious properties with `400 Bad Request` in-memory.

### 6. Verification Token Scope vs. User Authentication
> [!IMPORTANT]
> **A CAPTCHA verification token only certifies that a human solved a challenge.**
> It does NOT authenticate or authorize a user, establish an identity session, or grant permissions. Applications must never treat a CAPTCHA token as a session credential.
>
> Additionally, tokens can be reused until their `exp` expiration unless the consumer backend records the token ID (`claims.jti`) in a database or Redis cache upon first redemption.

---

## API Error Codes Reference

All error responses adhere to the standard JSON structure:
```json
{
  "success": false,
  "error": "<human readable message>",
  "code": "<ERROR_CODE>",
  "details": {},
  "timestamp": "2026-09-20T00:30:00.000Z"
}
```

| HTTP Status | Error Code | Description |
| :--- | :--- | :--- |
| `400` | `INVALID_ANSWER` | Submitted answer does not match the challenge secret. |
| `400` | `ATTEMPTS_EXCEEDED` | Maximum verification attempts reached; challenge invalidated. |
| `400` | `CHALLENGE_EXPIRED_OR_NOT_FOUND` | Challenge has expired or does not exist in Redis. |
| `400` | `MALFORMED_JSON` | Body cannot be parsed as valid JSON syntax. |
| `400` | `BAD_REQUEST` | Validation error (e.g. non-numeric answer, non-UUID challengeId, extra fields). |
| `403` | `CORS_FORBIDDEN` | Request origin is not permitted by server CORS policy. |
| `404` | `NOT_FOUND` | Route does not exist or preview endpoint is disabled in production. |
| `413` | `PAYLOAD_TOO_LARGE` | Request payload exceeds the 10KB size limit. |
| `429` | `RATE_LIMIT_EXCEEDED` | Client IP exceeded challenge creation or verification rate limits. |
| `503` | `RATE_LIMIT_UNAVAILABLE` | Redis rate-limiting service unreachable in production (fails closed). |

---

## Getting Started

### Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0`
- **Docker**: (For Redis)

### Step 1: Install Dependencies
```bash
pnpm install
```

### Step 2: Configure Environment
```bash
cp .env.example .env
```

### Step 3: Start Redis Container
```bash
docker compose -f infra/docker-compose.yml up -d redis
```

### Step 4: Run the Complete Test Suite
Runs all unit, security hardening, trusted proxy, and Redis integration tests (gracefully skips Redis tests if the Redis container is offline):
```bash
pnpm --filter @captcha-service/api test
```

### Step 5: Start the API Development Server
```bash
pnpm --filter @captcha-service/api dev
```

Test the API:
- Create a challenge: `curl http://localhost:4000/api/v1/challenge`
- Inspect in preview (dev only): `http://localhost:4000/api/v1/challenge/preview`
- Submit a solution:
  ```bash
  curl -X POST http://localhost:4000/api/v1/solution \
    -H "Content-Type: application/json" \
    -d '{"challengeId":"<uuid>","answer":"123456"}'
  ```

### Step 6: Start the React Interactive Playground
In a separate terminal, launch the demo frontend on `http://localhost:5175`:
```bash
pnpm --filter @captcha-service/playground dev
```
