var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.mjs
var MAX_BODY = 9e5;
var MAX_KIDS = 24;
var PREV_GAP_MS = 6 * 3600 * 1e3;
var ID_RE = /^[\w-]{1,40}$/;
var CODE_RE = /^[A-Z0-9]{20,40}$/;
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "X-Family,Content-Type",
  "Access-Control-Max-Age": "86400"
};
var json = /* @__PURE__ */ __name((o, status = 200) => new Response(JSON.stringify(o), {
  status,
  headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, CORS)
}), "json");
var err = /* @__PURE__ */ __name((status, code) => json({ error: code }, status), "err");
async function famHash(code) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc-sync:" + code));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(famHash, "famHash");
var isInt = /* @__PURE__ */ __name((v) => typeof v === "number" && Number.isInteger(v) && v >= 0, "isInt");
var parseData = /* @__PURE__ */ __name((s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}, "parseData");
var worker_default = {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "");
      if (path === "/api/ping") return json({ ok: true, t: Date.now() });
      if (env.ORIGINS) {
        const o = req.headers.get("Origin");
        if (o && !env.ORIGINS.split(",").map((s) => s.trim()).includes(o)) return err(403, "origin");
      }
      if (!env.DB) return err(500, "no_db");
      const code = (req.headers.get("X-Family") || "").trim().toUpperCase();
      if (!CODE_RE.test(code)) return err(401, "bad_code");
      const fam = await famHash(code), db = env.DB;
      if (path === "/api/kids" && req.method === "GET") {
        const r = await db.prepare("SELECT kid AS id, rev, name, updated, deleted FROM kids WHERE fam = ? ORDER BY updated").bind(fam).all();
        return json({ kids: (r.results || []).map((k) => ({ id: k.id, rev: k.rev, name: k.name, updated: k.updated, deleted: !!k.deleted })) });
      }
      if (path === "/api/family" && req.method === "DELETE") {
        await db.prepare("DELETE FROM kids WHERE fam = ?").bind(fam).run();
        return json({ ok: true });
      }
      const m = /^\/api\/kid\/([^/]+)$/.exec(path);
      if (!m) return err(404, "not_found");
      const id = decodeURIComponent(m[1]);
      if (!ID_RE.test(id)) return err(400, "bad_id");
      if (req.method === "GET") {
        const row = await db.prepare("SELECT rev, name, data, prev, deleted FROM kids WHERE fam = ? AND kid = ?").bind(fam, id).first();
        if (!row) return err(404, "no_kid");
        return json({ id, rev: row.rev, name: row.name, deleted: !!row.deleted, data: parseData(url.searchParams.get("prev") ? row.prev : row.data) });
      }
      if (req.method === "PUT") {
        const text = await req.text();
        if (text.length > MAX_BODY + 2e3) return err(413, "too_big");
        let body;
        try {
          body = JSON.parse(text);
        } catch (e) {
          return err(400, "bad_json");
        }
        if (!body || typeof body !== "object" || !isInt(body.base) || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) return err(400, "bad_body");
        const data = JSON.stringify(body.data);
        if (data.length > MAX_BODY) return err(413, "too_big");
        const name = String(body.name == null ? "" : body.name).slice(0, 40), now = Date.now();
        if (body.base === 0) {
          const n = await db.prepare("SELECT COUNT(*) AS n FROM kids WHERE fam = ?").bind(fam).first();
          if (n && n.n >= MAX_KIDS) return err(400, "too_many");
          const r = await db.prepare("INSERT INTO kids (fam, kid, rev, name, data, prev, deleted, updated) VALUES (?, ?, 1, ?, ?, '', 0, ?) ON CONFLICT(fam, kid) DO NOTHING").bind(fam, id, name, data, now).run();
          if (r.meta.changes === 1) return json({ rev: 1 });
        } else {
          const r = await db.prepare("UPDATE kids SET rev = rev + 1, name = ?, data = ?, prev = CASE WHEN ? - updated > ? THEN data ELSE prev END, updated = ? WHERE fam = ? AND kid = ? AND rev = ? AND deleted = 0").bind(name, data, now, PREV_GAP_MS, now, fam, id, body.base).run();
          if (r.meta.changes === 1) return json({ rev: body.base + 1 });
        }
        const cur = await db.prepare("SELECT rev, deleted FROM kids WHERE fam = ? AND kid = ?").bind(fam, id).first();
        return json({ error: "conflict", rev: cur ? cur.rev : 0, deleted: !!(cur && cur.deleted) }, 409);
      }
      if (req.method === "DELETE") {
        const now = Date.now();
        const r = await db.prepare("UPDATE kids SET rev = rev + 1, deleted = 1, data = '', prev = '', updated = ? WHERE fam = ? AND kid = ?").bind(now, fam, id).run();
        if (r.meta.changes !== 1) {
          await db.prepare("INSERT INTO kids (fam, kid, rev, name, data, prev, deleted, updated) VALUES (?, ?, 1, '', '', '', 1, ?) ON CONFLICT(fam, kid) DO NOTHING").bind(fam, id, now).run();
        }
        return json({ ok: true });
      }
      return err(405, "method");
    } catch (e) {
      return err(500, "server");
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
