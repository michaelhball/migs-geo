import { createHash } from "node:crypto";
import catalog from "./fact-candidates.json" with { type:"json" };
import approved from "../data/approved-facts.json" with { type:"json" };

const options = new Map(catalog.map(p => [p.id, p.options.map(o => ({
  ...o, id: createHash("sha256").update(JSON.stringify([o.text,o.source])).digest("hex").slice(0,24),
}))]));
const prefix = "fact-review/";
const empty = { revision:0, choice:null, comment:"", hold:false, published:null };

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
    const decisions = new Map(backup().map(row => [row.id, row]));
    const directory = new Map(catalog.map(p => [p.id, p.name]));
    for (const p of places()) directory.set(p.id, p.name);
    return Array.from(directory, ([id, name]) => {
      const candidates = options.get(id) ?? [];
      const row = decisions.get(id) ?? {
        ...empty, choice: candidates.find(o => o.text === approved[id]?.text)?.id ?? null,
      };
      return {id, name, options:candidates, ...row, current:row.published ?? approved[id] ?? null};
    });
  }
  const backup = () => db.prepare("SELECT key,value FROM meta WHERE key LIKE 'fact-review/%'").all()
    .map(r => ({id:r.key.slice(prefix.length), ...JSON.parse(r.value)}));
  function validate(row) {
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
        !(row.choice === null || typeof row.choice === "string") ||
        typeof row.comment !== "string" || row.comment.length > 8000 || typeof row.hold !== "boolean" ||
        !(row.published === null || (typeof row.published?.text === "string" &&
          /^https:\/\//.test(row.published.source)))) throw Error("Invalid fact decision.");
  }
  return {list, current, backup,
    save(id,input) {
      return tx(() => {
        if (!options.has(id) && !places().some(p => p.id === id)) throw Error("Unknown fact review place.");
        const old = read(id);
        if (input.revision !== old.revision) throw Object.assign(Error("This decision changed in another tab. Reload before editing."),{status:409});
        if (input.choice !== null && !options.get(id)?.some(o=>o.id===input.choice)) throw Error("Unknown candidate.");
        const row={revision:old.revision+1, choice:input.choice, comment:input.comment, hold:input.hold, published:old.published};
        validate(row);write(id,row);return row;
      });
    },
    publish() {
      return tx(() => {
        const applied=[];
        for (const item of list()) {
          const selected=item.options.find(o=>o.id===item.choice);
          if (item.hold || !selected || (selected.text===item.current?.text && selected.source===item.current?.source)) continue;
          write(item.id,{...read(item.id),revision:item.revision+1,published:{text:selected.text,source:selected.source}});
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
        seen.add(id); validate(row);write(id,row);
      }
    },
  };
}
