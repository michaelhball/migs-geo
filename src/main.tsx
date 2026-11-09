import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Globe2,
  ArrowRight,
  Check,
  X,
  RotateCcw,
  Search,
  Pause,
  Play,
  Download,
  Upload,
  SlidersHorizontal,
  MapPin,
  ArrowLeft,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { Atlas } from "./Map";
import { Statistics } from "./Statistics";
import "./style.css";
async function api(route: string, method = "GET", data?: any) {
  const r = await fetch("/api" + route, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Request failed.");
  return result;
}
const kindNames: any = {
  country: "Country",
  territory: "Territory / island",
  water: "Body of water",
  region: "Region / continent",
};
const states = ["New", "Learning", "Review", "Relearning"];
function interval(seconds: number) {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr`;
  const d = Math.round(seconds / 86400);
  return d < 30
    ? `${d} day${d === 1 ? "" : "s"}`
    : d < 365
      ? `${Math.round(d / 30)} mo`
      : `${(d / 365).toFixed(1)} yr`;
}
function plain(s: string) {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&");
}
function App() {
  const [tab, setTab] = useState("study"),
    [stats, setStats] = useState<any>(null),
    [settings, setSettings] = useState<any>(null),
    [places, setPlaces] = useState<any[]>([]),
    [cards, setCards] = useState<any[]>([]);
  const [question, setQuestion] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [point, setPoint] = useState<number[] | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState("all"),
    [selected, setSelected] = useState<any>(null),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<any>(null),
    [pendingBackup, setPendingBackup] = useState<any>(null);
  const lock = useRef(false),
    fileInput = useRef<HTMLInputElement>(null);
  async function refresh() {
    const [s, c, p, k] = await Promise.all([
      api("/stats"),
      api("/settings"),
      api("/places"),
      api("/cards"),
    ]);
    setStats(s);
    setSettings(c);
    setPlaces(p);
    setCards(k);
  }
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    run(refresh);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (tab !== "study" || question?.card || !question?.nextLearningAt) return;
    const ms = Math.max(
      1000,
      new Date(question.nextLearningAt).getTime() - Date.now(),
    );
    const t = setTimeout(
      () => {
        run(async () => {
          setQuestion(await api("/study/next", "POST", {}));
          await refresh();
        });
      },
      Math.min(ms, 60000),
    );
    return () => clearTimeout(t);
  }, [question, tab]);
  async function next() {
    const q = await api("/study/next", "POST", {});
    setQuestion(q);
    setResult(null);
    setPoint(null);
    setText("");
    setTab("study");
  }
  const start = () => run(() => next());
  const check = (reveal = false) =>
    run(async () => {
      setResult(
        await api("/study/check", "POST", {
          token: question.token,
          answer: reveal
            ? { reveal: true }
            : question.card.mode === "locate"
              ? { point }
              : { text },
        }),
      );
    });
  const rate = (rating: number) =>
    run(async () => {
      await api("/study/rate", "POST", { token: question.token, rating });
      await next();
      await refresh();
    });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).matches("input,textarea,select") ||
        tab !== "study" ||
        busy ||
        !question?.card
      )
        return;
      if (result && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        rate(Number(e.key));
      } else if (e.key === "Enter" && !result && (point || text)) {
        e.preventDefault();
        check();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [tab, busy, question, result, point, text]);
  const openPlace = (id: string) =>
    run(async () => {
      setSelected(await api("/places/" + id));
      setEditing(false);
      setTab("browse");
    });
  const saveSettings = (patch: any) =>
    run(async () => {
      setSettings(await api("/settings", "PATCH", patch));
      await refresh();
      setQuestion(null);
      setResult(null);
      setNotice("Settings saved.");
    });
  const undo = () =>
    run(async () => {
      await api("/reviews/undo", "POST", {});
      await next();
      await refresh();
      setNotice("Last review undone.");
    });
  const pausePlace = (p: any, pause: boolean) =>
    run(async () => {
      for (const c of cards.filter((c) => c.place_id === p.id))
        await api("/cards/" + c.id, "PATCH", { suspended: pause });
      await refresh();
      setNotice(pause ? "Place paused." : "Place resumed.");
    });
  const createDraft = () => {
    setSelected(null);
    setDraft({
      name: "",
      kind: "territory",
      region: "World",
      info: "",
      aliases: "",
      lat: "",
      lon: "",
    });
    setEditing(true);
  };
  const editPlace = () => {
    setDraft({
      ...selected,
      aliases: selected.aliases.join(", "),
      lon: selected.center[0],
      lat: selected.center[1],
    });
    setEditing(true);
  };
  const savePlace = () =>
    run(async () => {
      const data = {
        name: draft.name,
        kind: draft.kind,
        region: draft.region,
        info: draft.info,
        aliases: draft.aliases
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean),
        ...(!selected
          ? {
              geometry: {
                type: "Point",
                coordinates: [Number(draft.lon), Number(draft.lat)],
              },
              approximate: true,
            }
          : {}),
      };
      if (!selected && (draft.lat === "" || draft.lon === ""))
        throw Error("Enter latitude and longitude.");
      setSelected(
        await api(
          selected ? "/places/" + selected.id : "/places",
          selected ? "PATCH" : "POST",
          data,
        ),
      );
      setEditing(false);
      await refresh();
      setNotice("Place saved.");
    });
  const filtered = places
    .filter(
      (p) =>
        (kind === "all" || p.kind === kind) &&
        [p.name, ...p.aliases].some((s) =>
          s.toLowerCase().includes(search.toLowerCase()),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalDue = stats
    ? stats.counts.new + stats.counts.review + stats.counts.learning
    : 0;
  const geometry =
    tab === "study"
      ? result?.place.geometry || question?.card?.geometry
      : selected?.geometry;
  const center =
    tab === "study"
      ? result?.place.center || question?.card?.center
      : selected?.center;
  return (
    <div className="app">
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("study");
          }}
        >
          <Globe2 size={25} strokeWidth={1.6} />
          <span>Migs Geo</span>
        </a>
        <nav aria-label="Main navigation">
          {["study", "browse", "settings"].map((t) => (
            <button
              key={t}
              aria-current={
                tab === t || (tab === "statistics" && t === "study")
                  ? "page"
                  : undefined
              }
              className={
                tab === t || (tab === "statistics" && t === "study")
                  ? "active"
                  : ""
              }
              onClick={() => {
                setTab(t);
                setError("");
              }}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <div className="local">
          <i />
          Local only
        </div>
      </header>
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {!stats ? (
        <main className="loading">
          {error ? (
            <button className="primary" onClick={() => run(refresh)}>
              Retry connection
            </button>
          ) : (
            "Loading…"
          )}
        </main>
      ) : (
        <>
          {tab === "study" && (
            <main className="study-page">
              <div className="page-heading">
                <div>
                  <h1>Study</h1>
                  <span className="subtle">{stats.today} reviewed today</span>
                </div>
                <div className="counts">
                  <button
                    className="statistics-button"
                    onClick={() => setTab("statistics")}
                  >
                    Statistics
                  </button>
                  <span>
                    <i className="dot new" />
                    {question?.counts?.new ?? stats.counts.new} new
                  </span>
                  <span>
                    <i className="dot learning" />
                    {question?.counts?.learning ?? stats.counts.learning}{" "}
                    learning
                  </span>
                  <span>
                    <i className="dot due" />
                    {question?.counts?.review ?? stats.counts.review} due
                  </span>
                </div>
              </div>
              <div className="study-layout">
                <Atlas
                  geometry={geometry}
                  center={center}
                  point={point}
                  active={
                    !!question?.card &&
                    !result &&
                    question.card.mode === "locate"
                  }
                  onSelect={setPoint}
                  name={result?.place.name}
                  revealed={!!result}
                  correct={result?.correct}
                  resetKey={question?.token || "home"}
                />
                <aside className="study-panel">
                  {!question ? (
                    <>
                      <div className="panel-content">
                        <h2>
                          {totalDue
                            ? "Ready to study"
                            : "Nothing due right now"}
                        </h2>
                        <p>Countries, territories, water, and regions.</p>
                        <div className="session-summary">
                          <div>
                            <span>Reviews and learning</span>
                            <strong>
                              {stats.counts.review + stats.counts.learning}
                            </strong>
                          </div>
                          <div>
                            <span>New cards</span>
                            <strong>{stats.counts.new}</strong>
                          </div>
                        </div>
                        <button
                          className="primary full"
                          disabled={busy || !totalDue}
                          onClick={start}
                        >
                          Start studying <ArrowRight size={17} />
                        </button>
                      </div>
                      <div className="panel-foot">
                        <span>
                          {places.length} places · {cards.length} cards
                        </span>
                        <p>
                          Two directions: find the place on a map, or name the
                          highlighted place.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setTab("settings")}
                        >
                          <SlidersHorizontal size={14} />
                          Study settings
                        </button>
                      </div>
                    </>
                  ) : !question.card ? (
                    <>
                      <div className="panel-content empty-state">
                        <CheckCircle2 size={32} />
                        <h2>
                          {question.nextLearningAt
                            ? "Reviews are scheduled"
                            : "Done for now"}
                        </h2>
                        <p>
                          {question.nextLearningAt
                            ? `The next learning card is due at ${new Date(question.nextLearningAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. This screen will update automatically.`
                            : "No more cards are due in your current selection."}
                        </p>
                        <button
                          className="secondary full"
                          onClick={() => {
                            setQuestion(null);
                          }}
                        >
                          Back to study
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="panel-content">
                        <div className="card-meta">
                          <span>{states[question.card.state]}</span>
                          <span>{kindNames[question.card.kind]}</span>
                        </div>
                        {!result ? (
                          <>
                            <h2>
                              {question.card.mode === "locate"
                                ? `Find ${question.card.name}`
                                : "Name the highlighted place"}
                            </h2>
                            <p>
                              {question.card.mode === "locate"
                                ? "Click the map to select your answer. Drag to move and scroll to zoom."
                                : "Type the name, then check your answer."}
                            </p>
                            {question.card.mode === "identify" && (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  check();
                                }}
                              >
                                <label className="sr-only" htmlFor="answer">
                                  Place name
                                </label>
                                <input
                                  id="answer"
                                  autoFocus
                                  autoComplete="off"
                                  placeholder="Place name"
                                  value={text}
                                  onChange={(e) => setText(e.target.value)}
                                />
                              </form>
                            )}
                            {question.card.mode === "locate" && (
                              <div
                                className={
                                  "selection " + (point ? "chosen" : "")
                                }
                              >
                                <MapPin size={17} />
                                {point
                                  ? `${Math.abs(point[1]).toFixed(2)}° ${point[1] >= 0 ? "N" : "S"}, ${Math.abs(point[0]).toFixed(2)}° ${point[0] >= 0 ? "E" : "W"}`
                                  : "No location selected"}
                              </div>
                            )}
                            {question.card.approximate && (
                              <p className="small-note">
                                Approximate region · self-graded
                              </p>
                            )}
                            <button
                              className="primary full"
                              disabled={
                                busy ||
                                (question.card.mode === "locate"
                                  ? !point
                                  : !text.trim())
                              }
                              onClick={() => check()}
                            >
                              Check answer <span className="shortcut">↵</span>
                            </button>
                            <button
                              className="text-button reveal"
                              disabled={busy}
                              onClick={() => check(true)}
                            >
                              I don’t know · show answer
                            </button>
                          </>
                        ) : (
                          <>
                            <div
                              className={
                                "feedback " +
                                (result.correct === true
                                  ? "correct"
                                  : result.correct === false
                                    ? "incorrect"
                                    : "neutral")
                              }
                            >
                              {result.correct === true ? (
                                <Check size={18} />
                              ) : result.correct === false ? (
                                <X size={18} />
                              ) : (
                                <MapPin size={18} />
                              )}
                              <span>
                                {result.revealed
                                  ? "Answer shown"
                                  : result.correct === true
                                    ? "Correct"
                                    : result.correct === false
                                      ? "Not quite"
                                      : "Check your answer"}
                              </span>
                            </div>
                            <h2>{result.place.name}</h2>
                            <p>{result.message}</p>
                            {result.place.info && (
                              <p className="place-info">
                                {plain(result.place.info)}
                              </p>
                            )}
                            <div className="rating-label">
                              How well did you remember?
                            </div>
                            <div className="ratings">
                              {["Again", "Hard", "Good", "Easy"].map(
                                (label, i) => (
                                  <button
                                    className={"rate rate-" + i}
                                    disabled={busy}
                                    key={label}
                                    onClick={() => rate(i + 1)}
                                  >
                                    <span>
                                      {label}
                                      <kbd>{i + 1}</kbd>
                                    </span>
                                    <small>
                                      {interval(result.intervals[i].seconds)}
                                    </small>
                                  </button>
                                ),
                              )}
                            </div>
                            <p className="small-note">
                              Use Again for a forgotten answer. Your rating sets
                              the next review.
                            </p>
                          </>
                        )}
                      </div>
                      <div className="panel-foot">
                        <span>
                          {question.card.mode === "locate"
                            ? "Place → map"
                            : "Map → place"}
                        </span>
                        {question.card.small && (
                          <p>
                            Small islands and places allow clicks within 3 km of
                            the coast or boundary.
                          </p>
                        )}
                        <button
                          className="text-button"
                          onClick={() => {
                            setQuestion(null);
                            setResult(null);
                            setPoint(null);
                          }}
                        >
                          End session
                        </button>
                      </div>
                    </>
                  )}
                </aside>
              </div>
              <div className="study-footer">
                <span>Map data is stored on this computer.</span>
                <button
                  className="text-button"
                  disabled={busy || !stats.reviews}
                  onClick={undo}
                >
                  <RotateCcw size={14} />
                  Undo last review
                </button>
              </div>
            </main>
          )}
          {tab === "statistics" && (
            <Statistics
              api={api}
              onBack={() => setTab("study")}
              onOpenPlace={openPlace}
            />
          )}
          {tab === "browse" && (
            <main className="browse-page">
              <div className="page-heading">
                <div>
                  <h1>Browse</h1>
                  <span className="subtle">
                    {places.length} places · {cards.length} cards
                  </span>
                </div>
                <button className="secondary" onClick={createDraft}>
                  Add place
                </button>
              </div>
              <div className="browse-layout">
                <div className="place-list">
                  <div className="list-filters">
                    <label className="search">
                      <Search size={17} />
                      <input
                        aria-label="Search places"
                        placeholder="Search places"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter place type"
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="all">All types</option>
                      {Object.entries(kindNames).map(([key, label]) => (
                        <option key={key} value={key}>
                          {String(label)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="list-count">{filtered.length} places</div>
                  <div className="list-scroll">
                    {filtered.map((p) => {
                      const cs = cards.filter((c) => c.place_id === p.id),
                        paused = cs.every((c) => c.suspended);
                      return (
                        <button
                          className={
                            "place-row " +
                            (selected?.id === p.id ? "selected" : "")
                          }
                          key={p.id}
                          onClick={() => openPlace(p.id)}
                        >
                          <span>
                            {p.name}
                            <small>
                              {kindNames[p.kind]} · {p.region}
                            </small>
                          </span>
                          <span className="place-status">
                            {paused ? (
                              <Pause size={13} />
                            ) : cs.some((c) => c.state > 0) ? (
                              "Learning"
                            ) : (
                              "New"
                            )}
                          </span>
                        </button>
                      );
                    })}
                    {!filtered.length && (
                      <p className="no-results">No places match this search.</p>
                    )}
                  </div>
                </div>
                <section className="browse-detail">
                  {editing ? (
                    <div className="edit-form">
                      <button
                        className="text-button"
                        onClick={() => setEditing(false)}
                      >
                        <ArrowLeft size={16} />
                        Cancel
                      </button>
                      <h2>{selected ? "Edit place" : "Add place"}</h2>
                      <label>
                        Name
                        <input
                          value={draft.name}
                          onChange={(e) =>
                            setDraft({ ...draft, name: e.target.value })
                          }
                        />
                      </label>
                      <div className="form-grid">
                        <label>
                          Type
                          <select
                            value={draft.kind}
                            onChange={(e) =>
                              setDraft({ ...draft, kind: e.target.value })
                            }
                          >
                            {Object.entries(kindNames).map(([key, label]) => (
                              <option key={key} value={key}>
                                {String(label)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Region
                          <input
                            value={draft.region}
                            onChange={(e) =>
                              setDraft({ ...draft, region: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Notes
                        <textarea
                          rows={3}
                          value={draft.info}
                          onChange={(e) =>
                            setDraft({ ...draft, info: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Accepted names, separated by commas
                        <input
                          value={draft.aliases}
                          onChange={(e) =>
                            setDraft({ ...draft, aliases: e.target.value })
                          }
                        />
                      </label>
                      {!selected && (
                        <>
                          <div className="form-grid">
                            <label>
                              Latitude
                              <input
                                type="number"
                                min="-90"
                                max="90"
                                value={draft.lat}
                                onChange={(e) =>
                                  setDraft({ ...draft, lat: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              Longitude
                              <input
                                type="number"
                                min="-180"
                                max="180"
                                value={draft.lon}
                                onChange={(e) =>
                                  setDraft({ ...draft, lon: e.target.value })
                                }
                              />
                            </label>
                          </div>
                          <p className="small-note">
                            This adds a self-graded point location and two
                            cards. For exact area selection, add a GeoJSON
                            polygon through the API.
                          </p>
                        </>
                      )}
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={savePlace}
                      >
                        Save place
                      </button>
                    </div>
                  ) : (
                    <>
                      <Atlas
                        geometry={selected?.geometry}
                        center={selected?.center}
                        name={selected?.name}
                        explore
                        resetKey={selected?.id}
                      />
                      <div className="place-details">
                        {selected ? (
                          <>
                            <div className="detail-heading">
                              <div>
                                <span className="eyebrow">
                                  {kindNames[selected.kind]} · {selected.region}
                                </span>
                                <h2>{selected.name}</h2>
                              </div>
                              <button className="secondary" onClick={editPlace}>
                                Edit
                              </button>
                            </div>
                            {selected.info && <p>{plain(selected.info)}</p>}
                            {selected.aliases.length > 0 && (
                              <p className="small-note">
                                Also accepts: {selected.aliases.join(", ")}
                              </p>
                            )}
                            <div className="card-details">
                              {cards
                                .filter((c) => c.place_id === selected.id)
                                .map((c) => (
                                  <div key={c.id}>
                                    <span>
                                      {c.mode === "locate"
                                        ? "Place → map"
                                        : "Map → place"}
                                    </span>
                                    <strong>
                                      {c.suspended ? "Paused" : states[c.state]}
                                    </strong>
                                    <span>
                                      {c.state
                                        ? new Date(c.due).toLocaleDateString()
                                        : "Not studied"}
                                    </span>
                                  </div>
                                ))}
                            </div>
                            <div className="detail-actions">
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  pausePlace(
                                    selected,
                                    !cards
                                      .filter((c) => c.place_id === selected.id)
                                      .every((c) => c.suspended),
                                  )
                                }
                              >
                                {cards
                                  .filter((c) => c.place_id === selected.id)
                                  .every((c) => c.suspended) ? (
                                  <>
                                    <Play size={14} />
                                    Resume
                                  </>
                                ) : (
                                  <>
                                    <Pause size={14} />
                                    Pause
                                  </>
                                )}
                              </button>
                            </div>
                            <p className="small-note">
                              {selected.approximate
                                ? "Approximate location · self-graded"
                                : selected.source}
                            </p>
                          </>
                        ) : (
                          <p>Select a place to view its map and cards.</p>
                        )}
                      </div>
                    </>
                  )}
                </section>
              </div>
            </main>
          )}
          {tab === "settings" && settings && (
            <main className="settings-page">
              <div className="page-heading">
                <div>
                  <h1>Settings</h1>
                  <span className="subtle">
                    Changes are saved automatically.
                  </span>
                </div>
              </div>
              <section className="settings-section">
                <h2>Study</h2>
                <label className="setting-row">
                  <span>
                    New cards per day<small>Due reviews are not limited.</small>
                  </span>
                  <input
                    aria-label="New cards per day"
                    type="number"
                    min="0"
                    max="500"
                    defaultValue={settings.newPerDay}
                    key={"new" + settings.newPerDay}
                    onBlur={(e) => {
                      if (Number(e.target.value) !== settings.newPerDay)
                        saveSettings({ newPerDay: Number(e.target.value) });
                    }}
                  />
                </label>
                <label className="setting-row">
                  <span>
                    Target retention
                    <small>Higher values mean more frequent reviews.</small>
                  </span>
                  <select
                    aria-label="Target retention"
                    value={settings.retention}
                    onChange={(e) =>
                      saveSettings({ retention: Number(e.target.value) })
                    }
                  >
                    {[0.8, 0.85, 0.9, 0.95, 0.97].map((n) => (
                      <option key={n} value={n}>
                        {Math.round(n * 100)}%
                      </option>
                    ))}
                  </select>
                </label>
                <div className="setting-row">
                  <span>Question directions</span>
                  <div className="checkbox-stack">
                    {[
                      ["locate", "Place → map"],
                      ["identify", "Map → place"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={settings.modes.includes(key)}
                          onChange={(e) =>
                            saveSettings({
                              modes: e.target.checked
                                ? [...settings.modes, key]
                                : settings.modes.filter(
                                    (m: string) => m !== key,
                                  ),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="setting-row">
                  <span>
                    Place types
                    <small>
                      Regions include continents and areas such as Scandinavia.
                    </small>
                  </span>
                  <div className="checkbox-stack">
                    {Object.entries(kindNames).map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={settings.kinds.includes(key)}
                          onChange={(e) =>
                            saveSettings({
                              kinds: e.target.checked
                                ? [...settings.kinds, key]
                                : settings.kinds.filter(
                                    (m: string) => m !== key,
                                  ),
                            })
                          }
                        />
                        {String(label)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="setting-row">
                  <span>
                    Parts of the world
                    <small>Leave empty to study the whole world.</small>
                  </span>
                  <div className="checkbox-stack">
                    {[...new Set(places.map((p) => p.region))]
                      .sort()
                      .map((region) => (
                        <label key={region}>
                          <input
                            type="checkbox"
                            checked={settings.regions.includes(region)}
                            onChange={(e) =>
                              saveSettings({
                                regions: e.target.checked
                                  ? [...settings.regions, region]
                                  : settings.regions.filter(
                                      (r: string) => r !== region,
                                    ),
                              })
                            }
                          />
                          {region}
                        </label>
                      ))}
                  </div>
                </div>
                <label className="setting-row">
                  <span>
                    Separate reverse cards
                    <small>
                      Wait until another day before showing the other direction.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.burySiblings}
                    onChange={(e) =>
                      saveSettings({ burySiblings: e.target.checked })
                    }
                  />
                </label>
              </section>
              <section className="settings-section">
                <h2>Progress</h2>
                <button
                  className="text-button"
                  onClick={() => setTab("statistics")}
                >
                  View statistics
                </button>
                <div className="progress-stats">
                  <div>
                    <strong>{stats.reviews}</strong>
                    <span>Total reviews</span>
                  </div>
                  <div>
                    <strong>{stats.learned}</strong>
                    <span>Review cards</span>
                  </div>
                  <div>
                    <strong>{stats.learning}</strong>
                    <span>Learning cards</span>
                  </div>
                </div>
                {stats.history.length > 0 && (
                  <div className="history-table">
                    <div>
                      <strong>Date</strong>
                      <strong>Reviews</strong>
                      <strong>Recalled</strong>
                    </div>
                    {stats.history.slice(0, 14).map((day: any) => (
                      <div key={day.day}>
                        <span>{day.day}</span>
                        <span>{day.count}</span>
                        <span>
                          {Math.round((day.recalled / day.count) * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="settings-section">
                <h2>Data</h2>
                <p>
                  Your collection and progress are saved in a SQLite database on
                  this computer. A database backup is made at the first launch
                  each day and before a restore.
                </p>
                <div className="detail-actions">
                  <a className="secondary" href="/api/backup" download>
                    <Download size={16} />
                    Export backup
                  </a>
                  <button
                    className="secondary"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload size={16} />
                    Restore backup
                  </button>
                  <input
                    ref={fileInput}
                    className="sr-only"
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        run(async () => {
                          const b = JSON.parse(await f.text());
                          if (
                            b.format !== "migs-geo" ||
                            ![1, 2].includes(b.version) ||
                            !Array.isArray(b.places) ||
                            !Array.isArray(b.cards)
                          )
                            throw Error("Choose a Migs Geo backup file.");
                          setPendingBackup(b);
                        });
                      e.target.value = "";
                    }}
                  />
                </div>
                {pendingBackup && (
                  <div className="restore-confirm">
                    <p>
                      Restore {pendingBackup.places.length} places and{" "}
                      {pendingBackup.cards.length} cards from{" "}
                      {new Date(pendingBackup.exportedAt).toLocaleString()}?
                      This replaces the current collection and progress. A
                      backup of the current database will be kept.
                    </p>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api("/restore", "POST", pendingBackup);
                          setPendingBackup(null);
                          setQuestion(null);
                          setSelected(null);
                          await refresh();
                          setNotice("Backup restored.");
                        })
                      }
                    >
                      Restore this backup
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setPendingBackup(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </section>
              <section className="settings-section">
                <h2>API access</h2>
                <p>
                  All app features are available through the local JSON API. No
                  Anki connection is needed.
                </p>
                <code>http://127.0.0.1:4387/api</code>
                <a
                  className="text-button"
                  href="/api/docs"
                  target="_blank"
                  rel="noreferrer"
                >
                  API reference <ExternalLink size={13} />
                </a>
              </section>
              <section className="settings-section about">
                <h2>Sources</h2>
                <p>
                  Place names and notes:{" "}
                  <a
                    href="https://github.com/anki-geo/ultimate-geography"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ultimate Geography
                  </a>
                  . Map shapes:{" "}
                  <a
                    href="https://www.naturalearthdata.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Natural Earth
                  </a>
                  . Scheduling:{" "}
                  <a
                    href="https://github.com/open-spaced-repetition/ts-fsrs"
                    target="_blank"
                    rel="noreferrer"
                  >
                    FSRS-6
                  </a>
                  .
                </p>
                <p>
                  Natural Earth is a generalized atlas. Disputed boundaries
                  follow its conventions. Celtic Sea, Bering Strait, Balkan
                  Peninsula, and Oceania use approximate study markers. Flags
                  and capitals are not included.
                </p>
              </section>
            </main>
          )}
        </>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
