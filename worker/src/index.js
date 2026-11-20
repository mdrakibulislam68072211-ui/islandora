const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin === allowed ? origin : "null",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Authorization,Content-Type",
          "Vary": "Origin"
        }
      });
    }

    const cors = {
      "Access-Control-Allow-Origin": origin === allowed ? origin : "null",
      "Vary": "Origin"
    };

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "mining-hub-api", stage: "foundation" }, 200, cors);
    }

    // Protected routes are intentionally not implemented until Firebase/Telegram
    // token verification is added. Never expose balance-changing endpoints unauthenticated.
    return json({ error: "Not implemented. Authentication and authorization are required." }, 501, cors);
  }
};
