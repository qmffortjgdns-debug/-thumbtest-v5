const FREE_DAILY_LIMIT = 5;

function getUserId(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)thumbtest_user=([^;]+)/);

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

function jsonResponse(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    ...extraHeaders
  });

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

async function createFreeUser(userId, env) {
  const now = Date.now();
  const email = `${userId}@anonymous.thumbtest`;

  await env.DB.prepare(
    `INSERT INTO users
      (id, email, plan, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
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
    `SELECT id, plan
     FROM users
     WHERE id = ?
     LIMIT 1`
  )
    .bind(userId)
    .all();

  if (result.results && result.results.length > 0) {
    return {
      id: result.results[0].id,
      plan: result.results[0].plan || "free",
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
    `SELECT test_count
     FROM usage_daily
     WHERE user_id = ?
       AND usage_date = ?
     LIMIT 1`
  )
    .bind(userId, date)
    .all();

  if (!result.results || result.results.length === 0) {
    return 0;
  }

  return Number(result.results[0].test_count || 0);
}

async function incrementUsage(userId, env) {
  const date = today();

  await env.DB.prepare(
    `INSERT INTO usage_daily
      (user_id, usage_date, test_count)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, usage_date)
     DO UPDATE SET test_count = test_count + 1`
  )
    .bind(userId, date, 1)
    .run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * HEALTH CHECK
     */
    if (url.pathname === "/api/health") {
      try {
        const result = await env.DB.prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'table'
           ORDER BY name`
        ).all();

        return jsonResponse({
          ok: true,
          database: "connected",
          tables: result.results || []
        });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            database: "error",
            message: String(
              error && error.message ? error.message : error
            )
          },
          500
        );
      }
    }

    /*
     * CURRENT USER
     */
    if (url.pathname === "/api/me" && request.method === "GET") {
      try {
        const user = await getOrCreateUser(request, env);
        const used = await getUsage(user.id, env);

        const isPro = user.plan === "pro";

        const responseData = {
          ok: true,

          // 保留 authenticated 字段，但现在让前端能正确识别 Pro
          authenticated: isPro,

          userId: user.id,

          plan: user.plan,

          isPro: isPro,

          dailyLimit: isPro
            ? null
            : FREE_DAILY_LIMIT,

          usedToday: used,

          remainingToday: isPro
            ? null
            : Math.max(0, FREE_DAILY_LIMIT - used)
        };

        const extraHeaders = {};

        if (user.newUser) {
          extraHeaders["Set-Cookie"] = userCookie(user.id);
        }

        return jsonResponse(
          responseData,
          200,
          extraHeaders
        );

      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: String(
              error && error.message ? error.message : error
            )
          },
          500
        );
      }
    }

    /*
     * RECORD ONE THUMBNAIL TEST
     */
    if (url.pathname === "/api/usage" && request.method === "POST") {
      try {
        const user = await getOrCreateUser(request, env);
        const used = await getUsage(user.id, env);

        const isPro = user.plan === "pro";

        /*
         * PRO:
         * No daily limit and don't block the test.
         */
        if (isPro) {
          await incrementUsage(user.id, env);

          const newUsed = used + 1;

          const extraHeaders = {};

          if (user.newUser) {
            extraHeaders["Set-Cookie"] = userCookie(user.id);
          }

          return jsonResponse(
            {
              ok: true,
              plan: "pro",
              isPro: true,
              usedToday: newUsed,
              dailyLimit: null,
              remainingToday: null
            },
            200,
            extraHeaders
          );
        }

        /*
         * FREE:
         * Maximum 5 tests per day.
         */
        if (used >= FREE_DAILY_LIMIT) {
          const extraHeaders = {};

          if (user.newUser) {
            extraHeaders["Set-Cookie"] = userCookie(user.id);
          }

          return jsonResponse(
            {
              ok: false,
              error: "daily_limit_reached",
              message:
                "You've reached today's free limit of 5 tests. Upgrade to Pro for unlimited testing.",
              plan: "free",
              isPro: false,
              dailyLimit: FREE_DAILY_LIMIT,
              usedToday: used,
              remainingToday: 0
            },
            429,
            extraHeaders
          );
        }

        await incrementUsage(user.id, env);

        const newUsed = used + 1;

        const extraHeaders = {};

        if (user.newUser) {
          extraHeaders["Set-Cookie"] = userCookie(user.id);
        }

        return jsonResponse(
          {
            ok: true,
            plan: "free",
            isPro: false,
            usedToday: newUsed,
            dailyLimit: FREE_DAILY_LIMIT,
            remainingToday:
              Math.max(0, FREE_DAILY_LIMIT - newUsed)
          },
          200,
          extraHeaders
        );

      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: String(
              error && error.message ? error.message : error
            )
          },
          500
        );
      }
    }

    /*
     * STATIC FRONTEND
     */
    return env.ASSETS.fetch(request);
  }
};
