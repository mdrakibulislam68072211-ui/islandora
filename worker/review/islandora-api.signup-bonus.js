// Islandora main API Worker
// Prepared against the currently deployed islandora-api source and D1 schema.
// This file is for review only. Do not deploy until explicitly approved.

let jwksCache = null;
let jwksExpiresAt = 0;

const FIREBASE_PROJECT_ID = "islandora-c1f7b";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://islandora.pages.dev",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getFirebaseKeys(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && jwksCache && now < jwksExpiresAt) return jwksCache;

  const result = await fetch(JWKS_URL, {
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  if (!result.ok) throw new Error("Unable to retrieve Firebase public keys.");

  const data = await result.json();
  if (!Array.isArray(data.keys)) throw new Error("Invalid Firebase public keys.");

  jwksCache = data.keys;
  jwksExpiresAt = now + 3600000;
  return jwksCache;
}

async function verifyFirebaseToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid authentication token.");

  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Invalid token algorithm.");

  let keys = await getFirebaseKeys();
  let jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) {
    keys = await getFirebaseKeys(true);
    jwk = keys.find(key => key.kid === header.kid);
  }
  if (!jwk) throw new Error("Unknown Firebase signing key.");

  const publicKey = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = decodeBase64Url(parts[2]);
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", publicKey, signature, signedData
  );
  if (!validSignature) throw new Error("Invalid token signature.");

  const now = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== FIREBASE_PROJECT_ID ||
    payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
    !payload.sub || payload.sub.length > 128 ||
    !payload.exp || payload.exp <= now ||
    !payload.iat || payload.iat > now + 300 ||
    !payload.auth_time || payload.auth_time > now + 300
  ) {
    throw new Error("Invalid or expired Firebase token.");
  }
  return payload;
}

async function authenticateRequest(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required.");
  const token = authorization.slice(7).trim();
  if (!token) throw new Error("Authentication token missing.");
  return verifyFirebaseToken(token);
}

async function syncUser(request, env) {
  let payload;
  try {
    payload = await authenticateRequest(request);
  } catch (error) {
    return response({ success: false, error: "Unauthorized", message: error.message }, 401);
  }

  const uid = payload.sub;
  const email = payload.email || "";
  if (!email) return response({ success: false, error: "Email not available." }, 400);

  try {
    // A database trigger records the bonus ledger in the same atomic INSERT.
    // ON CONFLICT DO NOTHING means returning users never receive another bonus.
    await env.DB.prepare(`
      INSERT INTO users (
        firebase_uid, email, gems, coins, signup_bonus_granted, account_status
      )
      VALUES (?, ?, 1000, 0, 1, 'active')
      ON CONFLICT(firebase_uid) DO NOTHING
    `).bind(uid, email).run();

    // Preserve the existing email-sync behavior for both new and returning users.
    await env.DB.prepare(`
      UPDATE users
      SET email = ?, updated_at = CURRENT_TIMESTAMP
      WHERE firebase_uid = ?
    `).bind(email, uid).run();

    const user = await env.DB.prepare(`
      SELECT firebase_uid, email, gems, coins, signup_bonus_granted,
             account_status, created_at
      FROM users
      WHERE firebase_uid = ?
    `).bind(uid).first();

    if (!user || user.account_status !== "active") {
      return response({ success: false, error: "Account unavailable." }, 403);
    }

    return response({
      success: true,
      message: "Authentication successful.",
      user
    });
  } catch (error) {
    console.error("User sync error:", error);
    return response({
      success: false,
      error: "Unable to synchronize user account."
    }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      if (request.method !== "GET") {
        return response({ error: "Method not allowed." }, 405);
      }
      try {
        const result = await env.DB.prepare("SELECT 1 AS connected").first();
        return response({
          success: true,
          app: "Islandora",
          worker: "online",
          database: result?.connected === 1 ? "connected" : "error"
        });
      } catch (error) {
        console.error("Health check error:", error);
        return response({
          success: false,
          app: "Islandora",
          worker: "online",
          database: "error"
        }, 500);
      }
    }

    if (url.pathname === "/api/auth/sync" && request.method === "POST") {
      return syncUser(request, env);
    }

    return response({ success: false, error: "Route not found." }, 404);
  }
};
