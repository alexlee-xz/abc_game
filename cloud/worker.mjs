/* ============ ABC 小游戏：云同步后端（Cloudflare Worker + D1） ============
   只做“按同步码存取每个小朋友的一份 JSON”，不做合并（合并在网页端 js/core/sync.js）。
   鉴权：请求头 X-Family = 同步码（20 位字母数字）。库里只存它的 SHA-256。
   接口（都返回 JSON）：
     GET    /api/ping                连通性检查（不需要同步码）
     GET    /api/kids                列出这个家庭的小朋友 [{id, rev, name, updated, deleted}]
     GET    /api/kid/:id[?prev=1]    读一个小朋友的记录（prev=1 读较早的快照）
     PUT    /api/kid/:id             写 {base, name, data}；base 是客户端看到的 rev（新建用 0）。版本不一致返回 409
     DELETE /api/kid/:id             删除（留墓碑）
     DELETE /api/family              删除这个家庭的全部数据
   环境：绑定 D1 为 DB；可选变量 ORIGINS（逗号分隔，只允许这些网页来源访问，默认不限制）。 */

const MAX_BODY = 900000;          // 单个小朋友记录的最大字符数（D1 单行上限 2MB）
const MAX_KIDS = 24;              // 一个家庭最多多少行（含墓碑）
const PREV_GAP_MS = 6 * 3600 * 1000;   // 快照 prev 至少隔 6 小时才更新一次
const ID_RE = /^[\w-]{1,40}$/;
const CODE_RE = /^[A-Z0-9]{20,40}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "X-Family,Content-Type",
  "Access-Control-Max-Age": "86400"
};
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status,
  headers: Object.assign({"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, CORS)
});
const err = (status, code) => json({error: code}, status);

async function famHash(code){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc-sync:" + code));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}
const isInt = v => typeof v === "number" && Number.isInteger(v) && v >= 0;
const parseData = s => { try{ return s ? JSON.parse(s) : null; }catch(e){ return null; } };

export default {
  async fetch(req, env){
    if(req.method === "OPTIONS") return new Response(null, {status: 204, headers: CORS});
    try{
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "");
      if(path === "/api/ping") return json({ok: true, t: Date.now()});
      if(env.ORIGINS){
        const o = req.headers.get("Origin");
        if(o && !env.ORIGINS.split(",").map(s => s.trim()).includes(o)) return err(403, "origin");
      }
      if(!env.DB) return err(500, "no_db");

      const code = (req.headers.get("X-Family") || "").trim().toUpperCase();
      if(!CODE_RE.test(code)) return err(401, "bad_code");
      const fam = await famHash(code), db = env.DB;

      if(path === "/api/kids" && req.method === "GET"){
        const r = await db.prepare("SELECT kid AS id, rev, name, updated, deleted FROM kids WHERE fam = ? ORDER BY updated").bind(fam).all();
        return json({kids: (r.results || []).map(k => ({id: k.id, rev: k.rev, name: k.name, updated: k.updated, deleted: !!k.deleted}))});
      }
      if(path === "/api/family" && req.method === "DELETE"){
        await db.prepare("DELETE FROM kids WHERE fam = ?").bind(fam).run();
        return json({ok: true});
      }
      const m = /^\/api\/kid\/([^/]+)$/.exec(path);
      if(!m) return err(404, "not_found");
      const id = decodeURIComponent(m[1]);
      if(!ID_RE.test(id)) return err(400, "bad_id");

      if(req.method === "GET"){
        const row = await db.prepare("SELECT rev, name, data, prev, deleted FROM kids WHERE fam = ? AND kid = ?").bind(fam, id).first();
        if(!row) return err(404, "no_kid");
        return json({id, rev: row.rev, name: row.name, deleted: !!row.deleted, data: parseData(url.searchParams.get("prev") ? row.prev : row.data)});
      }

      if(req.method === "PUT"){
        const text = await req.text();
        if(text.length > MAX_BODY + 2000) return err(413, "too_big");
        let body;
        try{ body = JSON.parse(text); }catch(e){ return err(400, "bad_json"); }
        if(!body || typeof body !== "object" || !isInt(body.base) || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) return err(400, "bad_body");
        const data = JSON.stringify(body.data);
        if(data.length > MAX_BODY) return err(413, "too_big");
        const name = String(body.name == null ? "" : body.name).slice(0, 40), now = Date.now();
        if(body.base === 0){
          const n = await db.prepare("SELECT COUNT(*) AS n FROM kids WHERE fam = ?").bind(fam).first();
          if(n && n.n >= MAX_KIDS) return err(400, "too_many");
          const r = await db.prepare("INSERT INTO kids (fam, kid, rev, name, data, prev, deleted, updated) VALUES (?, ?, 1, ?, ?, '', 0, ?) ON CONFLICT(fam, kid) DO NOTHING")
            .bind(fam, id, name, data, now).run();
          if(r.meta.changes === 1) return json({rev: 1});
        }else{
          const r = await db.prepare("UPDATE kids SET rev = rev + 1, name = ?, data = ?, prev = CASE WHEN ? - updated > ? THEN data ELSE prev END, updated = ? WHERE fam = ? AND kid = ? AND rev = ? AND deleted = 0")
            .bind(name, data, now, PREV_GAP_MS, now, fam, id, body.base).run();
          if(r.meta.changes === 1) return json({rev: body.base + 1});
        }
        const cur = await db.prepare("SELECT rev, deleted FROM kids WHERE fam = ? AND kid = ?").bind(fam, id).first();
        return json({error: "conflict", rev: cur ? cur.rev : 0, deleted: !!(cur && cur.deleted)}, 409);
      }

      if(req.method === "DELETE"){
        const now = Date.now();
        const r = await db.prepare("UPDATE kids SET rev = rev + 1, deleted = 1, data = '', prev = '', updated = ? WHERE fam = ? AND kid = ?").bind(now, fam, id).run();
        if(r.meta.changes !== 1){
          await db.prepare("INSERT INTO kids (fam, kid, rev, name, data, prev, deleted, updated) VALUES (?, ?, 1, '', '', '', 1, ?) ON CONFLICT(fam, kid) DO NOTHING").bind(fam, id, now).run();
        }
        return json({ok: true});
      }
      return err(405, "method");
    }catch(e){
      return err(500, "server");
    }
  }
};
