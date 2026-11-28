import http from "node:http";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  statSync,
  createReadStream,
  chmodSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.mjs";
import { studyDay } from "./study-day.mjs";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  host = process.env.GEO_HOST || "127.0.0.1";
let port = Number(process.env.PORT || 4387);
const configuredOrigin = process.env.GEO_ORIGIN
  ? new URL(process.env.GEO_ORIGIN)
  : null;
if (
  configuredOrigin &&
  (!["http:", "https:"].includes(configuredOrigin.protocol) ||
    configuredOrigin.username ||
    configuredOrigin.password ||
    configuredOrigin.pathname !== "/" ||
    configuredOrigin.search ||
    configuredOrigin.hash)
) {
  throw Error(
    "GEO_ORIGIN must be an exact HTTP(S) origin, for example https://geo.example.com.",
  );
}
const runtime = process.env.GEO_DATA_DIR || path.join(root, "data/local");
// SQLite sidecars and backup snapshots contain the same private study data.
process.umask(process.umask() | 0o077);
mkdirSync(path.join(runtime, "backups"), { recursive: true });
if (!process.env.GEO_DATA_DIR) chmodSync(runtime, 0o700);
const store = createStore(
  path.join(runtime, "geography.sqlite"),
  JSON.parse(readFileSync(path.join(root, "data/places.json"), "utf8")),
);
store.backup(path.join(runtime, "backups", `${studyDay()}-startup.sqlite`));
const vite = process.argv.includes("--dev")
  ? await (
      await import("vite")
    ).createServer({ root, server: { middlewareMode: true }, appType: "spa" })
  : null;
const json = (res, data, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const cardResponse = (card) => ({
  ...card,
  dueDay: card.state === 2 ? studyDay(new Date(card.due)) : null,
});
async function body(req, limit) {
  const tooLarge = () => Object.assign(Error("Request body exceeds the size limit."), { status: 413 });
  if (Number(req.headers["content-length"]) > limit) throw tooLarge();
  // Decode through Node's StringDecoder so multibyte names survive chunk edges.
  req.setEncoding("utf8");
  let raw = "";
  let bytes = 0;
  for await (const c of req) {
    bytes += Buffer.byteLength(c);
    if (bytes > limit) throw tooLarge();
    raw += c;
  }
  return raw ? JSON.parse(raw) : {};
}
async function api(req, res, url) {
  const p = url.pathname,
    m = req.method;
  if (
    !["GET", "HEAD"].includes(m) &&
    req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    return json(res, { error: "Use Content-Type: application/json." }, 415);
  const largeInput = p === "/api/restore" || p === "/api/places" || p.startsWith("/api/places/");
  const limit = largeInput ? 40 * 1024 * 1024 : 256 * 1024;
  const input = ["POST", "PATCH", "PUT"].includes(m) ? await body(req, limit) : {};
  if (p === "/api/lake-review" && m === "GET") return json(res, store.lakeReview());
  if (p === "/api/fact-review" && m === "GET") return json(res, store.editorial.list());
  if (p === "/api/fact-review/publish" && m === "POST") return json(res, store.editorial.publish());
  const factPlace = p.match(/^\/api\/fact-review\/([\w-]+)$/);
  if (factPlace && m === "PUT") return json(res, store.editorial.save(factPlace[1], input));
  if (p === "/api/health" && m === "GET")
    return json(res, {
      ok: true,
      app: "migs-geo",
      version: 1,
      ...store.health(),
    });
  if (p === "/api/stats" && m === "GET") return json(res, store.stats());
  if (p === "/api/analytics" && m === "GET")
    return json(
      res,
      store.analytics({
        from: url.searchParams.get("from") || undefined,
        to: url.searchParams.get("to") || undefined,
        cardId: url.searchParams.get("cardId") || undefined,
      }),
    );
  if (p === "/api/settings")
    return json(
      res,
      m === "GET"
        ? store.settings()
        : m === "PATCH"
          ? store.setSettings(input)
          : { error: "Method not allowed" },
      ["GET", "PATCH"].includes(m) ? 200 : 405,
    );
  if (p === "/api/populations" && m === "GET") return json(res, store.populations());
  if (p === "/api/vocabulary" && m === "GET") return json(res, store.vocabulary());
  if (p === "/api/places" && m === "GET")
    return json(
      res,
      store
        .places()
        .filter(
          (p) => url.searchParams.get("archived") === "true" || !p.archived,
        )
        .map(({ geometry, ...p }) =>
          url.searchParams.get("geometry") === "true" ? { ...p, geometry } : p,
        ),
    );
  if (p === "/api/places" && m === "POST")
    return json(res, store.createPlace(input), 201);
  const pm = p.match(/^\/api\/places\/([\w-]+)$/);
  if (pm) {
    const id = pm[1];
    if (m === "GET") return json(res, store.place(id));
    if (m === "PATCH") return json(res, store.updatePlace(id, input));
    if (m === "DELETE")
      return json(res, store.updatePlace(id, { archived: true }));
  }
  if (p === "/api/cards" && m === "GET")
    return json(
      res,
      store
        .cards()
        .filter(
          (c) =>
            !url.searchParams.get("placeId") ||
            c.place_id === url.searchParams.get("placeId"),
        )
        .map(cardResponse),
    );
  const cm = p.match(/^\/api\/cards\/([^/]+)$/);
  if (cm) {
    const id = decodeURIComponent(cm[1]);
    if (m === "GET") return json(res, cardResponse(store.getCard(id)));
    if (m === "PATCH") return json(res, cardResponse(store.updateCard(id, input)));
  }
  if (p === "/api/queue" && m === "GET") {
    const q = store.queue();
    return json(res, {
      ...q,
      next: q.next ? { id: q.next.id, mode: q.next.mode } : null,
    });
  }
  if (p === "/api/study/next" && m === "POST")
    return json(res, store.question(input));
  if (p === "/api/study/check" && m === "POST")
    return json(res, store.check(input.token, input.answer));
  if (p === "/api/study/rate" && m === "POST") {
    const saved = store.review(input.token, input.rating);
    return json(res, saved.card ? { ...saved, card: cardResponse(saved.card) } : saved);
  }
  if (p === "/api/study/log" && m === "GET")
    return json(
      res,
      store.studyLog({
        cardId: url.searchParams.get("cardId") || undefined,
        limit: Number(url.searchParams.get("limit") || 100),
        offset: Number(url.searchParams.get("offset") || 0),
        includePractice: url.searchParams.get("includePractice") === "true",
      }),
    );
  if (p === "/api/reviews" && m === "GET") return json(res, store.history());
  if (p === "/api/reviews/undo" && m === "POST") return json(res, store.undo());
  if (p === "/api/backup" && m === "GET") {
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="migs-geo-${studyDay()}.json"`,
    );
    return json(res, store.exportData());
  }
  if (p === "/api/restore" && m === "POST") {
    store.backup(
      path.join(runtime, "backups", `${Date.now()}-before-restore.sqlite`),
    );
    return json(res, store.restore(input));
  }
  if (p === "/api/docs" && m === "GET")
    return json(
      res,
      JSON.parse(readFileSync(path.join(root, "public/api.json"), "utf8")),
    );
  return json(
    res,
    { error: "Unknown endpoint or method. See GET /api/docs." },
    404,
  );
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const server = http.createServer({ headersTimeout: 15000, requestTimeout: 60000 }, async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (!vite) {
    res.setHeader("Content-Security-Policy", [
      "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
      "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    ].join("; "));
  }
  try {
    const origins = [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      ...(configuredOrigin ? [configuredOrigin.origin] : []),
    ];
    const hosts = origins.map((origin) => new URL(origin).host);
    if (!hosts.includes(req.headers.host))
      return json(res, { error: "Unrecognized host. Check GEO_ORIGIN." }, 403);
    if (req.headers.origin && !origins.includes(req.headers.origin))
      return json(
        res,
        { error: "Cross-origin requests are not allowed." },
        403,
      );
    const url = new URL(req.url, `http://${host}:${port}`);
    if (url.pathname.startsWith("/api/")) {
      if (req.headers["sec-fetch-site"] === "cross-site")
        return json(res, { error: "Cross-site API access is disabled." }, 403);
      return await api(req, res, url);
    }
    if (vite)
      return vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    let file = path.resolve(
      root,
      "dist",
      "." + decodeURIComponent(url.pathname),
    );
    if (!file.startsWith(path.join(root, "dist") + path.sep))
      file = path.join(root, "dist/index.html");
    if (!existsSync(file) || !statSync(file).isFile())
      file = path.join(root, "dist/index.html");
    if (!existsSync(file))
      return json(
        res,
        { error: "Build the app first with npm run build." },
        503,
      );
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": url.pathname.startsWith("/assets/")
        ? "public,max-age=31536000,immutable"
        : "no-cache",
    });
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
  } catch (e) {
    json(res, { error: e.message }, [409,413].includes(e.status) ? e.status : 400);
  }
});
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Open http://${host}:${port} if Migs Geo is already running, or choose another PORT.`
      : error.message,
  );
  store.db.close();
  process.exit(1);
});
server.listen(port, host, () => {
  port = server.address().port;
  console.log(
    `Migs Geo is running at http://${host}:${port}\nLocal database: ${runtime}/geography.sqlite`,
  );
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      store.db.close();
      process.exit(0);
    }),
  );
