const ui = Object.fromEntries([...document.querySelectorAll("[id]")].map(e=>[e.id,e]));
const body=document.querySelector("tbody");
const format=new Intl.NumberFormat(undefined,{maximumFractionDigits:1});
const normalize=s=>s.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
let lakes=[],current=0,currentMinimum=0;
function draw() {
  const value=ui.cutoff.valueAsNumber;
  if(!Number.isFinite(value)||value<0){ui.preview.textContent="Enter a nonnegative area.";return}
  const minimum=ui.minimum.valueAsNumber;
  ui.minimum.max=String(value);
  if(!Number.isFinite(minimum)||minimum<0||minimum>value){ui.preview.textContent="Enter a small lake minimum between zero and the inland lake cutoff.";return}
  const small=lakes.filter(l=>l.area>=minimum && l.area<value).length;
  const large=lakes.filter(l=>l.area>=value).length;
  ui.preview.textContent=`Inland lakes: ${large} places (${large*2} cards). Small lakes: ${small} places (${2*small} cards). Excluded from study: ${lakes.length-large-small} lakes.`;
  const group=l=>l.area>=value?"Inland lakes":l.area>=minimum?"Small lakes":"Excluded from study";
  const term=normalize(ui.search.value.trim());
  const shown=lakes.filter(l=>(!ui.group.value||group(l)===ui.group.value) &&
    normalize([l.name,l.region,...l.countries].join(" ")).includes(term));
  shown.sort((a,b)=>ui.sort.value==="name"?a.name.localeCompare(b.name):ui.sort.value==="largest"?b.area-a.area:a.area-b.area);
  const fragment=document.createDocumentFragment();
  for(const lake of shown){
    const tr=document.createElement("tr");
    for(const text of [lake.name,lake.countries.join(", ")||lake.region,format.format(lake.area),group(lake)]){
      const td=document.createElement("td");td.textContent=text;tr.append(td);
    }
    tr.children[2].className="num";fragment.append(tr);
  }
  body.replaceChildren(fragment);
  ui.summary.textContent=`${shown.length} of ${lakes.length} lakes`;
  ui.saved.textContent=`Saved thresholds: ${format.format(current)} and ${format.format(currentMinimum)} km². Applying a cutoff preserves card history. Enable Small lakes separately in Settings.`;
}
ui["cutoff-form"].onsubmit=async e=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;
  try{
    const res=await fetch("/api/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({lakeCutoffKm2:ui.cutoff.valueAsNumber,lakeMinimumKm2:ui.minimum.valueAsNumber})});
    const data=await res.json();if(!res.ok)throw Error(data.error||"Save failed");
    current=data.lakeCutoffKm2;currentMinimum=data.lakeMinimumKm2;draw();
  }catch(err){ui.saved.textContent=err.message}finally{button.disabled=false}
};
try{
  const res=await fetch("/api/lake-review");if(!res.ok)throw Error("Could not load lakes.");
  const data=await res.json();lakes=data.lakes;current=data.cutoff;ui.cutoff.value=current;currentMinimum=data.minimum;ui.minimum.value=currentMinimum;
  ui.search.oninput=ui.minimum.oninput=ui.cutoff.oninput=ui.group.onchange=ui.sort.onchange=draw;draw();
}catch(err){ui.summary.textContent=err.message}
