export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      try {
        const result = await env.DB
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all();

        return Response.json({
          ok: true,
          database: "connected",
          tables: result.results ?? []
        });
      } catch (error) {
        return Response.json({
          ok: false,
          database: "error",
          message: String(error?.message || error)
        }, { status: 500 });
      }
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      return Response.json({
        authenticated: false,
        plan: "free",
        message: "Authentication will be added in the next V5 step."
      });
    }

    return env.ASSETS.fetch(request);
  }
};
