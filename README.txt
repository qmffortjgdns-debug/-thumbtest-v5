ThumbTest V5 Alpha

This version converts the V4 static site into a Worker + Static Assets project
and adds a D1 connection test plus the initial users/usage schema.

Before deployment:
1. Replace PASTE_YOUR_D1_DATABASE_ID_HERE in wrangler.jsonc with the ID shown
   on your Cloudflare D1 database page.
2. Apply schema.sql to the thumbtest-db database.
3. Deploy the project to the existing Worker named thumbtest.

Test after deployment:
https://YOUR-WORKER-DOMAIN/api/health

Expected result:
{"ok":true,"database":"connected",...}
