const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

function base64url(input) {
  return input.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function utf8ToBase64url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return base64url(btoa(binary));
}

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function createGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = utf8ToBase64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = utf8ToBase64url(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claim;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const signed = unsigned + "." + base64url(
    btoa(String.fromCharCode(...new Uint8Array(signature)))
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(signed)
  });

  if (!response.ok) throw new Error("Falha ao obter token do Google: " + await response.text());
  const data = await response.json();
  return data.access_token;
}

async function sendPush(env, fcmToken, order) {
  const accessToken = await createGoogleAccessToken(env);
  const title = "🍕 NOVO PEDIDO!";
  const body = order.cliente
    ? order.cliente + " • " + (order.total || "Novo pedido")
    : "Você recebeu um novo pedido.";

  const response = await fetch(
    "https://fcm.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID + "/messages:send",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: { title, body },
          webpush: {
            notification: {
              title,
              body,
              icon: "/favicon.ico",
              badge: "/favicon.ico"
            },
            fcm_options: { link: "/" }
          },
          data: {
            type: "new_order",
            customer: String(order.cliente || "")
          }
        }
      })
    }
  );

  return response;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "Pizzaria Oliveira Notifications" });
    }

    if (request.method === "POST" && url.pathname === "/register") {
      try {
        const data = await request.json();
        if (!data.setupCode || data.setupCode !== env.SETUP_CODE) {
          return json({ ok: false, error: "Código de ativação inválido." }, 401);
        }
        if (!data.token || typeof data.token !== "string") {
          return json({ ok: false, error: "Token FCM ausente." }, 400);
        }

        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(data.token)
        );
        const key = "token:" + Array.from(new Uint8Array(digest))
          .map(b => b.toString(16).padStart(2, "0")).join("");

        await env.PUSH_TOKENS.put(key, data.token);
        return json({ ok: true, message: "Celular cadastrado para receber pedidos." });
      } catch (error) {
        return json({ ok: false, error: "Não foi possível cadastrar o celular." }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/order") {
      try {
        const order = await request.json();
        if (!order || !order.cliente) {
          return json({ ok: false, error: "Pedido inválido." }, 400);
        }

        const listed = await env.PUSH_TOKENS.list({ prefix: "token:" });
        let sent = 0;
        let failed = 0;

        for (const item of listed.keys) {
          const token = await env.PUSH_TOKENS.get(item.name);
          if (!token) continue;

          const response = await sendPush(env, token, order);
          if (response.ok) {
            sent++;
          } else {
            failed++;
            const text = await response.text();
            if (text.includes("UNREGISTERED") || text.includes("INVALID_ARGUMENT")) {
              await env.PUSH_TOKENS.delete(item.name);
            }
          }
        }

        return json({ ok: true, sent, failed });
      } catch (error) {
        console.error(error);
        return json({ ok: false, error: "Falha ao enviar a notificação." }, 500);
      }
    }

    return json({ ok: false, error: "Rota não encontrada." }, 404);
  }
};
