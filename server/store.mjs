import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createEmptyCard, fsrs } from "ts-fsrs";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { migrate, schemaVersion } from "./migrations.mjs";
import { createStudyLog, validateStudyLog } from "./study-log.mjs";
import { analytics } from "./analytics.mjs";
import { studyDay, nextStudyDay, scheduleStudyDay } from "./study-day.mjs";

import { factReview } from "./fact-review.mjs";
import approvedFacts from "../data/approved-facts.json" with { type: "json" };
import cityRegions from "./city-regions.json" with {type:"json"};
import cities from "./cities.json" with {type:"json"};
import {areaKm2} from "./lake-area.mjs";
import lakeLocations from "./lake-locations.json" with {type:"json"};
import lakePlaces from "./lake-places.json" with {type:"json"};
import physicalPlaces from "./physical-places.json" with {type:"json"};
import facts from "./geography-facts.json" with { type: "json" };
import vocabulary from "../data/vocabulary.json" with {type:"json"};

const vocabularyModes = ["term", "define"];
const vocabularyPlaces = vocabulary.map(({term, definition, group, aliases = []}) => ({
  id: "vocab-" + term.replaceAll(" ", "-"), kind: "vocabulary", name: term, info: definition,
  region: group, aliases, tags: [], source: "Migs Geo vocabulary", geometry: null, center: null,
  approximate: false, small: false, archived: false,
}));
const optionalModes = { capital: "capital", fromCapital: "capital", flag: "flag", fromFlag: "flag" };
const modes = ["locate", "identify", ...Object.keys(optionalModes), ...vocabularyModes];
export const defaults = {
  lakeCutoffKm2: 0,
  lakeMinimumKm2: 0,
  cityCountry: "",
  activeDeck: "geography",
  newPerDay: 15,
  reviewsPerDay: 200,
  retention: 0.9,
  kinds: ["country", "territory", "water", "region"],
  regions: [],
  modes: ["locate", "identify"],
  burySiblings: true,
};
const parse = JSON.parse,
  encode = JSON.stringify;
const hydrate = (c) => ({
  ...c,
  due: new Date(c.due),
  ...(c.last_review ? { last_review: new Date(c.last_review) } : {}),
});
const normalize = (s) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^the /, "")
    .replace(/[^a-z0-9]/g, "");
export function validateGeometry(g) {
  if (!g || !["Point", "Polygon", "MultiPolygon","MultiLineString"].includes(g.type))
    throw Error("Geometry must be GeoJSON Point, Polygon, or MultiPolygon.");
  const pos = (p) =>
    Array.isArray(p) &&
    p.length === 2 &&
    p.every(Number.isFinite) &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 90;
  if (g.type === "MultiLineString") {
    if (!Array.isArray(g.coordinates) || !g.coordinates.length || !g.coordinates.every(line => Array.isArray(line) && line.length >= 2 && line.every(pos))) throw Error("Invalid river path.");
    return g;
  }
  const ring = (r) =>
    Array.isArray(r) &&
    r.length >= 4 &&
    r.every(pos) &&
    encode(r[0]) === encode(r.at(-1));
  const poly = (p) => Array.isArray(p) && p.length > 0 && p.every(ring);
  if (
    !(g.type === "Point"
      ? pos(g.coordinates)
      : g.type === "Polygon"
        ? poly(g.coordinates)
        : Array.isArray(g.coordinates) &&
          g.coordinates.length > 0 &&
          g.coordinates.every(poly))
  )
    throw Error("Invalid coordinates or unclosed polygon ring.");
  return g;
}
export function validateSettings(s) {
  s = { lakeMinimumKm2:0, lakeCutoffKm2:0, cityCountry:"", activeDeck: "geography", reviewsPerDay: defaults.reviewsPerDay, ...s };
  if (!Number.isFinite(s.lakeCutoffKm2) || s.lakeCutoffKm2 < 0) throw Error("Lake cutoff must be a nonnegative area in km².");
  if (!Number.isFinite(s.lakeMinimumKm2) || s.lakeMinimumKm2 < 0 || s.lakeMinimumKm2 > s.lakeCutoffKm2) throw Error("Small lake minimum must be between zero and the inland lake cutoff.");
  if (s.cityCountry !== "" && (typeof s.cityCountry !== "string" || !Object.hasOwn(cities, s.cityCountry))) throw Error("Unknown city country.");
  if (!["geography","flags","vocabulary"].includes(s.activeDeck)) throw Error("Invalid deck.");
  if (!Number.isInteger(s.newPerDay) || s.newPerDay < 0 || s.newPerDay > 500)
    throw Error("New cards per day must be 0–500.");
  if (!Number.isInteger(s.reviewsPerDay) || s.reviewsPerDay < 0 || s.reviewsPerDay > 5000)
    throw Error("Reviews per day must be 0–5000.");
  if (!Number.isFinite(s.retention) || s.retention < 0.7 || s.retention > 0.97)
    throw Error("Retention must be 0.70–0.97.");
  if (
    !Array.isArray(s.kinds) ||
    !s.kinds.length ||
    s.kinds.some(
      (k) => !["country", "territory", "water", "region","river","range","desert","lake","smallLake"].includes(k),
    )
  )
    throw Error("Choose at least one valid place type.");
  if (
    !Array.isArray(s.modes) ||
    !s.modes.length ||
    s.modes.some((m) => !modes.includes(m))
  )
    throw Error("Choose at least one question direction.");
  if (
    !Array.isArray(s.regions) ||
    s.regions.some((x) => typeof x !== "string") ||
    typeof s.burySiblings !== "boolean"
  )
    throw Error("Invalid filters.");
  if (s.activeDeck === "vocabulary" && !s.modes.some(mode => vocabularyModes.includes(mode))) {
    s = {...s, activeDeck:"geography"};
  }
  return Object.fromEntries(Object.keys(defaults).map((k) => [k, s[k]]));
}
const distance = (a, b) => {
  const r = Math.PI / 180;
  return (
    6371 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(((a[1] - b[1]) * r) / 2) ** 2 +
            Math.cos(a[1] * r) *
              Math.cos(b[1] * r) *
              Math.sin(((a[0] - b[0]) * r) / 2) ** 2,
        ),
      ),
    )
  );
};
const isFlag = mode => mode === "flag" || mode === "fromFlag";
function cardDeck(mode) {
  if (vocabularyModes.includes(mode)) return "vocabulary";
  return isFlag(mode) ? "flags" : "geography";
}
function flagChoices(id, token) {
  const rank = key => createHash("sha256").update(token + key).digest("hex");
  const candidates = Object.keys(facts).filter(key => key !== id && facts[key].flag && facts[key].flag !== facts[id].flag);
  const others = candidates.sort((a,b) => rank(a).localeCompare(rank(b))).slice(0,3);
  return [...others,id].sort((a,b) => rank("order"+a).localeCompare(rank("order"+b)))
    .map(key => ({ id: key, flag: facts[key].flag }));
}
function lakeName(value) {
  const name = value.trim().replace(/^the\s+/i, "");
  return normalize(name.replace(/^lake\s+|\s+lake$/gi, ""));
}

export function checkAnswer(p, mode, answer) {
  if (answer?.reveal)
    return {
      correct: false,
      revealed: true,
      message: "Answer revealed. Use Again if you did not recall it.",
    };
  if (mode !== "locate") {
    if (typeof answer?.text !== "string" || !answer.text.trim())
      throw Error("Enter a name, or reveal the answer.");
    const fact = facts[p.id];
    const cityList = value => value.split(",").map(normalize).sort().join(",");
    const correct = mode === "define" ? answer.text === p.info : mode === "capital" ? cityList(fact.capital) === cityList(answer.text)
      : mode === "flag" ? answer.text === p.id
      : [p.name, ...p.aliases].some(
      (n) => normalize(n) === normalize(answer.text) ||
        (p.kind === "lake" && lakeName(n) !== "" && lakeName(n) === lakeName(answer.text)),
    );
    return {
      correct,
      message: correct
        ? "That’s right."
        : "Compare your answer below. You can still rate your recall if it was a spelling variation.",
    };
  }
  if (p.geometry.type === "MultiLineString") {
    validateGeometry({type:"MultiLineString", coordinates:[answer?.path]});
    return {correct:null, message:"Compare your trace with the river and rate your recall."};
  }
  const point = answer?.point;
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    point.some((x) => !Number.isFinite(x)) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) > 90
  )
    throw Error("Select a location on the map.");
  if (p.kind === "city" && p.geometry.type === "Point") {
    const km = distance(point, p.geometry.coordinates);
    return { correct:km <= 25, message:`Your pin was ${Math.round(km)} km from the city center (25 km tolerance).` };
  }
  if (p.approximate || p.geometry.type === "Point")
    return {
      correct: null,
      message:
        "This location has an approximate study marker. Compare your pin and rate your recall.",
    };
  let correct = booleanPointInPolygon(point, p.geometry);
  if (!correct && p.small) {
    const polys =
      p.geometry.type === "MultiPolygon"
        ? p.geometry.coordinates
        : [p.geometry.coordinates];
    correct = polys.some((poly) => poly[0].some((v) => distance(point, v) < 3));
  }
  return {
    correct,
    message: correct
      ? "That’s the right place."
      : "Your pin is outside the mapped area. Take a look at the highlighted answer.",
  };
}
export function createStore(filename, seed = [], clock = () => new Date()) {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  const oldVersion = db.prepare("PRAGMA user_version").get().user_version;
  if (
    filename !== ":memory:" &&
    oldVersion < schemaVersion &&
    db.prepare("SELECT 1 FROM sqlite_master WHERE name='places'").get()
  ) {
    const backups = path.join(path.dirname(filename), "backups");
    mkdirSync(backups, { recursive: true });
    db.prepare("VACUUM INTO ?").run(
      path.join(
        backups,
        `${Date.now()}-before-schema-v${schemaVersion}.sqlite`,
      ),
    );
  }
  try {
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  db.prepare("INSERT OR IGNORE INTO settings VALUES(1,?)").run(
    encode(defaults),
  );
  db.prepare("INSERT OR IGNORE INTO meta VALUES('study_shuffle_seed',?)").run(
    randomUUID(),
  );
  const shuffleSeed = db
    .prepare("SELECT value FROM meta WHERE key='study_shuffle_seed'")
    .get().value;
  let shuffleDay,
    shuffleRanks = new Map();
  function shuffleRank(id, day) {
    if (shuffleDay !== day) {
      shuffleDay = day;
      shuffleRanks.clear();
    }
    if (!shuffleRanks.has(id))
      shuffleRanks.set(
        id,
        createHash("sha256")
          .update(`${shuffleSeed}\0${day}\0${id}`)
          .digest("hex"),
      );
    return shuffleRanks.get(id);
  }
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const settings = () =>
    ({ ...defaults, ...parse(db.prepare("SELECT data FROM settings WHERE id=1").get().data) });
  const scheduler = () =>
    fsrs({
      request_retention: settings().retention,
      enable_fuzz: false,
      enable_short_term: true,
      learning_steps: ["1m", "10m"],
      relearning_steps: ["10m"],
    });
  let placeCache;
  const places = () =>
    (placeCache ??= db
      .prepare("SELECT * FROM places")
      .all()
      .map((p) => ({ ...parse(p.data), archived: !!p.archived })));
  function enabledPlace(p, s) {
    if (p.kind === "vocabulary") return !p.archived && s.activeDeck === "vocabulary";
    if (p.archived || (s.regions.length && !s.regions.includes(p.region))) return false;
    if (p.kind === "city") return !!s.cityCountry && p.countryCode === s.cityCountry;
    let kind = p.kind;
    if (kind === "lake") {
      const area = areaKm2(p.geometry);
      if (area < s.lakeMinimumKm2) return false;
      if (area < s.lakeCutoffKm2) kind = "smallLake";
    }
    return s.kinds.includes(kind);
  }
  const editorial = factReview(db, tx, () => {
    const s = settings();
    const eligible = new Set(cards().filter(c => !c.suspended && s.modes.includes(c.mode) &&
      cardDeck(c.mode) === s.activeDeck).map(c => c.place_id));
    return places().filter(p => !p.archived && p.kind !== "vocabulary").map(p => ({
      id:p.id, name:p.name, studying:enabledPlace(p,s) && eligible.has(p.id),
    }));
  });
  const place = (id) => {
    const p = places().find((p) => p.id === id);
    if (!p) throw Error("Unknown place.");
    return p;
  };
  const cards = () =>
    db
      .prepare("SELECT * FROM cards")
      .all()
      .map((c) => ({
        ...c,
        memory: parse(c.memory),
        suspended: !!c.suspended,
      }));
  function putPlace(input, existing) {
    const p = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name: "",
      info: "",
      kind: "territory",
      region: "World",
      aliases: [],
      tags: [],
      small: false,
      approximate: false,
      source: "Personal collection",
      ...existing,
      ...input,
    };
    if (
      typeof p.id !== "string" ||
      !/^[\w-]{1,100}$/.test(p.id) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 160
    )
      throw Error("A valid ID and name (1–160 characters) are required.");
    if (
      !["country", "territory", "water", "region","river","range","desert","lake","city","vocabulary"].includes(p.kind) ||
      !Array.isArray(p.aliases) ||
      p.aliases.some((a) => typeof a !== "string") ||
      !Array.isArray(p.tags) ||
      p.tags.some((a) => typeof a !== "string") ||
      typeof p.info !== "string" ||
      typeof p.region !== "string" ||
      typeof p.source !== "string"
    )
      throw Error("Invalid place fields.");
    if (existing && (existing.kind === "vocabulary") !== (p.kind === "vocabulary")) throw Error("Cannot convert a place to or from a vocabulary entry.");
    if (p.kind === "vocabulary") {
      if (!p.info.trim()) throw Error("A vocabulary definition is required.");
      p.geometry = p.center = null;
      p.approximate = false;
    } else {
      validateGeometry(p.geometry);
      if (!p.center)
        p.center =
          p.geometry.type === "Point"
            ? p.geometry.coordinates
            : p.geometry.type === "Polygon"
              ? p.geometry.coordinates[0][0]
              : p.geometry.coordinates[0][0][0];
      validateGeometry({ type: "Point", coordinates: p.center });
      p.approximate = p.kind !== "city" && (!!p.approximate || p.geometry.type === "Point");
    }
    p.small = !!p.small;
    tx(() => {
      db.prepare(
        "INSERT INTO places VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,archived=excluded.archived",
      ).run(p.id, encode(p), p.archived ? 1 : 0);
      for (const mode of p.kind === "vocabulary" ? vocabularyModes : ["locate", "identify"]) {
        const memory = createEmptyCard(clock());
        db.prepare(
          "INSERT OR IGNORE INTO cards(id,place_id,mode,memory,due,state) VALUES(?,?,?,?,?,0)",
        ).run(`${p.id}:${mode}`, p.id, mode, encode(memory), +memory.due);
      }
      if (existing)
        db.prepare("UPDATE cards SET version=version+1 WHERE place_id=?").run(
          p.id,
        );
    });
    placeCache = undefined;
    return { ...p, archived: !!p.archived };
  }
  if (!db.prepare("SELECT value FROM meta WHERE key='seeded'").get()) {
    for (const p of seed)
      if (!db.prepare("SELECT id FROM places WHERE id=?").get(p.id))
        putPlace(p);
    db.prepare("INSERT INTO meta VALUES('seeded','1')").run();
  }
  function addOptionalCards(enabled) {
    const insert = db.prepare("INSERT OR IGNORE INTO cards(id,place_id,mode,memory,due,state) VALUES(?,?,?,?,?,0)");
    for (const mode of enabled.filter(m => Object.hasOwn(optionalModes, m))) {
      for (const p of places()) {
        if (!facts[p.id]?.[optionalModes[mode]]) continue;
        const memory = createEmptyCard(clock());
        insert.run(p.id + ":" + mode, p.id, mode, encode(memory), +memory.due);
      }
    }
  }
  function definitionChoices(p) {
    const entries = places().filter(term => term.kind === "vocabulary" && !term.archived && term.info !== p.info);
    function shuffle(values) {
      for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
      }
      return values;
    }
    const sameGroup = entries.filter(term => term.region === p.region);
    const others = entries.filter(term => term.region !== p.region);
    const alternatives = new Set([...shuffle(sameGroup), ...shuffle(others)].map(term => term.info));
    return shuffle([p.info, ...[...alternatives].slice(0,3)]);
  }
  const getCard = (id) => {
    const c = db.prepare("SELECT * FROM cards WHERE id=?").get(id);
    if (!c) throw Error("Unknown card.");
    return { ...c, memory: parse(c.memory), suspended: !!c.suspended };
  };
  const saveCard = (c) =>
    db
      .prepare(
        "UPDATE cards SET memory=?,due=?,state=?,reps=?,suspended=?,version=? WHERE id=?",
      )
      .run(
        encode(c.memory),
        +new Date(c.memory.due),
        c.memory.state,
        c.memory.reps,
        c.suspended ? 1 : 0,
        c.version,
        c.id,
      );
  function queue(shuffle = "") {
    const now = clock(),
      s = settings(),
      day = studyDay(now),
      end = nextStudyDay(now);
    const today = db
        .prepare(
          "SELECT * FROM reviews WHERE day=? AND undone=0 ORDER BY rowid",
        )
        .all(day).filter(r => cardDeck(r.card_id.split(":").at(-1)) === s.activeDeck),
      seenPlaces = new Set(today.map((r) => r.place_id)),
      seenCards = new Set(today.map((r) => r.card_id));
    // Count long-term review cards once. New cards and short learning or
    // relearning steps do not use this allowance, including after a lapse.
    const reviewed = new Set(
      today.filter((r) => parse(r.before_card).state === 2).map((r) => r.card_id),
    ).size;
    const reviewRemaining = Math.max(0, s.reviewsPerDay - reviewed);
    const ps = new Map(places().map((p) => [p.id, p]));
    const allCards = cards();
    const eligible = allCards.filter((c) => {
      const p = ps.get(c.place_id);
      return (
        !c.suspended &&
        enabledPlace(p, s) &&
        s.modes.includes(c.mode) &&
        cardDeck(c.mode) === s.activeDeck &&
        (!s.burySiblings || !seenPlaces.has(c.place_id) || seenCards.has(c.id))
      );
    });
    const learning = eligible
      .filter((c) => [1, 3].includes(c.state) && c.due <= +now)
      .sort((a, b) => a.due - b.due);
    const review = eligible
      .filter((c) => c.state === 2 && c.due < +end && !seenCards.has(c.id))
      .sort((a, b) => a.due - b.due);
    const due = [...learning, ...(reviewRemaining ? review : [])]
      .map(card => ({
        card,
        rank: shuffle ? createHash("sha256").update(shuffle + ":" + shuffleRank(card.id, day)).digest("hex") : shuffleRank(card.id, day),
      }))
      .sort((a, b) => a.rank.localeCompare(b.rank))
      .map(entry => entry.card);
    const fresh = eligible
      .filter((c) => c.state === 0)
      .sort((a, b) =>
        shuffleRank(a.id, day).localeCompare(shuffleRank(b.id, day)),
      );
    // Keep the daily shuffle stable across queue reads and restarts, but avoid
    // long runs of one direction whenever the other direction is available.
    const cardModes = new Map(allCards.map((c) => [c.id, c.mode]));
    const recentModes = today.slice(-2).map((r) => cardModes.get(r.card_id));
    function mixedDirection(pool, separateRepeats = false) {
      if (separateRepeats) {
        const otherPlaces = pool.filter(
          (c) => c.place_id !== today.at(-1)?.place_id,
        );
        if (otherPlaces.length) pool = otherPlaces;
      }
      const other =
        recentModes.length === 2 && recentModes[0] === recentModes[1]
          ? pool.find((c) => c.mode !== recentModes[0])
          : undefined;
      return other || pool[0];
    }
    const nextNew = mixedDirection(fresh),
      nextDue = mixedDirection(due);
    const remaining = Math.max(
        0,
        s.newPerDay - today.filter((r) => r.is_new).length,
      ),
      newCount = s.burySiblings
        ? new Set(fresh.map((c) => c.place_id)).size
        : fresh.length;
    const waiting = eligible
      .filter((c) => [1, 3].includes(c.state) && c.due > +now)
      .sort((a, b) => a.due - b.due);
    // Finish short learning steps when the regular queue runs out. Keep their
    // stored due times intact; only an actual rating updates FSRS memory.
    const early = waiting
      .filter((c) => c.due <= +now + 10 * 60 * 1000)
      .sort((a, b) =>
        shuffleRank(`${a.id}:early:${today.length}`, day).localeCompare(
          shuffleRank(`${b.id}:early:${today.length}`, day),
        ),
      );
    const next =
      remaining && nextNew ? nextNew : nextDue || mixedDirection(early, true);
    return {
      next,
      studyDay: day,
      nextDayAt: end.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      counts: {
        new: Math.min(remaining, newCount),
        review: Math.min(review.length, reviewRemaining),
        learning: learning.length + early.length,
      },
      reviewLimit: {
        limit: s.reviewsPerDay,
        reviewed,
        remaining: reviewRemaining,
        deferred: Math.max(0, review.length - reviewRemaining),
      },
      nextLearningAt: waiting[0]
        ? new Date(waiting[0].due).toISOString()
        : null,
      today: today.length,
    };
  }
  const attempts = new Map();
  const studyLog = createStudyLog(db, clock);
  function question({ practice = false, placeId, mode, shuffle = "" } = {}) {
    if (typeof shuffle !== "string" || shuffle.length > 128) throw Error("Invalid shuffle key.");
    let card;
    if (practice) {
      const ps = new Map(places().map((p) => [p.id, p]));
      const eligible = cards().filter(
        (c) =>
          !ps.get(c.place_id).archived &&
          (!placeId || c.place_id === placeId) &&
          (!mode || c.mode === mode),
      );
      card = eligible[Math.floor(Math.random() * eligible.length)];
    } else card = queue(shuffle).next;
    if (!card) {
      const q = queue();
      return {
        card: null,
        counts: q.counts,
        nextLearningAt: q.nextLearningAt,
        nextDayAt: q.nextDayAt,
        reviewLimit: q.reviewLimit,
      };
    }
    const p = place(card.place_id),
      token = randomUUID();
    studyLog.start(token, card, p, settings(), practice);
    attempts.set(token, { card, practice, started: +clock(), checked: false });
    if (attempts.size > 1000) attempts.delete(attempts.keys().next().value);
    return {
      token,
      practice,
      card: {
        id: card.id,
        mode: card.mode,
        state: card.state,
        version: card.version,
        kind: p.kind,
        name: ["locate", "capital", "flag", "define"].includes(card.mode) ? p.name : null,
        ...(card.mode === "term" && {definition:p.info}),
        ...(card.mode === "define" && {definitions:definitionChoices(p)}),
        ...(card.mode === "fromCapital" && { capital: facts[p.id].capital, hint: facts[p.id].capital_hint }),
        ...(card.mode === "fromFlag" && { flag: facts[p.id].flag }),
        ...(card.mode === "flag" && { choices: flagChoices(p.id, token) }),
        geometry: card.mode === "identify" ? p.geometry : null,
        center: card.mode === "identify" ? p.center : null,
        approximate: p.approximate,
        trace: card.mode === "locate" && p.geometry.type === "MultiLineString",
        small: p.small,
      },
      counts: queue().counts,
    };
  }
  function loadAttempt(token) {
    if (typeof token !== "string") return;
    if (attempts.has(token)) return attempts.get(token);
    const row = db.prepare("SELECT * FROM study_attempts WHERE id=?").get(token);
    if (!row) return;
    const current = getCard(row.card_id);
    const snapshot = parse(row.snapshot).card;
    const last = db.prepare("SELECT result FROM study_checks WHERE attempt_id=? ORDER BY sequence DESC LIMIT 1").get(token);
    const attempt = {
      card: { ...current, ...snapshot },
      practice: Boolean(row.practice),
      started: Date.parse(row.started_at),
      checked: Boolean(last),
      result: last && parse(last.result),
    };
    if (row.rating !== null) {
      if (row.practice) attempt.saved = { practice: true };
      else {
        const review = db.prepare("SELECT after_card, undone FROM reviews WHERE id=?").get(row.review_id);
        if (!review || review.undone) throw Error("This review was undone. Load a new card.");
        attempt.saved = { card: parse(review.after_card), counts: queue().counts };
      }
    }
    return attempt;
  }
  function check(token, answer) {
    const a = loadAttempt(token);
    if (!a) throw Error("Question expired. Load a new card.");
    if (a.saved) throw Error("This question has already been rated.");
    const p = place(a.card.place_id);
    a.result = checkAnswer(p, a.card.mode, answer);
    if (a.card.mode === "locate" && a.result.correct === false && !answer.reveal) {
      const matches = places().filter(candidate =>
        !candidate.archived && candidate.kind !== "vocabulary" && !candidate.approximate && candidate.geometry.type !== "Point" &&
        (["country","territory","water"].includes(candidate.kind) || (p.kind === "lake" && candidate.kind === "lake")) && ["Polygon","MultiPolygon"].includes(candidate.geometry.type) && booleanPointInPolygon(answer.point, candidate.geometry)
      );
      const lakes = matches.filter(candidate => candidate.kind === "lake");
      const land = matches.filter(candidate => ["country", "territory"].includes(candidate.kind));
      const candidates = lakes.length ? lakes : land.length ? land : matches;
      const names = candidates.map(candidate => candidate.name);
      if (names.length) a.result.message = `Your pin is in ${names.join(" / ")}.`;
    }
    const now = clock(),
      next = scheduler().repeat(hydrate(a.card.memory), now);
    studyLog.check(token, answer, a.result);
    a.checked = true;
    const fact = editorial.current(p.id);
    const legacyFact = approvedFacts[p.id];
    // Earlier collections appended these facts to notes on both correct and missed answers.
    const answerPlace = legacyFact?.text && p.info.endsWith(legacyFact.text)
      ? { ...p, info: p.info.slice(0, -legacyFact.text.length).trimEnd() } : p;
    return {
      ...a.result,
      ...(Object.hasOwn(optionalModes, a.card.mode) && { facts: facts[p.id] }),
      place: answerPlace,
      ...(a.result.correct === true && fact && { placeFact: fact }),
      intervals: [1, 2, 3, 4].map((r) => {
        const card = scheduleStudyDay(next[r].card, now);
        return {
          rating: r,
          due: card.due,
          days: card.state === 2 ? card.scheduled_days : null,
          seconds: Math.max(0, (+card.due - +now) / 1000),
        };
      }),
    };
  }
  function review(token, grade) {
    const a = loadAttempt(token);
    if (!a || !a.checked)
      throw Error("Check or reveal the answer before rating it.");
    if (a.saved) return a.saved;
    if (![1, 2, 3, 4].includes(grade))
      throw Error("Rating must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy).");
    if (a.practice) {
      studyLog.rate(token, grade);
      a.saved = { practice: true };
      return a.saved;
    }
    const current = getCard(a.card.id);
    if (current.version !== a.card.version)
      throw Error("This card changed in another session. Load it again.");
    if (current.suspended || place(current.place_id).archived)
      throw Error("This card is paused or archived.");
    if (current.state === 2 && !queue().reviewLimit.remaining)
      throw Error("Daily review limit reached. Raise it in Settings or continue after 4am.");
    const now = clock(),
      r = scheduler().next(hydrate(current.memory), now, grade),
      scheduled = scheduleStudyDay(r.card, now),
      after = {
        ...current,
        memory: scheduled,
        due: +scheduled.due,
        state: scheduled.state,
        reps: scheduled.reps,
        version: current.version + 1,
      };
    const reviewId = randomUUID();
    tx(() => {
      saveCard(after);
      db.prepare(
        "INSERT INTO reviews(id,card_id,place_id,at,day,grade,correct,is_new,before_card,after_card,duration_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        reviewId,
        current.id,
        current.place_id,
        now.toISOString(),
        studyDay(now),
        grade,
        a.result.correct === null ? null : a.result.correct ? 1 : 0,
        current.state === 0 ? 1 : 0,
        encode(current),
        encode(after),
        Math.min(3600000, +now - a.started),
      );
      studyLog.rate(token, grade, reviewId);
    });
    a.saved = { card: getCard(current.id), counts: queue().counts };
    return a.saved;
  }
  function undo() {
    const r = db
      .prepare(
        "SELECT * FROM reviews WHERE undone=0 ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    if (!r) throw Error("No review to undo.");
    const before = parse(r.before_card),
      current = getCard(r.card_id);
    tx(() => {
      saveCard({
        ...before,
        suspended: current.suspended,
        version: current.version + 1,
      });
      db.prepare("UPDATE reviews SET undone=1 WHERE id=?").run(r.id);
    });
    attempts.clear();
    return { card: getCard(r.card_id), place: place(r.place_id) };
  }
  function stats() {
    const cs = cards(),
      ps = new Map(places().map((p) => [p.id, p])),
      history = db
        .prepare(
          "SELECT day,count(*) AS count,sum(grade>1) AS recalled,sum(is_new) AS introduced FROM reviews WHERE undone=0 GROUP BY day ORDER BY day DESC",
        )
        .all(),
      active = cs.filter((c) => !c.suspended && !ps.get(c.place_id)?.archived),
      today = history.find((d) => d.day === studyDay(clock()));
    return {
      places: [...ps.values()].filter((p) => !p.archived).length,
      cards: cs.length,
      learned: active.filter((c) => c.state === 2).length,
      learning: active.filter((c) => [1, 3].includes(c.state)).length,
      new: active.filter((c) => c.state === 0).length,
      reviews: history.reduce((n, d) => n + d.count, 0),
      today: today?.count ?? 0,
      recall: today?.count
        ? Math.round((today.recalled / today.count) * 100)
        : null,
      history,
      ...queue(),
      next: undefined,
    };
  }
  const exportData = () => ({
    format: "migs-geo",
    schemaVersion,
    version: 2,
    exportedAt: clock().toISOString(),
    settings: settings(),
    places: places(),
    cards: cards(),
    reviews: db.prepare("SELECT * FROM reviews ORDER BY rowid").all(),
    studyLog: studyLog.exportData(),
    factReview: editorial.backup(),
  });
  function restore(data) {
    if (
      data?.format !== "migs-geo" ||
      ![1, 2].includes(data.version) ||
      !Array.isArray(data.cards) ||
      !Array.isArray(data.places) ||
      !Array.isArray(data.reviews)
    )
      throw Error("This is not a supported Migs Geo backup.");
    const restoredSettings = validateSettings(data.settings);
    const ids = new Set(data.places.map((p) => p.id));
    if (ids.size !== data.places.length) throw Error("Duplicate place IDs.");
    const vocabIds = new Set(data.places.filter(p => p.kind === "vocabulary").map(p => p.id));
    for (const p of data.places) {
      if (p.kind === "vocabulary") {
        if (p.geometry !== null || p.center !== null || typeof p.info !== "string" || !p.info.trim()) throw Error("Invalid vocabulary entry.");
      } else {
        validateGeometry(p.geometry);
        validateGeometry({ type: "Point", coordinates: p.center });
      }
      if (
        typeof p.id !== "string" ||
        !/^[\w-]{1,100}$/.test(p.id) ||
        typeof p.name !== "string" ||
        !p.name ||
        p.name.length > 160 ||
        typeof p.info !== "string" ||
        typeof p.region !== "string" ||
        !Array.isArray(p.tags) ||
        p.tags.some((t) => typeof t !== "string") ||
        !Array.isArray(p.aliases) ||
        p.aliases.some((a) => typeof a !== "string") ||
        !["country", "territory", "water", "region","river","range","desert","lake","city","vocabulary"].includes(p.kind)
      )
        throw Error("Invalid place in backup.");
    }
    function validCard(c) {
      if (
        !c ||
        !ids.has(c.place_id) ||
        !modes.includes(c.mode) ||
        vocabularyModes.includes(c.mode) !== vocabIds.has(c.place_id) ||
        (Object.hasOwn(optionalModes,c.mode) && !facts[c.place_id]?.[optionalModes[c.mode]]) ||
        c.id !== `${c.place_id}:${c.mode}` ||
        !Number.isFinite(+new Date(c.memory?.due)) ||
        ![0, 1, 2, 3].includes(c.memory?.state) ||
        !Number.isInteger(c.memory?.reps) ||
        c.memory.reps < 0 ||
        !Number.isInteger(c.version) ||
        c.version < 0
      )
        throw Error("Invalid card in backup.");
      for (const key of [
        "stability",
        "difficulty",
        ...(Object.hasOwn(c.memory, "elapsed_days") ? ["elapsed_days"] : []),
        "scheduled_days",
        "learning_steps",
        "lapses",
      ])
        if (!Number.isFinite(c.memory[key]) || c.memory[key] < 0)
          throw Error("Invalid scheduling memory in backup.");
      if (
        c.memory.last_review &&
        !Number.isFinite(+new Date(c.memory.last_review))
      )
        throw Error("Invalid last review date.");
      scheduler().repeat(
        hydrate(c.memory),
        new Date(Math.max(+clock(), +new Date(c.memory.last_review || 0))),
      );
    }
    const cids = new Set();
    for (const c of data.cards) {
      if (cids.has(c.id)) throw Error("Duplicate card IDs.");
      validCard(c);
      cids.add(c.id);
    }
    const rids = new Set();
    for (const r of data.reviews) {
      if (
        typeof r.id !== "string" ||
        rids.has(r.id) ||
        !cids.has(r.card_id) ||
        !ids.has(r.place_id) ||
        ![1, 2, 3, 4].includes(r.grade) ||
        !Number.isFinite(+new Date(r.at)) ||
        typeof r.day !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(r.day) ||
        ![0, 1, null].includes(r.correct) ||
        ![0, 1].includes(r.is_new) ||
        ![0, 1].includes(r.undone) ||
        !Number.isInteger(r.duration_ms) ||
        r.duration_ms < 0
      )
        throw Error("Invalid review in backup.");
      const before = parse(r.before_card),
        after = parse(r.after_card);
      validCard(before);
      validCard(after);
      if (
        before.id !== r.card_id ||
        after.id !== r.card_id ||
        before.place_id !== r.place_id ||
        after.place_id !== r.place_id
      )
        throw Error("Review belongs to another card.");
      rids.add(r.id);
    }
    const logData =
      data.version === 2 ? data.studyLog : { attempts: [], checks: [] };
    validateStudyLog(
      logData,
      cids,
      ids,
      new Map(data.reviews.map((r) => [r.id, r])),
    );
    tx(() => {
      studyLog.clear();
      db.exec("DELETE FROM reviews;DELETE FROM cards;DELETE FROM places;");
      for (const p of data.places)
        db.prepare("INSERT INTO places VALUES(?,?,?)").run(
          p.id,
          encode((data.schemaVersion ?? 0) < 6 && p.kind === "water" &&
            ["aral-sea", "dead-sea", "caspian-sea", "sea-of-galilee"].includes(p.id)
              ? { ...p, kind: "lake" } : p),
          p.archived ? 1 : 0,
        );
      for (const c of data.cards)
        db.prepare("INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?)").run(
          c.id,
          c.place_id,
          c.mode,
          encode(c.memory),
          +new Date(c.memory.due),
          c.memory.state,
          c.memory.reps,
          c.suspended ? 1 : 0,
          (c.version ?? 0) + 1,
        );
      for (const r of data.reviews)
        db.prepare("INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
          r.id,
          r.card_id,
          r.place_id,
          r.at,
          studyDay(new Date(r.at)),
          r.grade,
          r.correct,
          r.is_new,
          r.before_card,
          r.after_card,
          r.duration_ms,
          r.undone ?? 0,
        );
      db.prepare("UPDATE settings SET data=? WHERE id=1").run(
        encode(restoredSettings),
      );
      studyLog.restore(logData);
      editorial.restore(data.factReview ?? []);
    });
    placeCache = undefined;
    attempts.clear();
    return { restored: true, places: ids.size, cards: cids.size };
  }
  function installMapPacks(s) {
    const country = s.cityCountry;
    const cityPlaces = (cities[country] || []).map(([id,name,lon,lat]) => ({
      id:"city-"+id, name, countryCode:country, kind:"city", region:cityRegions[country] || "World",
      aliases:[], tags:[], small:false, approximate:false, archived:false,
      source:"Natural Earth populated places", info:"",
      geometry:{type:"Point",coordinates:[lon,lat]}, center:[lon,lat],
    }));
    const words = s.modes.some(mode => vocabularyModes.includes(mode)) ? vocabularyPlaces : [];
    for (const p of [...words, ...physicalPlaces.filter(p=>s.kinds.includes(p.kind)), ...(s.kinds.some(k => k === "lake" || k === "smallLake") ? lakePlaces : []), ...cityPlaces]) {
      if ( db.prepare("SELECT id FROM places WHERE id=?").get(p.id)) continue;
      db.prepare("INSERT INTO places VALUES(?,?,0)").run(p.id, encode(p));
      for (const mode of p.kind === "vocabulary" ? vocabularyModes : ["locate","identify"]) {
        const memory = createEmptyCard(clock());
        db.prepare("INSERT INTO cards(id,place_id,mode,memory,due,state) VALUES(?,?,?,?,?,0)")
          .run(p.id+":"+mode,p.id,mode,encode(memory),+memory.due);
      }
      placeCache = undefined;
    }
  }
  tx(() => installMapPacks(settings()));
  return {
    editorial,
    vocabulary: () => {
      const terms = new Map(vocabularyPlaces.map(p => [p.id,p]));
      for (const p of places()) {
        if (p.kind === "vocabulary" && !p.archived) terms.set(p.id,p);
        else terms.delete(p.id);
      }
      return [...terms.values()].map(p => ({id:p.id, term:p.name, definition:p.info, group:p.region, aliases:p.aliases}));
    },
    lakeReview: () => {
      const candidates = new Map(lakePlaces.map(p => [p.id,p]));
      for (const p of places()) {
        if (p.kind === "lake" && !p.archived) candidates.set(p.id,p);
        else candidates.delete(p.id);
      }
      const {lakeCutoffKm2:cutoff, lakeMinimumKm2:minimum} = settings();
      return {cutoff, minimum, lakes:[...candidates.values()].map(p => ({
        id:p.id,name:p.name,region:p.region,countries:lakeLocations[p.id] ?? [],area:areaKm2(p.geometry),
      }))};
    },
    health: () => {
      db.prepare("SELECT data FROM settings WHERE id=1").get();
      return {
        database: "ok",
        schemaVersion: db.prepare("PRAGMA user_version").get().user_version,
      };
    },
    db,
    place,
    places,
    cards,
    getCard,
    queue,
    question,
    check,
    review,
    undo,
    stats,
    analytics: (filters) =>
      analytics(db, places(), cards(), filters, studyDay(clock())),
    studyLog: studyLog.list,
    exportData,
    restore,
    settings,
    backup: (destination) => {
      if (!existsSync(destination))
        db.prepare("VACUUM INTO ?").run(destination);
      return destination;
    },
    setSettings: (patch) => {
      const s = validateSettings({ ...settings(), ...patch });
      tx(() => {
        installMapPacks(s);
        addOptionalCards(s.modes);
        db.prepare("UPDATE settings SET data=? WHERE id=1").run(encode(s));
      });
      return s;
    },
    createPlace: (p) => {
      if (p.id && db.prepare("SELECT id FROM places WHERE id=?").get(p.id))
        throw Error("Place ID already exists.");
      return putPlace(p);
    },
    updatePlace: (id, p) => putPlace({ ...p, id }, place(id)),
    updateCard: (id, p) => {
      const c = getCard(id);
      if (p.suspended !== undefined && typeof p.suspended !== "boolean")
        throw Error("Suspended must be true or false.");
      if (p.reset === true) {
        c.memory = createEmptyCard(clock());
      }
      if (p.due !== undefined) {
        if (c.memory.state === 0)
          throw Error("New cards do not have a review date.");
        if (!Number.isFinite(+new Date(p.due)))
          throw Error("Invalid due date.");
        c.memory.due = new Date(p.due);
      }
      c.suspended = p.suspended ?? c.suspended;
      c.version++;
      saveCard(c);
      return getCard(id);
    },
    history: () =>
      db
        .prepare(
          "SELECT id,card_id,place_id,at,day,grade,correct,is_new,duration_ms,undone FROM reviews ORDER BY rowid DESC",
        )
        .all(),
  };
}
