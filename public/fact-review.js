
const search = document.querySelector("#search");
const scope = document.querySelector("#scope");
const initialScope = new URLSearchParams(location.search).get("scope");
if (Array.from(scope.options).some(option => option.value === initialScope)) scope.value = initialScope;
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
    const {article, badge, showOffer} = articles.get(p.id);
    showOffer();
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
const alternatives = document.querySelector("#alternatives");
function hasOffer(p) {
  const option = p.options[3];
  return option && p.savedChoice && p.savedChoice !== option.id &&
    p.reviewedAlternative !== option.id && !p.hold && !p.newSuggestions;
}
const research = document.querySelector("#research");
const researchDetails=document.querySelector("details");
researchDetails.ontoggle=()=>refresh();
function heldForReview(p) {
  if (!p.hold || p.awaitingSuggestions) return false;
  const choice = p.options.find(o => o.id === p.savedChoice);
  return choice && (choice.text !== p.current?.text || choice.source !== p.current?.source);
}
function refresh() {
  const term=normalize(search.value.trim()), remaining=[], selected=[], missing=[], offers=[];
  const reviewingHolds = scope.value === "held";
  const held = places.filter(heldForReview);
  let waiting = 0;
  for (const p of reviewingHolds ? held : places) {
    if (!normalize(p.name).includes(term)) continue;
    // Bundled river IDs are assigned before the optional study pack is installed.
    if (scope.value === "rivers" && !p.id.startsWith("river-")) continue;
    const inScope = scope.value !== "studying" || p.studying;
    if (p.awaitingSuggestions && !p.finishingComment) {
      if (inScope) waiting++;
      continue;
    }
    if (p.options.some(o=>o.id===p.savedChoice)) (hasOffer(p) ? offers : selected).push(p);
    else if (inScope) (p.options.length ? remaining : missing).push(p);
  }
  drawSection(pending, remaining);
  pending.parentElement.hidden=reviewingHolds;
  researchDetails.hidden=!missing.length;
  document.querySelector("#research-heading").textContent=`Awaiting research (${missing.length})`;
  drawSection(research, researchDetails.open ? missing : []);
  alternatives.parentElement.hidden=!offers.length;
  drawSection(alternatives, offers);
  drawSection(chosen, selected);
  document.querySelector("#chosen-heading").textContent = reviewingHolds ? "Held choices to review" : "Already chosen";
  chosen.parentElement.hidden = reviewingHolds && !selected.length;
  if (reviewingHolds) {
    summary.textContent = selected.length
      ? `${selected.length} held ${selected.length === 1 ? "choice" : "choices"}. Uncheck “Hold for edits or more options” when a fact is ready to publish.`
      : term ? "No matching held choices." : "No held choices left to review.";
    return;
  }
  const revisions = waiting ? ` · ${waiting} awaiting new suggestions` : "";
  summary.textContent=`${remaining.length} to choose · ${missing.length} awaiting research${revisions} · ${selected.length + offers.length} already chosen`;
  if (held.length) {
    const link = el("a", `Review ${held.length} held ${held.length === 1 ? "choice" : "choices"}`);
    link.href = "?scope=held";
    summary.append(" · ", link);
  }
  if (offers.length) {
    const jump=el("a",`${offers.length} left to compare`);
    jump.href="#alternatives-section";
    summary.append(" · ",jump);
  }
}
function showSavedChoice(p, article) {
  const wasChosen = p.options.some(o => o.id === p.savedChoice);
  const nowChosen = p.options.some(o => o.id === p.choice);
  const bounds = article.getBoundingClientRect();
  const leavingOffers = article.parentElement === alternatives && !hasOffer(p);
  const leavingHeld = scope.value === "held" && !heldForReview(p);
  const movingInView = (wasChosen !== nowChosen || leavingOffers || leavingHeld || (p.awaitingSuggestions && !p.finishingComment)) && article.isConnected &&
    bounds.bottom > 0 && bounds.top < window.innerHeight;
  const afterPending = researchDetails.hidden
    ? (alternatives.parentElement.hidden ? chosen : alternatives).parentElement.querySelector("h2")
    : researchDetails.querySelector("summary");
  const next = article.nextElementSibling ?? (article.parentElement === pending ? afterPending :
    article.parentElement === alternatives ? chosen.parentElement.querySelector("h2") : null);
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
  const rows=[];
  for (const [i,o] of p.options.entries()) {
    const line=el("div"), radio=el("input"), label=el("label"), source=el("a","Source");
    line.className="option"; radio.type="radio"; radio.name=p.id; radio.id=p.id+"-"+o.id;
    radio.checked=p.choice===o.id; label.htmlFor=radio.id; label.textContent=String.fromCharCode(65+i)+". "+o.text;
    source.href=o.source;source.target="_blank";source.rel="noreferrer";line.append(radio,label,source);article.append(line);
    radio.addEventListener("change",()=>{p.choice=o.id;acknowledge();changed()});inputs.push(radio);rows.push(line);
  }
  const keep=el("button","Keep my choice"), swap=el("button","Switch to D"), comparison=el("div");
  comparison.className="comparison";comparison.append(keep,swap);article.append(comparison);
  function acknowledge(){if(p.options[3])p.reviewedAlternative=p.options[3].id}
  keep.onclick=()=>{acknowledge();changed()};
  swap.onclick=()=>{inputs[3].click()};
  function showOffer() {
    const comparing=Boolean(hasOffer(p));
    comparison.hidden=!comparing;
    rows.forEach((row,i)=>{row.hidden=comparing && p.options[i].id!==p.savedChoice && i!==3});
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
          body:JSON.stringify({choice:p.choice,comment:p.comment,hold:p.hold,revision:p.revision,seenOptions:p.options.map(o=>o.id),
            reviewedAlternative:p.reviewedAlternative===p.options[3]?.id ? p.reviewedAlternative : undefined})});
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
  return {article,badge,showOffer};
}
window.addEventListener("beforeunload",e=>{if(saving.size){e.preventDefault();e.returnValue=""}});
search.oninput = refresh;
scope.onchange = () => {
  const url = new URL(location.href);
  if (scope.value === "studying") url.searchParams.delete("scope");
  else url.searchParams.set("scope", scope.value);
  history.replaceState(null, "", url);
  refresh();
};
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
// A direct link can arrive before the comparison section has any rows.
if (location.hash === "#alternatives-section" && !alternatives.parentElement.hidden &&
    performance.getEntriesByType("navigation")[0]?.type === "navigate") {
  alternatives.parentElement.scrollIntoView();
}
