
const ALLOWED_ORIGIN = "*";
const FIREBASE_PROJECT_ID = "islandora-c1f7b";

let cachedKeys = null;
let keysExpiresAt = 0;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Internal-Secret",
      "Vary": "Origin"
    }
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Internal-Secret",
      "Vary": "Origin"
    }
  });
}

function base64UrlToBytes(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);

  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(value))
  );
}

async function getFirebaseKeys() {
  if (cachedKeys && Date.now() < keysExpiresAt) {
    return cachedKeys;
  }

  const response = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  );

  if (!response.ok) {
    throw new Error("Firebase public keys unavailable.");
  }

  const data = await response.json();

  cachedKeys = data.keys;
  keysExpiresAt = Date.now() + 3600000;

  return cachedKeys;
}

async function verifyFirebaseToken(request) {
  const authorization = request.headers.get("Authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    throw new Error("Authentication required.");
  }

  const token = authorization.slice(7);
  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid authentication token.");
  }

  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid token algorithm.");
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    payload.aud !== FIREBASE_PROJECT_ID ||
    payload.iss !==
      `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
    !payload.sub ||
    payload.sub !== payload.user_id ||
    payload.exp <= now ||
    payload.iat > now ||
    payload.auth_time > now
  ) {
    throw new Error("Authentication token expired or invalid.");
  }

  const keys = await getFirebaseKeys();
  const jwk = keys.find(key => key.kid === header.kid);

  if (!jwk) {
    cachedKeys = null;
    throw new Error("Authentication key not found.");
  }

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["verify"]
  );

  const signedData = new TextEncoder().encode(
    `${parts[0]}.${parts[1]}`
  );

  const signature = base64UrlToBytes(parts[2]);

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signature,
    signedData
  );

  if (!valid) {
    throw new Error("Authentication signature invalid.");
  }

  return {
    uid: payload.sub,
    email: payload.email || ""
  };
}

async function hashDeviceToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateReferralCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));

  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureReferralCode(db, uid) {
  const user = await db.prepare(
    "SELECT referral_code FROM users WHERE firebase_uid = ?"
  ).bind(uid).first();

  if (!user) {
    throw new Error("User account not found.");
  }

  if (user.referral_code) {
    return user.referral_code;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();

    try {
      await db.prepare(
        `UPDATE users
         SET referral_code = ?
         WHERE firebase_uid = ?
         AND referral_code IS NULL`
      ).bind(code, uid).run();

      const updated = await db.prepare(
        "SELECT referral_code FROM users WHERE firebase_uid = ?"
      ).bind(uid).first();

      if (updated && updated.referral_code) {
        return updated.referral_code;
      }
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }

  throw new Error("Could not create referral code.");
}

async function saveDevice(db, uid, token, fingerprintHash) {
  if (
    typeof token !== "string" ||
    token.length < 20 ||
    token.length > 256
  ) throw new Error("Invalid device token.");
  if (typeof fingerprintHash !== "string" || !/^[a-f0-9]{64}$/.test(fingerprintHash)) {
    throw new Error("Invalid device fingerprint.");
  }

  const deviceHash = await hashDeviceToken(token);
  await db.prepare(
    `INSERT INTO user_devices
      (id, firebase_uid, device_token_hash, device_fingerprint_hash, device_type, platform)
     VALUES (?, ?, ?, ?, 'browser', 'web')
     ON CONFLICT(firebase_uid, device_token_hash)
     DO UPDATE SET
       device_fingerprint_hash = excluded.device_fingerprint_hash,
       last_seen_at = CURRENT_TIMESTAMP`
  ).bind(crypto.randomUUID(), uid, deviceHash, fingerprintHash).run();

  // Exact coarse fingerprint matches catch separate browser profiles on one phone.
  // This only disqualifies referral rewards; signup and signup Gems remain unaffected.
  await db.prepare(
    `UPDATE referrals
     SET is_valid = 0, valid_at = NULL
     WHERE EXISTS (
       SELECT 1 FROM user_devices a
       JOIN user_devices b ON (
         a.device_token_hash = b.device_token_hash
         OR (a.device_fingerprint_hash IS NOT NULL
             AND a.device_fingerprint_hash = b.device_fingerprint_hash)
       )
       WHERE a.firebase_uid = referrals.referrer_uid
         AND b.firebase_uid = referrals.referred_uid
     )`
  ).run();

  return deviceHash;
}

async function hasSharedDevice(db, uidA, uidB) {
  const result = await db.prepare(
    `SELECT 1 AS found
     FROM user_devices a
     JOIN user_devices b
       ON (
         a.device_token_hash = b.device_token_hash
         OR (a.device_fingerprint_hash IS NOT NULL
             AND a.device_fingerprint_hash = b.device_fingerprint_hash)
       )
     WHERE a.firebase_uid = ?
       AND b.firebase_uid = ?
     LIMIT 1`
  ).bind(uidA, uidB).first();
  return !!result;
}

async function registerDevice(request, env, user) {
  const body = await request.json();

  await saveDevice(env.DB, user.uid, body.device_token, body.device_fingerprint_hash);

  const referralCode = await ensureReferralCode(
    env.DB,
    user.uid
  );

  return json({
    success: true,
    referral_code: referralCode
  });
}

async function applyReferral(request, env, user) {
  const body = await request.json();

  const code = String(body.referral_code || "")
    .trim()
    .toLowerCase();

  if (!/^[a-f0-9]{16}$/.test(code)) {
    return json({
      success: false,
      message: "Invalid referral code."
    }, 400);
  }

  await saveDevice(
    env.DB,
    user.uid,
    body.device_token,
    body.device_fingerprint_hash
  );

  const referrer = await env.DB.prepare(
    `SELECT firebase_uid
     FROM users
     WHERE referral_code = ?`
  ).bind(code).first();

  if (!referrer) {
    return json({
      success: false,
      message: "Referral code not found."
    }, 404);
  }

  if (referrer.firebase_uid === user.uid) {
    return json({
      success: false,
      message: "You cannot use your own referral code."
    }, 400);
  }

  const alreadyApplied = await env.DB.prepare(
    `SELECT id FROM referrals
     WHERE referred_uid = ?`
  ).bind(user.uid).first();

  if (alreadyApplied) {
    return json({
      success: false,
      message: "A referral has already been applied to this account."
    }, 409);
  }

  const sameDevice = await hasSharedDevice(
    env.DB,
    referrer.firebase_uid,
    user.uid
  );

  await env.DB.prepare(
    `INSERT INTO referrals
      (id, referrer_uid, referred_uid, referral_code, is_valid)
     VALUES (?, ?, ?, ?, 0)`
  ).bind(
    crypto.randomUUID(),
    referrer.firebase_uid,
    user.uid,
    code
  ).run();

  return json({
    success: true,
    referral_eligible: !sameDevice,
    message: sameDevice
      ? "Account created, but this referral is not eligible."
      : "Referral code applied. Open a mining box to qualify."
  });
}

async function getReferralInfo(env, user) {
  const code = await ensureReferralCode(env.DB, user.uid);

  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM referrals
     WHERE referrer_uid = ?
       AND is_valid = 1`
  ).bind(user.uid).first();

  return json({
    success: true,
    referral_code: code,
    valid_referrals: counts?.total || 0
  });
}

async function markReferralValid(request, env) {
  if (!env.INTERNAL_API_SECRET) {
    return json({
      success: false,
      message: "Internal API secret is not configured."
    }, 503);
  }

  const suppliedSecret =
    request.headers.get("X-Internal-Secret");

  if (
    !suppliedSecret ||
    suppliedSecret !== env.INTERNAL_API_SECRET
  ) {
    return json({
      success: false,
      message: "Unauthorized internal request."
    }, 401);
  }

  const body = await request.json();
  const referredUid = String(body.referred_uid || "");

  if (!referredUid) {
    return json({
      success: false,
      message: "Referred user ID is required."
    }, 400);
  }

  const referral = await env.DB.prepare(
    `SELECT referrer_uid, referred_uid
     FROM referrals
     WHERE referred_uid = ?
     AND is_valid = 0`
  ).bind(referredUid).first();

  if (!referral) {
    return json({
      success: true,
      valid: false,
      message: "No pending referral found."
    });
  }

  const sameDevice = await hasSharedDevice(
    env.DB,
    referral.referrer_uid,
    referral.referred_uid
  );

  if (sameDevice) {
    return json({
      success: true,
      valid: false,
      message: "Same-device referral is not eligible."
    });
  }

  await env.DB.prepare(
    `UPDATE referrals
     SET is_valid = 1,
         valid_at = CURRENT_TIMESTAMP
     WHERE referred_uid = ?
       AND is_valid = 0`
  ).bind(referredUid).run();

  return json({
    success: true,
    valid: true,
    message: "Referral qualified."
  });
}

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return cors();
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/health") {
    await env.DB.prepare("SELECT 1").first();

    return json({
      success: true,
      worker: "islandora-referral-api",
      database: "connected"
    });
  }

  // This endpoint is called only by the trusted main Worker.
  if (
    request.method === "POST" &&
    path === "/internal/referral/box-opened"
  ) {
    return await markReferralValid(request, env);
  }

  const user = await verifyFirebaseToken(request);

  if (request.method === "POST" && path === "/api/referral/device") {
    return await registerDevice(request, env, user);
  }

  if (request.method === "POST" && path === "/api/referral/apply") {
    return await applyReferral(request, env, user);
  }

  if (request.method === "GET" && path === "/api/referral/me") {
    return await getReferralInfo(env, user);
  }

  return json({
    success: false,
    message: "Endpoint not found."
  }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const origin = request.headers.get("Origin");

      if (false && origin && origin !== ALLOWED_ORIGIN) {
        return json({
          success: false,
          message: "Origin not allowed."
        }, 403);
      }

      return await handleRequest(request, env);
    } catch (error) {
      console.error("Referral API error:", error);

      const message = error.message || "Internal server error.";

      const status =
        message.includes("Authentication") ? 401 :
        message.includes("Invalid") ? 400 :
        message.includes("not found") ? 404 :
        500;

      return json({
        success: false,
        message
      }, status);
    }
  }
};
