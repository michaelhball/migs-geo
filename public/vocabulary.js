const search = document.querySelector("#search");
const terms = document.querySelector("#terms");
const summary = document.querySelector("#summary");
try {
  const response = await fetch("/api/vocabulary");
  if (!response.ok) throw Error("Could not load vocabulary.");
  const entries = await response.json();
  function render() {
    const query = search.value.trim().toLowerCase();
    const groups = new Map();
    const matches = entries.filter(e => [e.term, e.definition, ...e.aliases].some(s => s.toLowerCase().includes(query)));
    for (const entry of matches.sort((a,b) => a.term.localeCompare(b.term))) {
      if (!groups.has(entry.group)) groups.set(entry.group, []);
      groups.get(entry.group).push(entry);
    }
    terms.replaceChildren();
    for (const [group, words] of [...groups].sort(([a],[b]) => a.localeCompare(b))) {
      const section = document.createElement("section");
      const heading = document.createElement("h2");
      heading.textContent = group;
      const list = document.createElement("dl");
      for (const {term, definition} of words) {
        const word = document.createElement("dt");
        const meaning = document.createElement("dd");
        word.textContent = term;
        meaning.textContent = definition;
        list.append(word, meaning);
      }
      section.append(heading, list);
      terms.append(section);
    }
    summary.textContent = matches.length + (matches.length === 1 ? " word" : " words");
  }
  search.oninput = render;
  render();
} catch {
  summary.textContent = "Could not load vocabulary. Refresh to try again.";
}
