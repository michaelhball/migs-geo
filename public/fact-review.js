
const search = document.querySelector("#search");
const scope = document.querySelector("#scope");
const summary = document.querySelector("#summary");
let places = [];
const pageSize = 12;
const articles = new Map();
const normalize = value => value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
const saving = new Set();
function el(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}
function state(p) {
  if (p.hold) return "hold";
  const option = p.options.find(o => o.id === p.choice);
  if (!option) return p.options.length ? "undecided" : "missing";
  return option.text === p.current?.text && option.source === p.current?.source ? "published" : "ready";
}
const labels = {missing:"Awaiting research",hold:"Needs follow-up",undecided:"Undecided",published:"On card",ready:"Ready to publish"};
function section(id) {
  const root = document.querySelector("#"+id), list = el("div"), nav = el("nav");
  const prev=el("button","Previous"), next=el("button","Next"), count=el("span");
  nav.className="controls"; nav.setAttribute("aria-label",id+" pages"); nav.append(prev,count,next); root.append(list,nav);
  let page=0;
  prev.onclick=()=>{page--;refresh();root.scrollIntoView()};
  next.onclick=()=>{page++;refresh();root.scrollIntoView()};
  return {
    reset(){page=0},
    draw(rows) {
      const pages=Math.ceil(rows.length/pageSize);
      page=Math.max(0,Math.min(page,pages-1));
      const visible=rows.slice(page*pageSize,(page+1)*pageSize).map(p=>{
        if(!articles.has(p.id)) articles.set(p.id,render(p));
        const {article,badge}=articles.get(p.id);
        badge.textContent=labels[state(p)];
        return article;
      });
      if(list.children.length!==visible.length || visible.some((node,i)=>node!==list.children[i])) list.replaceChildren(...visible);
      count.textContent=`Page ${page+1} of ${pages}`;prev.disabled=!page;next.disabled=page+1>=pages;nav.hidden=pages<=1;
    }
  };
}
const pending=section("pending"), chosen=section("chosen"), research=section("research");
const researchDetails=document.querySelector("details");
researchDetails.ontoggle=()=>refresh();
function refresh() {
  const term=normalize(search.value.trim()), remaining=[], selected=[], missing=[];
  for (const p of places) {
    if (!normalize(p.name).includes(term)) continue;
    if (p.options.some(o=>o.id===p.savedChoice)) selected.push(p);
    else if (scope.value==="all" || p.studying) (p.options.length ? remaining : missing).push(p);
  }
  pending.draw(remaining);
  researchDetails.hidden=!missing.length;
  document.querySelector("#research-heading").textContent=`Awaiting research (${missing.length})`;
  research.draw(researchDetails.open ? missing : []);
  chosen.draw(selected);
  summary.textContent=`${remaining.length} to choose · ${missing.length} awaiting research · ${selected.length} already chosen`;
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
  check.onchange=()=>{p.hold=check.checked;changed()};
  article.append(note,hold,actions);clear.hidden=!p.options.length;
  let dirty=false, busy=false;
  function changed(){dirty=true;saving.add(p.id);status.textContent="Saving…";void save()}
  async function save(){
    if(busy)return;
    busy=true;retry.hidden=true;
    try{
      while(dirty){
        dirty=false;
        const response=await fetch("/api/fact-review/"+p.id,{method:"PUT",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({choice:p.choice,comment:p.comment,hold:p.hold,revision:p.revision})});
        const data=await response.json();if(!response.ok)throw Error(data.error||"Save failed");
        p.revision=data.revision;
      }
      p.savedChoice=p.choice;saving.delete(p.id);status.textContent="Saved";refresh();
    }catch(e){dirty=true;status.textContent=e.message;retry.hidden=false}finally{busy=false}
  }
  retry.onclick=save;
  return {article,badge};
}
window.addEventListener("beforeunload",e=>{if(saving.size){e.preventDefault();e.returnValue=""}});
search.oninput=scope.onchange=()=>{pending.reset();research.reset();chosen.reset();refresh()};
try {
  const response=await fetch("/api/fact-review");if(!response.ok)throw Error("Could not load the review.");
  places=await response.json();
  for (const p of places) p.savedChoice=p.choice;
  places.sort((a,b)=>Number(!!b.options.length)-Number(!!a.options.length)||a.name.localeCompare(b.name));
  refresh();
} catch(e){summary.textContent=e.message}
