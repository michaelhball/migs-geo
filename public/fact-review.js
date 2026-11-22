const list = document.querySelector("#list");
const search = document.querySelector("#search");
const filter = document.querySelector("#filter");
const summary = document.querySelector("#summary");
const rows = [];
const saving = new Set();
function el(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}
function state(p) {
  if (p.hold) return "hold";
  const option = p.options.find(o => o.id === p.choice);
  if (!option) return "undecided";
  return option.text === p.current?.text && option.source === p.current?.source ? "published" : "ready";
}
const labels = {hold:"Needs follow-up",undecided:"Undecided",published:"On card",ready:"Ready to publish"};
function refresh() {
  let visible = 0;
  for (const {p,article,badge} of rows) {
    const status = state(p);
    badge.textContent = labels[status];
    article.hidden = !p.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()) ||
      Boolean(filter.value && filter.value !== status);
    if (!article.hidden) visible++;
  }
  summary.textContent = visible + " places shown · " + rows.filter(r=>state(r.p)==="ready").length + " ready to publish";
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
  article.append(note,hold,actions);list.append(article);rows.push({p,article,badge});
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
      saving.delete(p.id);status.textContent="Saved";refresh();
    }catch(e){dirty=true;status.textContent=e.message;retry.hidden=false}finally{busy=false}
  }
  retry.onclick=save;
}
window.addEventListener("beforeunload",e=>{if(saving.size){e.preventDefault();e.returnValue=""}});
search.oninput=filter.onchange=refresh;
try {
  const response=await fetch("/api/fact-review");if(!response.ok)throw Error("Could not load the review.");
  (await response.json()).forEach(render);refresh();
} catch(e){summary.textContent=e.message}
