import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import "./statistics.css";

type Metrics = {
  reviews: number;
  introduced: number;
  firstAssessed: number;
  firstCorrect: number;
  firstAccuracy: number | null;
  ratedRecall: number | null;
  again: number;
  medianResponseMs: number | null;
  unknownFirst: number;
  selfGraded: number;
};
type Group = Metrics & { id: string; label?: string };
type Card = Metrics & {
  id: string;
  placeId: string;
  name: string;
  mode: string;
};
type Review = {
  id: string;
  at: string;
  rating: number;
  stage: string;
  intervalSeconds: number | null;
  responseMs: number | null;
  first: { correct: boolean | null; revealed: boolean } | null;
  answer: { text?: string; point?: [number, number]; reveal?: boolean } | null;
};
type Report = {
  today: string;
  summary: Metrics;
  intervals: Group[];
  daily: Group[];
  cards: Card[];
  byMode: Group[];
  byKind: Group[];
  byRegion: Group[];
  byTag: Group[];
  byStage: Group[];
  confusions: { cardId: string; name: string; answer: string; count: number }[];
};
const names: Record<string, string> = {
  locate: "Place → map",
  identify: "Map → place",
  country: "Countries",
  territory: "Territories / islands",
  water: "Bodies of water",
  region: "Regions / continents",
  new: "New",
  learning: "Learning",
  review: "Review",
  relearning: "Relearning",
};
const percent = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);
const time = (ms: number | null) =>
  ms === null
    ? "—"
    : ms < 60000
      ? `${(ms / 1000).toFixed(1)} s`
      : `${(ms / 60000).toFixed(1)} min`;
const elapsed = (seconds: number | null, stage: string) =>
  stage === "new"
    ? "New card"
    : seconds === null
      ? "—"
      : seconds < 60
        ? `${Math.round(seconds)} s`
        : seconds < 3600
          ? `${(seconds / 60).toFixed(1)} min`
          : seconds < 86400
            ? `${(seconds / 3600).toFixed(1)} hr`
            : `${(seconds / 86400).toFixed(1)} days`;
function FirstTry({ row }: { row: Metrics }) {
  return (
    <span className="analytics-rate">
      <strong>{percent(row.firstAccuracy)}</strong>
      <small>
        {row.firstCorrect} / {row.firstAssessed} measured
      </small>
    </span>
  );
}
function DailyChart({ rows }: { rows: Group[] }) {
  if (!rows.length) return <p>No reviews in this period.</p>;
  const start = +new Date(rows[0].id),
    end = +new Date(rows.at(-1)!.id),
    day = 86400000;
  const max = Math.max(1, ...rows.map((r) => r.reviews)),
    width = 760,
    height = 150;
  const barWidth = Math.min(30, (700 / ((end - start) / day + 1)) * 0.7);
  return (
    <>
      <svg
        className="analytics-chart"
        viewBox={`0 0 ${width} 190`}
        role="img"
        aria-label="Daily review counts: dark green is new cards, light green is repeats"
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="36"
              x2="744"
              y1={height - f * 130}
              y2={height - f * 130}
              stroke="#e3e8e0"
            />
            <text x="29" y={height - f * 130 + 4} textAnchor="end">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {rows.map((r) => {
          const x =
            36 +
            ((+new Date(r.id) - start + day / 2) / (end - start + day)) * 708;
          const totalHeight = (r.reviews / max) * 130,
            newHeight = (r.introduced / max) * 130;
          return (
            <g key={r.id}>
              <title>
                {r.id}: {r.reviews} reviews, {r.introduced} new cards
              </title>
              <rect
                x={x - barWidth / 2}
                y={height - totalHeight}
                width={barWidth}
                height={totalHeight}
                fill="#b6cbbb"
                rx="2"
              />
              <rect
                x={x - barWidth / 2}
                y={height - newHeight}
                width={barWidth}
                height={newHeight}
                fill="#38674f"
                rx="2"
              />
            </g>
          );
        })}
        {rows.length === 1 ? (
          <text x="390" y="178" textAnchor="middle">
            {rows[0].id}
          </text>
        ) : (
          <>
            <text x="36" y="178">
              {rows[0].id}
            </text>
            <text x="744" y="178" textAnchor="end">
              {rows.at(-1)!.id}
            </text>
          </>
        )}
      </svg>
      <div className="analytics-chart-key">
        <span>
          <i />
          New cards
        </span>
        <span>
          <i />
          Repeats
        </span>
      </div>
      <details className="analytics-daily-table">
        <summary>Daily counts</summary>
        <div className="analytics-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reviews</th>
                <th>New</th>
                <th>First try</th>
                <th>Rated recall</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .reverse()
                .map((r) => (
                  <tr key={r.id}>
                    <th>{r.id}</th>
                    <td>{r.reviews}</td>
                    <td>{r.introduced}</td>
                    <td>
                      <FirstTry row={r} />
                    </td>
                    <td>{percent(r.ratedRecall)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export function Statistics({
  api,
  studyDay,
  onBack,
  onOpenPlace,
}: {
  api: (route: string) => Promise<any>;
  studyDay: string;
  onBack: () => void;
  onOpenPlace: (id: string) => void;
}) {
  const [data, setData] = useState<Report | null>(null),
    [range, setRange] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0),
    [grouping, setGrouping] = useState<
      "byMode" | "byKind" | "byRegion" | "byTag" | "byStage"
    >("byMode");
  const [search, setSearch] = useState(""),
    [showAll, setShowAll] = useState(false),
    [selected, setSelected] = useState<Card | null>(null);
  const [history, setHistory] = useState<Review[] | null>(null),
    [logError, setLogError] = useState("");
  const query = useMemo(() => {
    if (!range) return "";
    const date = new Date(studyDay);
    date.setUTCDate(date.getUTCDate() - range + 1);
    return `?from=${date.toISOString().slice(0, 10)}&to=${studyDay}`;
  }, [range, studyDay]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api(`/analytics${query}`)
      .then((report) => {
        if (current) setData(report);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, query, reload, studyDay]);
  useEffect(() => {
    let current = true;
    setHistory(null);
    setLogError("");
    if (selected)
      api(`/analytics?cardId=${encodeURIComponent(selected.id)}`)
        .then((result) => {
          if (current) setHistory(result.history.reverse());
        })
        .catch((e) => {
          if (current) setLogError(e.message);
        });
    return () => {
      current = false;
    };
  }, [api, selected]);
  const filtered = (data?.cards || []).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const cards = showAll ? filtered : filtered.slice(0, 10);
  return (
    <main className="analytics-page" aria-busy={loading}>
      <div className="analytics-back">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to study
        </button>
      </div>
      <div className="page-heading">
        <div>
          <h1>Statistics</h1>
          <span className="subtle">Saved study progress</span>
        </div>
        <div className="analytics-controls">
          <label>
            <span className="sr-only">Statistics period</span>
            <select
              value={range}
              onChange={(e) => {
                setRange(Number(e.target.value));
                setSelected(null);
              }}
            >
              <option value={0}>All time</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
          <a
            className="secondary"
            href={`/api/analytics${query}`}
            download="migs-geo-statistics.json"
          >
            <Download size={15} />
            Export statistics
          </a>
        </div>
      </div>
      {error && (
        <div className="analytics-error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setReload((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      )}
      {!data ? (
        <p>{loading ? "Loading statistics…" : "Statistics are unavailable."}</p>
      ) : (
        <>
          <div className="analytics-totals">
            <div>
              <span>Reviews</span>
              <strong>{data.summary.reviews}</strong>
              <small>{data.summary.introduced} new cards introduced</small>
            </div>
            <div>
              <span>First-try recall</span>
              <strong>{percent(data.summary.firstAccuracy)}</strong>
              <small>
                {data.summary.firstCorrect} / {data.summary.firstAssessed}{" "}
                measured
              </small>
            </div>
            <div>
              <span>Rated recall</span>
              <strong>{percent(data.summary.ratedRecall)}</strong>
              <small>{data.summary.again} Again ratings</small>
            </div>
            <div>
              <span>Median answer time</span>
              <strong>{time(data.summary.medianResponseMs)}</strong>
              <small>First check, including pauses</small>
            </div>
          </div>
          {data.summary.unknownFirst > 0 && (
            <p className="analytics-coverage">
              {data.summary.unknownFirst} earlier reviews have no first-answer
              log. Their ratings and intervals are included; first-try
              measurements start with newly logged reviews.
            </p>
          )}
          <div className="analytics-two-column">
            <section className="analytics-section">
              <h2>Recall after an interval</h2>
              <p>
                Return attempts, grouped by actual time since the previous
                review. New cards are separate.
              </p>
              <div className="analytics-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Interval</th>
                      <th>Returns</th>
                      <th>First try</th>
                      <th>Rated recall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.intervals.map((r) => (
                      <tr key={r.id}>
                        <th>{r.label}</th>
                        <td>{r.reviews}</td>
                        <td>
                          <FirstTry row={r} />
                          <div className="analytics-meter">
                            <i style={{ width: `${r.firstAccuracy ?? 0}%` }} />
                          </div>
                        </td>
                        <td>{percent(r.ratedRecall)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="analytics-section">
              <h2>Reviews by day</h2>
              <p>New cards and repeat attempts.</p>
              <DailyChart rows={data.daily} />
            </section>
          </div>
          <section className="analytics-section">
            <div className="analytics-section-heading">
              <h2>Patterns</h2>
              <label>
                <span className="sr-only">Group statistics by</span>
                <select
                  value={grouping}
                  onChange={(e) =>
                    setGrouping(e.target.value as typeof grouping)
                  }
                >
                  <option value="byMode">Question direction</option>
                  <option value="byKind">Place type</option>
                  <option value="byRegion">Part of the world</option>
                  <option value="byStage">Learning stage</option>
                  <option value="byTag">Tag</option>
                </select>
              </label>
            </div>
            {grouping === "byTag" && <p>A card can have more than one tag.</p>}
            <div className="analytics-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Reviews</th>
                    <th>First try</th>
                    <th>Rated recall</th>
                    <th>Median answer time</th>
                  </tr>
                </thead>
                <tbody>
                  {data[grouping].map((r) => (
                    <tr key={r.id}>
                      <th>{names[r.id] || r.id}</th>
                      <td>{r.reviews}</td>
                      <td>
                        <FirstTry row={r} />
                      </td>
                      <td>{percent(r.ratedRecall)}</td>
                      <td>{time(r.medianResponseMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data[grouping].length && <p>No reviews in this period.</p>}
          </section>
          <section className="analytics-section">
            <div className="analytics-section-heading">
              <div>
                <h2>Cards</h2>
                <p>
                  Most Again ratings first. Select a card to see its answer
                  history.
                </p>
              </div>
              <input
                aria-label="Find a card in statistics"
                placeholder="Find a card…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="analytics-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Place</th>
                    <th>Direction</th>
                    <th>Reviews</th>
                    <th>First try</th>
                    <th>Again</th>
                    <th>Rated recall</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => (
                    <tr
                      key={c.id}
                      className={
                        selected?.id === c.id ? "analytics-selected" : ""
                      }
                    >
                      <th>
                        <button
                          className="analytics-card-link"
                          onClick={() => setSelected(c)}
                        >
                          {c.name}
                        </button>
                      </th>
                      <td>{names[c.mode]}</td>
                      <td>{c.reviews}</td>
                      <td>
                        <FirstTry row={c} />
                      </td>
                      <td>{c.again}</td>
                      <td>{percent(c.ratedRecall)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && <p>No matching reviewed cards.</p>}
            {filtered.length > 10 && (
              <button
                className="text-button"
                onClick={() => setShowAll(!showAll)}
              >
                {showAll
                  ? "Show fewer cards"
                  : `Show all ${filtered.length} cards`}
              </button>
            )}
            {selected && (
              <div className="analytics-answer-history">
                <div className="analytics-section-heading">
                  <h3>
                    {selected.name} · {names[selected.mode]}
                  </h3>
                  <button
                    className="text-button"
                    onClick={() => onOpenPlace(selected.placeId)}
                  >
                    View place
                  </button>
                </div>
                <p>
                  Review history across all dates. First answers were not
                  recorded for older reviews.
                </p>
                {logError ? (
                  <p role="alert">{logError}</p>
                ) : !history ? (
                  <p>Loading answers…</p>
                ) : !history.length ? (
                  <p>No reviews recorded.</p>
                ) : (
                  <>
                    <div className="analytics-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Reviewed</th>
                            <th>Since previous review</th>
                            <th>First answer</th>
                            <th>Result</th>
                            <th>Rating</th>
                            <th>Answer time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.slice(0, 50).map((a) => {
                            const outcome = !a.first
                              ? "Not recorded"
                              : a.first.revealed
                                ? "Revealed"
                                : a.first.correct === true
                                  ? "Correct"
                                  : a.first.correct === false
                                    ? "Incorrect"
                                    : "Self-graded";
                            const answer = !a.answer
                              ? "—"
                              : a.answer.reveal
                                ? "Answer revealed"
                                : (a.answer.text ??
                                  (a.answer.point
                                    ? `Map: ${a.answer.point[1].toFixed(2)}°, ${a.answer.point[0].toFixed(2)}°`
                                    : "—"));
                            return (
                              <tr key={a.id}>
                                <td>
                                  {new Date(a.at).toLocaleString()}
                                </td>
                                <td>{elapsed(a.intervalSeconds, a.stage)}</td>
                                <td className="analytics-raw-answer">
                                  {answer}
                                </td>
                                <td>{outcome}</td>
                                <td>
                                  {["", "Again", "Hard", "Good", "Easy"][a.rating]}
                                </td>
                                <td>{time(a.responseMs)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {history.length > 50 && (
                      <p>
                        Showing the latest 50 of {history.length} reviews. The
                        full history is available through the API.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
          {!!data.confusions.length && (
            <section className="analytics-section">
              <h2>Wrong names entered</h2>
              <p>First answers only; reveals are excluded.</p>
              <div className="analytics-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Place asked</th>
                      <th>Name entered</th>
                      <th>Times</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.confusions.slice(0, 12).map((c) => (
                      <tr key={`${c.cardId}:${c.answer}`}>
                        <th>{c.name}</th>
                        <td>{c.answer}</td>
                        <td>{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="analytics-definitions">
            First-try recall counts a correct first check; revealing the answer
            counts as a miss. Self-graded locations are excluded from that
            percentage. Rated recall counts Hard, Good, and Easy. Undone reviews
            and unscheduled practice are excluded from totals.
          </p>
        </>
      )}
    </main>
  );
}
