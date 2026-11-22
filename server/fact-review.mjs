import { createHash } from "node:crypto";
import {readFileSync, statSync} from "node:fs";
import approved from "../data/approved-facts.json" with { type:"json" };

const catalogFile = new URL("./fact-candidates.json", import.meta.url);
let modified, catalog, options;
function refreshCatalog() {
  const mtime = statSync(catalogFile).mtimeMs;
  if (mtime === modified) return;
  const next = JSON.parse(readFileSync(catalogFile, "utf8"));
  const indexed = new Map(next.map(p => [p.id, p.options.map(o => ({
    ...o, id: createHash("sha256").update(JSON.stringify([o.text,o.source])).digest("hex").slice(0,24),
  }))]));
  catalog = next;
  options = indexed;
  modified = mtime;
}
refreshCatalog();
const prefix = "fact-review/";
const empty = { revision:0, choice:null, comment:"", hold:false, published:null };

function asksForOptions(comment) {
  return /\b(?:try again|(?:new|more|different|other|fresh|replacement) (?:fact(?:s)?|options?|suggestions?|choices?))\b/i.test(comment);
}

function researchState(row, candidates) {
  if (!row.requestedOptions) return {};
  const newSuggestions = candidates.length >= 3 && candidates.every(o => !row.requestedOptions.includes(o.id));
  return {awaitingSuggestions:!newSuggestions, newSuggestions, hold:!newSuggestions};
}

export function factReview(db, tx, places) {
  const read = id => {
    const row = db.prepare("SELECT value FROM meta WHERE key=?").get(prefix + id);
    if (row) return JSON.parse(row.value);
    const choice = options.get(id)?.find(o => o.text === approved[id]?.text)?.id ?? null;
    return {...empty,choice};
  };
  const write = (id, row) => db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)")
    .run(prefix+id, JSON.stringify(row));
  const current = id => read(id).published ?? (Object.hasOwn(approved,id) ? approved[id] : null);
  function list() {
    refreshCatalog();
    const decisions = new Map(backup().map(row => [row.id, row]));
    const directory = new Map(catalog.map(p => [p.id, {name:p.name,studying:false}]));
    for (const p of places()) directory.set(p.id, p);
    return Array.from(directory, ([id, {name, studying}]) => {
      const candidates = options.get(id) ?? [];
      const row = decisions.get(id) ?? {
        ...empty, choice: candidates.find(o => o.text === approved[id]?.text)?.id ?? null,
      };
      return {id, name, studying, options:candidates, ...row, ...researchState(row, candidates), current:row.published ?? approved[id] ?? null};
    });
  }
  const backup = () => db.prepare("SELECT key,value FROM meta WHERE key LIKE 'fact-review/%'").all()
    .map(r => ({id:r.key.slice(prefix.length), ...JSON.parse(r.value)}));
  function validate(row) {
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
        !(row.choice === null || typeof row.choice === "string") ||
        (row.requestedOptions != null && (!Array.isArray(row.requestedOptions) || row.requestedOptions.length > 30 ||
          !row.requestedOptions.every(id => typeof id === "string" && /^[a-f0-9]{24}$/.test(id)))) ||
        (row.reviewedAlternative != null && !/^[a-f0-9]{24}$/.test(row.reviewedAlternative)) ||
        typeof row.comment !== "string" || row.comment.length > 8000 || typeof row.hold !== "boolean" ||
        !(row.published === null || (typeof row.published?.text === "string" &&
          /^https:\/\//.test(row.published.source)))) throw Error("Invalid fact decision.");
  }
  function migrateRequest(id, row) {
    if (row.requestedOptions === undefined && ((!row.choice && row.hold) || asksForOptions(row.comment))) {
      return {...row, requestedOptions:(options.get(id) ?? []).map(o => o.id)};
    }
    return row;
  }
  tx(() => {
    for (const {id, ...row} of backup()) {
      const migrated = migrateRequest(id, row);
      if (migrated !== row) write(id, migrated);
    }
  });
  return {list, current, backup,
    save(id,input) {
      refreshCatalog();
      return tx(() => {
        if (!options.has(id) && !places().some(p => p.id === id)) throw Error("Unknown fact review place.");
        const old = read(id);
        // Publishing changes the card's fact, but leaves the reviewer's draft intact.
        const onlyPublishedSince = old.publishedFromRevision === old.revision - 1 &&
          input.revision === old.publishedFromRevision;
        if (input.revision !== old.revision && !onlyPublishedSince) throw Object.assign(Error("This decision changed in another tab. Reload before editing."),{status:409});
        if (input.choice !== null && !options.get(id)?.some(o=>o.id===input.choice)) throw Error("Unknown candidate.");
        const candidates = options.get(id) ?? [];
        const offered = candidates[3];
        let reviewedAlternative = old.reviewedAlternative ?? null;
        if (input.reviewedAlternative != null) {
          if (input.reviewedAlternative !== offered?.id) throw Error("That alternative has changed. Reload before choosing.");
          reviewedAlternative = offered.id;
        }
        const previous = researchState(old, candidates);
        const startsRequest = input.requestNewOptions === true ||
          (input.hold && !(previous.hold ?? old.hold) && !input.choice) ||
          (asksForOptions(input.comment) && !asksForOptions(old.comment));
        let requestedOptions = old.requestedOptions ?? null;
        if (startsRequest) requestedOptions = input.seenOptions ?? candidates.map(o => o.id);
        else if (input.choice !== old.choice || (previous.awaitingSuggestions && !input.hold &&
          !asksForOptions(input.comment))) requestedOptions = null;
        const row={revision:old.revision+1, choice:input.choice, comment:input.comment, hold:input.hold,
          published:old.published, requestedOptions, reviewedAlternative};
        validate(row);write(id,row);return {...row, ...researchState(row, candidates)};
      });
    },
    publish() {
      return tx(() => {
        const applied=[];
        for (const item of list()) {
          const selected=item.options.find(o=>o.id===item.choice);
          if (item.hold || !selected || (selected.text===item.current?.text && selected.source===item.current?.source)) continue;
          write(item.id,{...read(item.id),revision:item.revision+1,publishedFromRevision:item.revision,
            published:{text:selected.text,source:selected.source}});
          applied.push(item.id);
        }
        return {applied};
      });
    },
    restore(rows) {
      if (!Array.isArray(rows)) throw Error("Invalid fact review backup.");
      db.exec("DELETE FROM meta WHERE key LIKE 'fact-review/%'");
      const seen=new Set();
      for(const {id,...row} of rows) {
        if(typeof id!=="string" || !/^[\w-]{1,100}$/.test(id) || seen.has(id)) throw Error("Invalid fact review place.");
        seen.add(id); validate(row);write(id,migrateRequest(id,row));
      }
    },
  };
}
