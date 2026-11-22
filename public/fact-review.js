
const search = document.querySelector("#search");
const scope = document.querySelector("#scope");
const summary = document.querySelector("#summary");
let places = [];
const articles = new Map();
const normalize = value => value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
const saving = new Set();
let editVersion=0;
function el(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}
function state(p) {
  if (p.newSuggestions) return "revised";
  if (p.hold) return "hold";
  const option = p.options.find(o => o.id === p.choice);
  if (!option) return p.options.length ? "undecided" : "missing";
  return option.text === p.current?.text && option.source === p.current?.source ? "published" : "ready";
}
const labels = {revised:"New suggestions",missing:"Awaiting research",hold:"Needs follow-up",undecided:"Undecided",published:"On card",ready:"Ready to publish"};
function drawSection(list, rows) {
  const cards = rows.map(p => {
    if (!articles.has(p.id)) articles.set(p.id, render(p));
    const {article, badge} = articles.get(p.id);
    badge.textContent = labels[state(p)];
    return article;
  });

  // Leave existing inputs attached so background refreshes preserve focus and selection.
  const wanted = new Set(cards);
  for (const child of Array.from(list.children)) {
    if (!wanted.has(child)) child.remove();
  }
  cards.forEach((card, i) => {
    if (list.children[i] !== card) list.insertBefore(card, list.children[i] ?? null);
  });
}
const pending = document.querySelector("#pending");
const chosen = document.querySelector("#chosen");
const research = document.querySelector("#research");
const researchDetails=document.querySelector("details");
researchDetails.ontoggle=()=>refresh();
function refresh() {
  const term=normalize(search.value.trim()), remaining=[], selected=[], missing=[];
  let waiting = 0;
  for (const p of places) {
    if (!normalize(p.name).includes(term)) continue;
    if (p.awaitingSuggestions && !p.finishingComment) {
      if (scope.value === "all" || p.studying) waiting++;
      continue;
    }
    if (p.options.some(o=>o.id===p.savedChoice)) selected.push(p);
    else if (scope.value==="all" || p.studying) (p.options.length ? remaining : missing).push(p);
  }
  drawSection(pending, remaining);
  researchDetails.hidden=!missing.length;
  document.querySelector("#research-heading").textContent=`Awaiting research (${missing.length})`;
  drawSection(research, researchDetails.open ? missing : []);
  drawSection(chosen, selected);
  const revisions = waiting ? ` · ${waiting} awaiting new suggestions` : "";
  summary.textContent=`${remaining.length} to choose · ${missing.length} awaiting research${revisions} · ${selected.length} already chosen`;
}
function showSavedChoice(p, article) {
  const wasChosen = p.options.some(o => o.id === p.savedChoice);
  const nowChosen = p.options.some(o => o.id === p.choice);
  const bounds = article.getBoundingClientRect();
  const movingInView = (wasChosen !== nowChosen || (p.awaitingSuggestions && !p.finishingComment)) && article.isConnected &&
    bounds.bottom > 0 && bounds.top < window.innerHeight;
  const next = article.nextElementSibling ?? (article.parentElement === pending
    ? (researchDetails.hidden ? chosen.closest("section").querySelector("h2") : researchDetails.querySelector("summary"))
    : null);
  const restoreFocus = article.contains(document.activeElement);
  const scrollY = window.scrollY;

  p.savedChoice = p.choice;
  refresh();
  if (!movingInView) return;
  if (next?.isConnected) {
    const heading = next.querySelector("h2") ?? next;
    if (restoreFocus) {
      heading.tabIndex = -1;
      heading.focus({preventScroll:true});
    }
    window.scrollBy(0, next.getBoundingClientRect().top - Math.max(0, bounds.top));
  } else {
    window.scrollTo(0, scrollY);
  }
}
function render(p) {
  const article=el("article"), heading=el("header"), badge=el("small"), status=el("small");
  heading.append(el("h2",p.name),badge); article.append(heading);
  const inputs=[];
  for (const [i,o] of p.options.entries()) {
    const line=el("div"), radio=el("input"), label=el("label"), source=el("a","Source");
    line.className="option"; radio.type="radio"; radio.name=p.id; radio.id=p.id+"-"+o.id;
    radio.checked=p.choice===o.id; label.htmlFor=radio.id; label.textContent=String.fromCharCode(65+i)+". "+o.text;
    source.href=o.source;source.target="_blank";source.rel="noreferrer";line.append(radio,label,source);article.append(line);
    radio.addEventListener("change",()=>{p.choice=o.id;changed()});inputs.push(radio);
  }
  const note=el("label","Comment for Claude"), comment=el("textarea");
  note.className="note";comment.rows=2;comment.maxLength=8000;comment.value=p.comment;note.append(comment);
  const hold=el("label"), check=el("input");hold.className="hold";check.type="checkbox";check.checked=p.hold;
  hold.append(check," Hold for edits or more options");
  const actions=el("div"),clear=el("button","Clear selection"),retry=el("button","Retry save");
  actions.className="actions";retry.hidden=true;status.setAttribute("role","status");actions.append(clear,status,retry);
  clear.onclick=()=>{p.choice=null;inputs.forEach(r=>r.checked=false);changed()};
  comment.oninput=()=>{p.comment=comment.value;changed()};
  comment.onblur=()=>{
    if (!p.finishingComment) return;
    p.finishingComment=false;
    showSavedChoice(p, article);
  };
  check.onchange=()=>{p.hold=check.checked;changed()};
  article.append(note,hold,actions);clear.hidden=!p.options.length;
  let dirty=false, busy=false;
  function changed(){editVersion++;dirty=true;saving.add(p.id);status.textContent="Saving…";void save()}
  async function save(){
    if(busy)return;
    busy=true;retry.hidden=true;
    try{
      while(dirty){
        dirty=false;
        const response=await fetch("/api/fact-review/"+p.id,{method:"PUT",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({choice:p.choice,comment:p.comment,hold:p.hold,revision:p.revision,seenOptions:p.options.map(o=>o.id)})});
        const data=await response.json();if(!response.ok)throw Error(data.error||"Save failed");
        p.revision=data.revision;
        if (!dirty) {
          p.awaitingSuggestions=Boolean(data.awaitingSuggestions);
          p.newSuggestions=Boolean(data.newSuggestions);
          p.hold=check.checked=data.hold;
          p.finishingComment=p.awaitingSuggestions && document.activeElement===comment;
        }
      }
      saving.delete(p.id);status.textContent="Saved";showSavedChoice(p, article);
    }catch(e){dirty=true;status.textContent=e.message;retry.hidden=false}finally{busy=false}
  }
  retry.onclick=save;
  return {article,badge};
}
window.addEventListener("beforeunload",e=>{if(saving.size){e.preventDefault();e.returnValue=""}});
search.oninput = scope.onchange = refresh;
let loading=false;
async function loadPlaces(){
  if(loading || saving.size)return;
  loading=true;
  const version=editVersion;
  try {
    const response=await fetch("/api/fact-review",{cache:"no-store"});
    if(!response.ok)throw Error("Could not load the review.");
    const incoming=await response.json();
    if(saving.size || version!==editVersion)return;
    const previous=new Map(places.map(p=>[p.id,p]));
    places=incoming.map(row=>{
      const old=previous.get(row.id);
      if(old && old.revision===row.revision && old.name===row.name &&
          old.options.length===row.options.length && old.options.every((o,i)=>o.id===row.options[i].id)) {
        old.studying=row.studying;
        return old;
      }
      articles.delete(row.id);
      return {...row,savedChoice:row.choice};
    }).sort((a,b)=>a.name.localeCompare(b.name));
    refresh();
  } catch(e){summary.textContent=e.message} finally{loading=false}
}
window.addEventListener("focus",loadPlaces);
setInterval(()=>{if(!document.hidden)void loadPlaces()},60000);
await loadPlaces();
