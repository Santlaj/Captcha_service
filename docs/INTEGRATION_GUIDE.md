# CAPTCHA-as-a-Service: Production Integration & Deployment Guide

This guide provides step-by-step instructions and ready-to-copy code snippets to integrate this CAPTCHA service into **any website** (React, Next.js, HTML/PHP, WordPress, Python, Node.js).

---

## Architecture Overview

```text
1. Client Browser                   2. External Website Backend             3. CAPTCHA Service
   │                                           │                                     │
   │─── (A) Solve CAPTCHA Challenge ───────────┼────────────────────────────────────>│
   │<── (B) Receive Signed JWT Token ──────────┼─────────────────────────────────────│
   │                                           │                                     │
   │─── (C) Submit Form + captchaToken ───────>│                                     │
   │                                           │─── (D) POST /api/v1/siteverify ────>│
   │                                           │<── (E) { success: true } ───────────│
   │                                           │                                     │
   │<── (F) Login / Form Successful ───────────│                                     │
```

---

## 1. Frontend Integration (Client-Side)

### Option A: React / Next.js

Import `<CaptchaWidget />` into your form:

```tsx
import React, { useState } from 'react';
import { CaptchaWidget } from '@captcha-service/react';

export function LoginForm() {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!captchaToken) {
      alert('Please solve the CAPTCHA first!');
      return;
    }

    // Submit form data + token to your own backend
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, captchaToken }),
    });

    const data = await res.json();
    if (data.success) {
      alert('Login successful!');
    } else {
      alert(`Login failed: ${data.message}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '360px' }}>
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      {/* CAPTCHA Widget */}
      <CaptchaWidget
        apiBaseUrl="https://captcha.yourdomain.com" // Your deployed CAPTCHA API
        siteKey="your_client_site_key"
        theme="light" // or "dark"
        onVerify={(token) => setCaptchaToken(token)}
      />

      <button type="submit">Log In</button>
    </form>
  );
}
```

---

### Option B: Plain HTML / PHP / WordPress / Any Website (Zero Dependencies)

Include the standalone script tag in your HTML `<head>` or before `</body>`:

```html
<!-- 1. Load the CAPTCHA script from your deployed service -->
<script src="https://captcha.yourdomain.com/captcha.js" async defer></script>

<!-- 2. Place this container inside any <form> -->
<form action="/login.php" method="POST">
  <input type="text" name="username" placeholder="Username" required />
  <input type="password" name="password" placeholder="Password" required />

  <!-- CAPTCHA Container (automatically creates <input type="hidden" name="captcha_token">) -->
  <div
    class="captcha-service"
    data-api-url="https://captcha.yourdomain.com"
    data-sitekey="your_client_site_key"
    data-theme="light">
  </div>

  <button type="submit">Log In</button>
</form>
```

When the user types the 6 digits, the script automatically generates `<input type="hidden" name="captcha_token" value="...">` inside the form. When the user submits, `captcha_token` is sent directly to your backend!

---

## 2. Backend Verification (`POST /api/v1/siteverify`)

Whenever a user submits a form, your website backend **must** verify the token with the CAPTCHA service.

- **Endpoint**: `POST https://captcha.yourdomain.com/api/v1/siteverify`
- **Payload**:
  - `secretKey`: Your server's private secret key
  - `token`: The verification token from the client (`req.body.captchaToken` or `$_POST['captcha_token']`)
- **Response**:
  ```json
  {
    "success": true,
    "challengeTimestamp": 1789849397,
    "hostname": "yourdomain.com"
  }
  ```
  *(Or if invalid/replayed: `{ "success": false, "errorCodes": ["timeout-or-duplicate"] }`)*

### Node.js / Express Integration

```typescript
import express from 'express';

const app = express();
app.use(express.json());

const CAPTCHA_API = 'https://captcha.yourdomain.com';
const CAPTCHA_SECRET_KEY = process.env.CAPTCHA_SECRET_KEY || 'your_secret_key_here';

app.post('/api/login', async (req, res) => {
  const { username, password, captchaToken } = req.body;

  if (!captchaToken) {
    return res.status(400).json({ success: false, message: 'CAPTCHA token required' });
  }

  // 1. Verify token with CAPTCHA Service
  const verifyRes = await fetch(`${CAPTCHA_API}/api/v1/siteverify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secretKey: CAPTCHA_SECRET_KEY,
      token: captchaToken,
    }),
  });

  const verifyData = await verifyRes.json();

  if (!verifyData.success) {
    return res.status(400).json({
      success: false,
      message: 'CAPTCHA verification failed or token already used (anti-replay)',
      errorCodes: verifyData.errorCodes,
    });
  }

  // 2. Token verified! Proceed with normal authentication
  // ... authenticate user credentials ...
  return res.json({ success: true, message: 'Welcome back!' });
});
```

---

### Python (FastAPI / Flask) Integration

```python
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

CAPTCHA_API = "https://captcha.yourdomain.com"
CAPTCHA_SECRET_KEY = "your_secret_key_here"

class LoginRequest(BaseModel):
    username: str
    password: str
    captcha_token: str

@app.post("/api/login")
def login(payload: LoginRequest):
    # 1. Verify token with CAPTCHA Service
    response = requests.post(
        f"{CAPTCHA_API}/api/v1/siteverify",
        json={"secretKey": CAPTCHA_SECRET_KEY, "token": payload.captcha_token},
        timeout=5,
    )
    result = response.json()

    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=f"CAPTCHA verification failed: {result.get('errorCodes')}"
        )

    # 2. Proceed with user login
    return {"success": True, "message": "Authenticated"}
```

---

### PHP / Laravel Integration

```php
<?php
// login.php
$username = $_POST['username'] ?? '';
$password = $_POST['password'] ?? '';
$captchaToken = $_POST['captcha_token'] ?? '';

if (empty($captchaToken)) {
    die("CAPTCHA is required");
}

$captchaApiUrl = 'https://captcha.yourdomain.com/api/v1/siteverify';
$secretKey = 'your_secret_key_here';

// Verify token
$ch = curl_init($captchaApiUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
    'secret' => $secretKey,
    'response' => $captchaToken,
]));

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);

if (!$result || empty($result['success'])) {
    die("CAPTCHA verification failed or token reused!");
}

// Proceed with login...
echo "Login successful!";
?>
```

---

## 3. Production Deployment Steps

### Step 1: Set Production Environment Variables
On your server or cloud provider (Render, Railway, AWS ECS, VPS):

```env
NODE_ENV=production
PORT=4000
HOST=0.0.0.0

# Generate a strong 32+ character secret:
JWT_SECRET=your_production_random_secret_at_least_32_chars_long
SITEVERIFY_SECRET_KEY=your_production_random_secret_at_least_32_chars_long

# Comma-separated domains of the websites that will display the CAPTCHA:
CORS_ORIGINS=https://mywebsite.com,https://app.mywebsite.com

# Redis connection for distributed locking and rate limiting
REDIS_URL=redis://redis-server:6379

# Reverse proxy setting (1 if behind Cloudflare/Nginx/AWS ALB)
TRUST_PROXY=1
```

### Step 2: Deploy with Docker Compose
If hosting on a VPS (Ubuntu / Debian):

```bash
# In the project root:
docker compose -f infra/docker-compose.yml up -d
```

### Step 3: Configure Reverse Proxy (Nginx) with SSL
Point your public domain (e.g. `captcha.yourdomain.com`) to port 4000:

```nginx
server {
    server_name captcha.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 443 ssl;
    # SSL certificates managed via Certbot / Let's Encrypt
}
```
