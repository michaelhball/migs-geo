import cities from "./city-populations.json" with {type:"json"};

const millions = new Intl.NumberFormat("en", {maximumSignificantDigits:2, notation:"compact", compactDisplay:"long"});
const rounded = new Intl.NumberFormat("en", {maximumSignificantDigits:2});
const format = people => people >= 1e6 ? millions.format(people) : rounded.format(people);
const scales = {k:1000, thousand:1000, m:1e6, million:1e6};
export const populationPlaces = cities.map(({id, name, country, people, year, area, source}) => ({
  id, name, kind:"population", region:country, population:{people, year, area},
  source, center:null, geometry:null, approximate:false, small:false, archived:false,
  tags:[], aliases:[], info:"",
}));

export function validatePopulation(p) {
  const v = p.population;
  if (!v || !Number.isSafeInteger(v.people) || v.people < 1 || !Number.isInteger(v.year) ||
      v.year < 1 || v.year > 9999 || typeof v.area !== "string" || !v.area.trim() ||
      typeof p.region !== "string" || !p.region.trim() || typeof p.source !== "string" || !URL.canParse(p.source) ||
      new URL(p.source).protocol !== "https:") throw Error("Provide a population, reference year, area, country, and HTTPS source.");
}

export function checkPopulation(p, answer) {
  // Accept grouped whole numbers and decimal quantities such as “1.8 million”.
  const match = typeof answer?.text === "string" &&
    /^(\d{1,3}(?:,\d{3})+|\d{1,3}(?: \d{3})+|\d+)(\.\d+)?\s*(k|m|thousand|million)?$/i.exec(answer.text.trim());
  if (!match) throw Error("Enter a population such as 420,000, 420k, or 0.42 million.");
  const people = Number(match[1].replace(/[, ]/g,"") + (match[2] ?? "")) * (scales[match[3]?.toLowerCase()] ?? 1);
  if (!Number.isFinite(people) || people > Number.MAX_SAFE_INTEGER) throw Error("Enter a smaller number.");
  const target = p.population.people;
  return {correct:Math.abs(people - target) <= target * 0.25, estimate:people, target,
    message:"Estimates within 25% count as correct."};
}

export function populationFeedback(place, places) {
  const {people, year, area} = place.population;
  const label = format(people);
  // Prefer a same-country reference, then a familiar benchmark. Only use a simple
  // ratio when it describes the two source estimates to within ten percent.
  const anchors = ["Auckland","Christchurch","Wellington","Tokyo","Paris","London","Vatican City"];
  let best;
  for (const other of places) {
    if (other.kind !== "population" || other.archived || other.id === place.id) continue;
    const local = other.region === place.region && other.population.area === area && other.population.year === year;
    if (!local && !anchors.includes(other.name)) continue;
    const ratio = people / other.population.people;
    for (const [factor, phrase] of [[2,"twice"],[0.5,"half"],[4,"four times"],[0.25,"a quarter of"],[3,"three times"],[10,"ten times"],[1,"about the same as"]]) {
      const difference = Math.abs(Math.log(ratio / factor));
      if (difference > Math.log(1.1)) continue;
      const score = difference + (local ? 0 : 1) + (factor === 1 ? 0.05 : 0);
      if (!best || score < best.score) best = {score, other, phrase};
    }
  }
  let cue;
  if (best) {
    const {other,phrase} = best;
    const comparison = phrase.startsWith("about") ? phrase : "roughly " + phrase;
    cue = `That’s ${comparison} the population of ${other.name} (${format(other.population.people)}).`;
  } else {
    const venue = people >= 50000 ? {size:50000, name:"50,000-seat stadium"}
      : people >= 2000 ? {size:1000, name:"1,000-seat theatre"} : {size:50, name:"50-seat bus"};
    const count = Math.max(1, Math.round(people/venue.size));
    const plural = venue.size === 50 ? "es" : "s";
    cue = `Picture about ${count} full ${venue.name}${count === 1 ? "" : plural}.`;
  }
  return {label, people, year, area, country:place.region, source:place.source, cue};
}
