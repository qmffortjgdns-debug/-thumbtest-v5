const FREE_DAILY_LIMIT = 5;

function getUserId(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/thumbtest_user=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function createUserId() {
  return crypto.randomUUID();
}

function userCookie(userId) {
  return `thumbtest_user=${encodeURIComponent(userId)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function createFreeUser(userId, env) {
  const now = Date.now();
  const email = `${userId}@anonymous.thumbtest`;

  await env.DB.prepare(
    "INSERT INTO users (id, email, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(userId, email, "free", now, now)
    .run();
}

async function getOrCreateUser(request, env) {
  let userId = getUserId(request);

  if (!userId) {
    userId = createUserId();
    await createFreeUser(userId, env);

    return {
      id: userId,
      plan: "free",
      newUser: true
    };
  }

  const result = await env.DB.prepare(
    "SELECT id, plan FROM users WHERE id = ? LIMIT 1"
  )
    .bind(userId)
    .all();

  if (result.results && result.results.length > 0) {
    return {
      id: result.results[0].id,
      plan: result.results[0].plan,
      newUser: false
    };
  }

  await createFreeUser(userId, env);

  return {
    id: userId,
    plan: "free",
    newUser: true
  };
}

async function getUsage(userId, env) {
  const date = today();

  const result = await env.DB.prepare(
    "SELECT test_count FROM usage_daily WHERE user_id = ? AND usage_date = ? LIMIT 1"
  )
    .bind(userId, date)
    .all();

  if (!result.results || result.results.length === 0) {
    return 0;
  }

  return Number(result.results[0].test_count);
}

async function incrementUsage(userId, env) {
  const date = today();

  await env.DB.prepare(
    "INSERT INTO usage_daily (user_id, usage_date, test_count) VALUES (?, ?, ?) ON CONFLICT(user_id, usage_date) DO UPDATE SET test_count = test_count + 1"
  )
    .bind(userId, date, 1)
    .run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      try {
        const result = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all();

        return Response.json({
          ok: true,
          database: "connected",
          tables: result.results || []
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            database: "error",
            message: String(error && error.message ? error.message : error)
          },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      try {
        const user = await getOrCreateUser(request, env);
        const used = await getUsage(user.id, env);

        const headers = new Headers({
          "Content-Type": "application/json"
        });

        if (user.newUser) {
          headers.set("Set-Cookie", userCookie(user.id));
        }

        return new Response(
          JSON.stringify({
            authenticated: false,
            userId: user.id,
            plan: user.plan,
            dailyLimit: user.plan === "pro" ? null : FREE_DAILY_LIMIT,
            usedToday: used,
            remainingToday:
              user.plan === "pro"
                ? null
                : Math.max(0, FREE_DAILY_LIMIT - used)
          }),
          { headers }
        );
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: String(error && error.message ? error.message : error)
          },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/api/usage" && request.method === "POST") {
      try {
        const user = await getOrCreateUser(request, env);
        const used = await getUsage(user.id, env);

        if (user.plan !== "pro" && used >= FREE_DAILY_LIMIT) {
          const headers = new Headers({
            "Content-Type": "application/json"
          });

          if (user.newUser) {
            headers.set("Set-Cookie", userCookie(user.id));
          }

          return new Response(
            JSON.stringify({
              ok: false,
              error: "daily_limit_reached",
              message: "Free users can use 5 analyses per day.",
              dailyLimit: FREE_DAILY_LIMIT,
              usedToday: used,
              remainingToday: 0
            }),
            {
              status: 429,
              headers
            }
          );
        }

        await incrementUsage(user.id, env);

        const newUsed = used + 1;

        const headers = new Headers({
          "Content-Type": "application/json"
        });

        if (user.newUser) {
          headers.set("Set-Cookie", userCookie(user.id));
        }

        return new Response(
          JSON.stringify({
            ok: true,
            plan: user.plan,
            usedToday: newUsed,
            remainingToday:
              user.plan === "pro"
                ? null
                : Math.max(0, FREE_DAILY_LIMIT - newUsed)
          }),
          { headers }
        );
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: String(error && error.message ? error.message : error)
          },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
