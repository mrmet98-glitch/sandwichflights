import { asNumber, bestOptionForSearch, buildOptimizerPlans, optionComparisonValue } from './optimizer.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

let state = { searches: [], options: [], permutations: [] };
let activeTab = 'searches';
let expandedSearch = null;
let draft = null;

const cabins = ['Economy','Premium Economy','Business','First','Mixed'];
const ticketTypes = ['One Way','Round Trip','Open-Jaw RT','India-Origin RT','India-Origin Open-Jaw','Custom Pair'];

function esc(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function num(v) { return asNumber(v); }
function money(v, currency='USD', digits=0) { const n=num(v); if(n===null) return '—'; try{return new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:digits}).format(n)}catch{return `${currency} ${n.toFixed(digits)}`;} }
function fmtInt(v){ const n=num(v); return n===null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n); }
function humanDuration(mins){ if(mins===null||mins===undefined||Number.isNaN(Number(mins))) return '—'; const m=Math.abs(Number(mins)); const s=Number(mins)<0?'-':''; return `${s}${Math.floor(m/60)}h ${String(Math.round(m%60)).padStart(2,'0')}m`; }
function durationMinutes(a,b){ if(!a||!b)return null; const x=Date.parse(a), y=Date.parse(b); return Number.isFinite(x)&&Number.isFinite(y)?Math.round((y-x)/60000):null; }
function localDateISO(iso,tz){ if(!iso||!tz)return null; const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso)).map(x=>[x.type,x.value])); return `${p.year}-${p.month}-${p.day}`; }
function localFmt(iso,tz){ if(!iso||!tz)return '—'; return new Intl.DateTimeFormat('en-US',{timeZone:tz,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true,timeZoneName:'short'}).format(new Date(iso)); }
function dayDelta(seg){ const a=localDateISO(seg.scheduled_out_utc,seg.origin_timezone), b=localDateISO(seg.scheduled_in_utc,seg.destination_timezone); if(!a||!b)return null; return Math.round((Date.parse(`${b}T12:00:00Z`)-Date.parse(`${a}T12:00:00Z`))/86400000); }
function dayLabel(seg){ const d=dayDelta(seg); if(d===null||d===0)return ''; return `<span class="day-change">${d>0?`+${d}`:d} day${Math.abs(d)===1?'':'s'}</span>`; }
function airport(seg, side){ return seg[`${side}_iata`] || seg[`${side}_code`] || seg[`${side}_icao`] || '???'; }
function searchById(id){ return state.searches.find(s=>s.id===id); }
function optionsFor(id){ return state.options.filter(o=>o.search_id===id); }
function bestOption(id){ return bestOptionForSearch(state.options,id); }
function bestFare(id){ return optionComparisonValue(bestOption(id)); }
function statusFor(id){ const c=optionsFor(id).length; return c>=2?'Done':c===1?'Partial':'Not Started'; }
function statusBadge(s){ return s==='Done'?'<span class="badge good">2+ options</span>':s==='Partial'?'<span class="badge warn">1 option</span>':'<span class="badge muted">Not Started</span>'; }
function flash(message,type='error'){ const f=$('#flash'); f.textContent=message; f.className=`flash ${type}`; clearTimeout(f._t); f._t=setTimeout(()=>f.classList.add('hidden'),5000); }

function priceLabel(o){
  if(!o) return '—';
  if((o.pricing_type||'cash')==='points'){
    const program=String(o.points_program||'points').trim();
    const taxes=num(o.taxes_fees) ?? 0;
    return `${fmtInt(o.points_amount)} ${esc(program)} + ${money(taxes,o.taxes_currency||'USD',2)}`;
  }
  return money(o.total_price,o.currency||'USD',2);
}
function optimizerLabel(o){ const v=optionComparisonValue(o); return v===null?'—':`${money(v,'USD',0)} value`; }

async function api(url, opts={}){
  const res=await fetch(url,{...opts,headers:{'content-type':'application/json',...(opts.headers||{})}});
  let body={}; try{body=await res.json();}catch{}
  if(!res.ok) throw new Error(body.error||`Request failed (${res.status})`);
  return body;
}

async function load(){
  $('#refreshBtn').disabled=true;
  try { state=await api('/api/state'); render(); }
  catch(e){ flash(e.message); $('#content').innerHTML=`<div class="search-detail"><h2>Could not load planner</h2><p class="error-text">${esc(e.message)}</p><p class="muted">If this is the first deploy, check that schema.sql was run in your D1 database and that the Pages project has a D1 binding named DB.</p></div>`; }
  finally{$('#refreshBtn').disabled=false;}
}

function renderKpis(){
  const twoPlus=state.searches.filter(s=>statusFor(s.id)==='Done').length;
  const priced=state.searches.filter(s=>bestOption(s.id)).length;
  const plans=buildOptimizerPlans(state.searches,state.options);
  const complete=plans.filter(p=>p.complete);
  const lowest=complete.length?complete[0].totalValue:null;
  $('#kpis').innerHTML=`
    <div class="kpi"><span>Searches with 2+ options</span><b>${twoPlus} / ${state.searches.length}</b></div>
    <div class="kpi"><span>Searches with ≥1 fare</span><b>${priced} / ${state.searches.length}</b></div>
    <div class="kpi"><span>Complete booking plans</span><b>${complete.length}</b></div>
    <div class="kpi"><span>Best optimizer value</span><b>${lowest===null?'—':money(lowest,'USD')}</b></div>`;
}

function render(){
  renderKpis();
  $$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===activeTab));
  if(activeTab==='searches') renderSearches();
  else if(activeTab==='optimizer') renderOptimizer();
  else renderPermutations();
}

function renderSearches(){
  const rows=state.searches.map(s=>{
    const count=optionsFor(s.id).length, best=bestOption(s.id), status=statusFor(s.id);
    return `<tr class="search-row" data-id="${esc(s.id)}">
      <td><span class="id-pill">${esc(s.id)}</span>${s.is_custom?'<span class="badge custom">Custom</span>':''}</td><td>${esc(s.ticket_type)}</td>
      <td>${esc(s.leg1_date)}<br><b>${esc(s.leg1_origin)} → ${esc(s.leg1_destination)}</b></td>
      <td>${s.leg2_date?`${esc(s.leg2_date)}<br><b>${esc(s.leg2_origin)} → ${esc(s.leg2_destination)}</b>`:'—'}</td>
      <td>${esc(s.what_to_search)}</td><td>${count}</td><td><b>${best?priceLabel(best):'—'}</b>${best?`<br><span class="muted">${optimizerLabel(best)}</span>`:''}</td><td>${statusBadge(status)}</td>
      <td><button class="button small add-option" data-id="${esc(s.id)}">${count?'Add another':'Add option'}</button></td></tr>`;
  }).join('');
  $('#content').innerHTML=`<div class="section-actions"><div><h2>Fare searches</h2><p class="muted">Built-in workbook searches plus any custom combinations you add.</p></div><button class="button primary" id="addCustomSearch">+ Add custom date combo</button></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Ticket</th><th>Leg 1</th><th>Leg 2</th><th>What to search</th><th>Options</th><th>Best option</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div id="searchDetail"></div>`;
  $('#addCustomSearch').addEventListener('click',openSearchDialog);
  $$('.search-row').forEach(r=>r.addEventListener('click',e=>{ if(e.target.closest('.add-option'))return; expandedSearch=r.dataset.id; renderSearchDetail(); }));
  $$('.add-option').forEach(b=>b.addEventListener('click',()=>openOption(b.dataset.id)));
  if(expandedSearch) renderSearchDetail();
}

function renderSearchDetail(){
  const host=$('#searchDetail'); if(!host)return;
  const s=searchById(expandedSearch); if(!s){host.innerHTML='';return;}
  const opts=optionsFor(s.id);
  host.innerHTML=`<div class="search-detail"><div class="detail-head"><div><div class="eyebrow">SEARCH ${esc(s.id)} · ${esc(s.ticket_type)}</div><h2>${esc(s.what_to_search)}</h2><p class="muted">Add as many flight/fare options as you want. Each physical flight is entered as its own segment.</p></div><div class="detail-actions">${s.is_custom?'<button class="button danger" id="deleteSearch">Delete custom search</button>':''}<button class="button primary" id="detailAdd">+ Add another option</button></div></div><div class="option-grid">${opts.length?opts.map(optionCard).join(''):'<div class="muted">No options saved yet.</div>'}</div></div>`;
  $('#detailAdd').addEventListener('click',()=>openOption(s.id));
  if(s.is_custom) $('#deleteSearch').addEventListener('click',()=>deleteCustomSearch(s.id));
  $$('.edit-option',host).forEach(b=>b.addEventListener('click',()=>openOption(s.id,b.dataset.optionId)));
}

function optionCard(o){
  const outbound=o.segments.filter(s=>s.direction==='outbound').sort((a,b)=>a.segment_order-b.segment_order);
  const returns=o.segments.filter(s=>s.direction==='return').sort((a,b)=>a.segment_order-b.segment_order);
  const award=(o.pricing_type||'cash')==='points';
  return `<article class="option-card"><div class="option-top"><div><div class="eyebrow">OPTION ${o.option_number} · ${award?'AWARD':'CASH'}</div><h3>${priceLabel(o)}</h3><div class="muted">Optimizer: ${optimizerLabel(o)} · ${esc(o.booking_source||'No source entered')}</div></div><button class="button small edit-option" data-option-id="${o.id}">Edit</button></div>${journeySummary('Outbound',outbound)}${returns.length?journeySummary('Return',returns):''}${o.notes?`<p class="muted">${esc(o.notes)}</p>`:''}</article>`;
}

function journeySummary(title,segs){
  if(!segs.length)return '';
  let html=`<div class="journey"><div class="journey-title">${title}</div>`;
  segs.forEach((s,i)=>{
    if(i>0){ const prev=segs[i-1], mins=durationMinutes(prev.scheduled_in_utc,s.scheduled_out_utc); const mismatch=airport(prev,'destination')!==airport(s,'origin'); html+=`<div class="layover">${mismatch?`Airport change ${airport(prev,'destination')} → ${airport(s,'origin')} · `:''}Layover ${humanDuration(mins)}</div>`; }
    html+=`<div class="segment-summary"><div><b>${esc(s.entered_flight_number)}</b><br><span class="muted">${esc(s.aircraft_type||'Aircraft —')}</span></div><div><span class="route">${airport(s,'origin')} → ${airport(s,'destination')}</span><br><span class="muted">${localFmt(s.scheduled_out_utc,s.origin_timezone)} → ${localFmt(s.scheduled_in_utc,s.destination_timezone)} ${dayLabel(s)}</span></div><div>${esc(s.cabin||'')}</div></div>`;
  });
  return html+'</div>';
}

function computedPermutations(){
  const best=Object.fromEntries(state.searches.map(s=>[s.id,bestOption(s.id)]));
  return state.permutations.map(p=>{
    const ids=[p.standalone_one_way,p.round_trip_1,p.round_trip_2,p.round_trip_3];
    const opts=ids.map(id=>best[id]); const missing=opts.filter(v=>!v).length;
    const vals=opts.map(o=>o?optionComparisonValue(o):null);
    return {...p,ids,opts,missing,ready:missing===0,total:missing===0?vals.reduce((a,b)=>a+b,0):null};
  });
}

function renderPermutations(){
  const perms=computedPermutations(); const ready=perms.filter(p=>p.ready); const lowest=ready.length?Math.min(...ready.map(p=>p.total)):null;
  const rows=perms.map(p=>`<tr class="perm-row ${p.ready?'ready':''} ${p.ready&&p.total===lowest?'lowest':''}"><td>${p.variant}</td><td>${esc(p.oct_date)}</td><td>${esc(p.standalone_one_way)}</td><td>${esc(p.round_trip_1)}</td><td>${esc(p.round_trip_2)}</td><td>${esc(p.round_trip_3)}</td><td class="money">${p.ready?money(p.total,'USD'):'—'}</td><td>${p.missing}</td><td>${p.ready?'<span class="badge good">Ready</span>':`<span class="badge muted">Need ${p.missing}</span>`}</td><td>${esc(p.structure)}</td></tr>`).join('');
  $('#content').innerHTML=`<div class="section-actions"><div><h2>Original 48 permutations</h2><p class="muted">Uses the cheapest optimizer-value option saved under each original Search ID.</p></div></div><div class="permutation-summary"><span class="badge good">${ready.length} ready</span><span class="badge muted">${perms.length-ready.length} still missing fares</span>${lowest!==null?`<span class="badge good">Lowest ${money(lowest,'USD')}</span>`:''}</div><div class="table-wrap"><table><thead><tr><th>Variant</th><th>Oct date</th><th>One way</th><th>RT 1</th><th>RT 2</th><th>RT 3</th><th>Optimizer value</th><th>Missing</th><th>Ready?</th><th>Structure</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function planBreakdown(plan){
  let cashUsd=0; const points=new Map(); let hasNonUsd=false;
  for(const x of plan.selected){
    if(!x.option) continue;
    const o=x.option;
    if((o.pricing_type||'cash')==='points'){
      const program=String(o.points_program||'Points');
      points.set(program,(points.get(program)||0)+(num(o.points_amount)||0));
      if((o.taxes_currency||'USD')==='USD') cashUsd += num(o.taxes_fees)||0; else hasNonUsd=true;
    } else if((o.currency||'USD')==='USD') cashUsd += num(o.total_price)||0;
    else hasNonUsd=true;
  }
  const pointText=[...points.entries()].map(([p,n])=>`${fmtInt(n)} ${esc(p)}`).join(' + ');
  return `${money(cashUsd,'USD',0)} cash${pointText?` + ${pointText}`:''}${hasNonUsd?' + non-USD charges':''}`;
}

function renderOptimizer(){
  const plans=buildOptimizerPlans(state.searches,state.options);
  const complete=plans.filter(p=>p.complete);
  const best=complete[0]||null;
  const partial=plans.filter(p=>!p.complete).slice(0,20);
  const relevantIds=new Set(plans.flatMap(p=>p.ids));
  const pricedRelevant=[...relevantIds].filter(id=>bestOption(id)).length;
  const coverageComplete=relevantIds.size>0 && pricedRelevant===relevantIds.size;
  const customInEngine=state.searches.filter(s=>s.is_custom && relevantIds.has(s.id)).length;
  const bestHtml=best?`<section class="optimizer-hero"><div><div class="eyebrow">${coverageComplete?'BEST COMPLETE BOOKING PLAN':'CURRENT LEADER · STILL EVOLVING'}</div><h2>${money(best.totalValue,'USD')} optimizer value</h2><p>${planBreakdown(best)}</p><p class="muted">October outbound: ${esc(best.octDate)} · ${best.ids.length} tickets</p>${coverageComplete?'':`<p><span class="badge warn">Only ${pricedRelevant}/${relevantIds.size} usable fare searches priced — winner can still change</span></p>`}</div><div class="optimizer-ticket-list">${best.selected.map(x=>`<div class="optimizer-ticket"><span class="id-pill">${esc(x.search.id)}</span><div><b>${esc(x.search.what_to_search)}</b><br><span>Option ${esc(x.option.option_number||'—')} · ${priceLabel(x.option)}</span></div><strong>${optimizerLabel(x.option)}</strong></div>`).join('')}</div></section>`:`<section class="optimizer-empty"><div class="eyebrow">BOOKING OPTIMIZER</div><h2>No complete plan yet</h2><p>Add at least one priced option to the missing searches below. The partial leaderboard will update every time you save a fare.</p></section>`;

  const completeRows=complete.slice(0,15).map((p,i)=>`<tr class="${i===0?'lowest':''}"><td>${i+1}</td><td>${esc(p.octDate)}</td><td>${p.ids.map(id=>`<span class="id-pill">${esc(id)}</span>`).join(' ')}</td><td>${planBreakdown(p)}</td><td class="money">${money(p.totalValue,'USD')}</td></tr>`).join('');
  const partialRows=partial.map(p=>`<tr><td>${esc(p.octDate)}</td><td>${p.ids.map(id=>`<span class="id-pill">${esc(id)}</span>`).join(' ')}</td><td class="money">${money(p.knownValue,'USD')}</td><td>${p.missing.map(id=>`<span class="badge muted">${esc(id)}</span>`).join(' ')}</td><td>${p.missing.length}</td></tr>`).join('');

  $('#content').innerHTML=`${bestHtml}<div class="optimizer-note"><b>How this works:</b> the calculator finds ticket combinations that cover every required trip date exactly once. Custom searches are automatically included when their legs match the itinerary. Cash fares and awards are ranked using each option's USD optimizer value.</div><div class="optimizer-stats"><span class="badge good">${complete.length} complete plans</span><span class="badge muted">${pricedRelevant}/${relevantIds.size} usable searches priced</span><span class="badge muted">${plans.length} valid structures found</span><span class="badge custom">${customInEngine} custom searches usable</span></div>${complete.length?`<h3>Complete leaderboard</h3><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Oct</th><th>Tickets</th><th>Actual payment mix</th><th>Optimizer value</th></tr></thead><tbody>${completeRows}</tbody></table></div>`:''}<h3>${complete.length?'Partial alternatives':'Best partial picture so far'}</h3><p class="muted">These are not final totals. They show known optimizer value plus exactly which fare searches are still missing.</p><div class="table-wrap"><table><thead><tr><th>Oct</th><th>Ticket structure</th><th>Known value</th><th>Still need fare(s)</th><th>Missing</th></tr></thead><tbody>${partialRows||'<tr><td colspan="5">No partial structures available.</td></tr>'}</tbody></table></div>`;
}

function newSegment(direction,date){ return {direction,segment_order:1,entered_date:date,entered_flight_number:'',cabin:'Economy'}; }

function openOption(searchId, optionId=null){
  const s=searchById(searchId); const existing=optionId?state.options.find(o=>String(o.id)===String(optionId)):null;
  draft=existing?JSON.parse(JSON.stringify(existing)):{id:null,search_id:searchId,pricing_type:'cash',total_price:'',currency:'USD',points_amount:'',points_program:'',taxes_fees:'',taxes_currency:'USD',point_value_cents:'1.5',comparison_value_usd:'',booking_source:'',notes:'',segments:[newSegment('outbound',s.leg1_date)]};
  if(!existing && s.ticket_type!=='One Way') draft.segments.push(newSegment('return',s.leg2_date));
  draft.search_id=searchId;
  $('#dialogSearchId').textContent=`SEARCH ${searchId} · ${s.ticket_type}`;
  $('#dialogTitle').textContent=existing?`Edit option ${existing.option_number}`:'Add fare option';
  $('#dialogSubtitle').textContent=s.what_to_search;
  $('#pricingType').value=draft.pricing_type||'cash';
  $('#totalPrice').value=draft.total_price??''; $('#currency').value=draft.currency||'USD';
  $('#pointsAmount').value=draft.points_amount??''; $('#pointsProgram').value=draft.points_program||''; $('#taxesFees').value=draft.taxes_fees??''; $('#taxesCurrency').value=draft.taxes_currency||'USD'; $('#pointValueCents').value=draft.point_value_cents??'1.5';
  $('#comparisonValue').value=draft.comparison_value_usd??''; $('#bookingSource').value=draft.booking_source||''; $('#notes').value=draft.notes||'';
  $('#deleteOption').classList.toggle('hidden',!existing);
  updatePricingUI(false); renderJourneyEditors(); $('#optionDialog').showModal();
}

function updatePricingUI(recalculate=true){
  const type=$('#pricingType').value;
  $('#cashFields').classList.toggle('hidden',type!=='cash');
  $('#pointsFields').classList.toggle('hidden',type!=='points');
  const comp=$('#comparisonValue');
  let auto=null; let hint='';
  if(type==='cash'){
    if($('#currency').value==='USD') { auto=num($('#totalPrice').value); hint='Auto = cash fare because currency is USD.'; }
    else hint='Enter the USD equivalent so non-USD fares can be compared fairly.';
  } else {
    const pts=num($('#pointsAmount').value), cpp=num($('#pointValueCents').value), tax=num($('#taxesFees').value)||0;
    if($('#taxesCurrency').value==='USD' && pts!==null && cpp!==null) { auto=(pts*cpp/100)+tax; hint='Auto = points × cents-per-point + USD taxes/fees.'; }
    else hint='Enter USD equivalent when award taxes are not in USD.';
  }
  comp.readOnly=auto!==null;
  if(auto!==null && recalculate) comp.value=auto.toFixed(2);
  if(auto!==null && !recalculate && (comp.value==='' || num(comp.value)===null)) comp.value=auto.toFixed(2);
  $('#comparisonHint').textContent=hint;
}

function renderJourneyEditors(){
  const s=searchById(draft.search_id); const dirs=s.ticket_type==='One Way'?['outbound']:['outbound','return'];
  $('#journeyEditors').innerHTML=dirs.map(dir=>{
    const segs=draft.segments.filter(x=>x.direction===dir).sort((a,b)=>a.segment_order-b.segment_order);
    const expected=dir==='outbound'?`${s.leg1_origin} → ${s.leg1_destination} · ${s.leg1_date}`:`${s.leg2_origin} → ${s.leg2_destination} · ${s.leg2_date}`;
    return `<section class="journey-editor"><div class="journey-editor-head"><div><div class="eyebrow">${dir.toUpperCase()}</div><h3>${esc(expected)}</h3></div><button type="button" class="button small add-segment" data-dir="${dir}">+ Segment</button></div><div class="segments">${segs.map((seg,i)=>segmentEditor(seg,i)).join('')}${layoverEditorSummary(segs)}</div></section>`;
  }).join('');
  bindSegmentEvents();
}

function segmentEditor(seg,index){
  const uid=`${seg.direction}-${index}`; const has=seg.scheduled_out_utc&&seg.origin_timezone;
  return `<div class="segment-editor" data-uid="${uid}"><div class="segment-inputs"><label>Departure date<input class="seg-date" type="date" value="${esc(seg.entered_date||'')}"></label><label>Flight number<input class="seg-flight" value="${esc(seg.entered_flight_number||'')}" placeholder="LH413"></label><label>Cabin<select class="seg-cabin">${cabins.map(c=>`<option ${seg.cabin===c?'selected':''}>${c}</option>`).join('')}</select></label><button type="button" class="button primary lookup-seg">Pull FlightAware</button><button type="button" class="button secondary remove-seg">Remove</button></div><div class="lookup-error error-text"></div>${seg._matches?.length>1?`<label class="match-select">Multiple matches found<select class="match-choice">${seg._matches.map((m,i)=>`<option value="${i}" ${i===(seg._selectedMatch||0)?'selected':''}>${esc(`${m.entered_flight_number} · ${airport(m,'origin')} ${localFmt(m.scheduled_out_utc,m.origin_timezone)} → ${airport(m,'destination')} ${localFmt(m.scheduled_in_utc,m.destination_timezone)}`)}</option>`).join('')}</select></label>`:''}<div class="segment-result ${has?'':'hidden'}">${has?segmentResult(seg):''}</div></div>`;
}

function segmentResult(seg){ return `<div class="segment-result-grid"><div><span class="muted">Route</span><b>${airport(seg,'origin')} → ${airport(seg,'destination')}</b><span class="muted">${esc(seg.origin_name||'')} → ${esc(seg.destination_name||'')}</span></div><div><span class="muted">Local schedule</span><b>${localFmt(seg.scheduled_out_utc,seg.origin_timezone)}</b><span>${localFmt(seg.scheduled_in_utc,seg.destination_timezone)} ${dayLabel(seg)}</span></div><div><span class="muted">Aircraft / duration</span><b>${esc(seg.aircraft_type||'—')}</b><span>${humanDuration(durationMinutes(seg.scheduled_out_utc,seg.scheduled_in_utc))}</span></div></div><div class="muted" style="margin-top:8px">Timezone source: ${esc(seg.origin_timezone||'—')} → ${esc(seg.destination_timezone||'—')} · UTC retained as source of truth</div>`; }

function layoverEditorSummary(segs){
  if(segs.length<2)return '';
  let out='<div class="journey">';
  for(let i=1;i<segs.length;i++){
    const a=segs[i-1],b=segs[i]; if(!a.scheduled_in_utc||!b.scheduled_out_utc) continue;
    const mins=durationMinutes(a.scheduled_in_utc,b.scheduled_out_utc); const mismatch=airport(a,'destination')!==airport(b,'origin');
    out+=`<div class="layover">Segment ${i} → ${i+1}: ${mismatch?`airport change ${airport(a,'destination')} → ${airport(b,'origin')} · `:''}${humanDuration(mins)} layover${mins<0?' · ⚠ check dates':''}</div>`;
  }
  return out+'</div>';
}

function segFromUid(uid){ const [dir,idxRaw]=uid.split('-'); const segs=draft.segments.filter(s=>s.direction===dir).sort((a,b)=>a.segment_order-b.segment_order); return segs[Number(idxRaw)]; }
function reindex(){ ['outbound','return'].forEach(dir=>draft.segments.filter(s=>s.direction===dir).sort((a,b)=>a.segment_order-b.segment_order).forEach((s,i)=>s.segment_order=i+1)); }

function bindSegmentEvents(){
  $$('.add-segment').forEach(b=>b.onclick=()=>{ const dir=b.dataset.dir; const s=searchById(draft.search_id); const arr=draft.segments.filter(x=>x.direction===dir); draft.segments.push(newSegment(dir,arr.length?arr[arr.length-1].entered_date:(dir==='outbound'?s.leg1_date:s.leg2_date))); reindex(); renderJourneyEditors(); });
  $$('.segment-editor').forEach(el=>{
    const seg=segFromUid(el.dataset.uid);
    $('.seg-date',el).oninput=e=>{seg.entered_date=e.target.value; clearLookup(seg);};
    $('.seg-flight',el).oninput=e=>{seg.entered_flight_number=e.target.value.toUpperCase(); clearLookup(seg);};
    $('.seg-cabin',el).onchange=e=>seg.cabin=e.target.value;
    $('.remove-seg',el).onclick=()=>{ draft.segments=draft.segments.filter(s=>s!==seg); reindex(); renderJourneyEditors(); };
    $('.lookup-seg',el).onclick=()=>lookupSegment(seg,el);
    const mc=$('.match-choice',el); if(mc) mc.onchange=e=>{seg._selectedMatch=Number(e.target.value); applyMatch(seg,seg._matches[seg._selectedMatch]); renderJourneyEditors();};
  });
}

function clearLookup(seg){
  ['ident','ident_iata','ident_icao','actual_ident','origin_code','origin_iata','origin_icao','origin_name','origin_city','origin_timezone','destination_code','destination_iata','destination_icao','destination_name','destination_city','destination_timezone','scheduled_out_utc','scheduled_in_utc','aircraft_type','source_mode','raw'].forEach(k=>delete seg[k]); delete seg._matches; delete seg._selectedMatch;
}
function applyMatch(seg,m){ const cabin=seg.cabin; const direction=seg.direction, order=seg.segment_order; Object.assign(seg,m,{direction,segment_order:order,cabin}); seg._matches=seg._matches||[m]; delete seg.score; }

async function lookupSegment(seg,el){
  if(!seg.entered_date||!seg.entered_flight_number){ $('.lookup-error',el).textContent='Enter date and flight number first.'; return; }
  const btn=$('.lookup-seg',el); btn.disabled=true; btn.textContent='Looking up…'; $('.lookup-error',el).textContent='';
  try{
    const data=await api('/api/flight-lookup',{method:'POST',body:JSON.stringify({date:seg.entered_date,flight_number:seg.entered_flight_number})});
    seg._matches=data.matches; seg._selectedMatch=0; applyMatch(seg,data.matches[0]); renderJourneyEditors();
  }catch(e){ $('.lookup-error',el).textContent=e.message; }
  finally{ if(document.body.contains(btn)){btn.disabled=false;btn.textContent='Pull FlightAware';} }
}

async function saveDraft(){
  draft.pricing_type=$('#pricingType').value;
  draft.total_price=$('#totalPrice').value; draft.currency=$('#currency').value;
  draft.points_amount=$('#pointsAmount').value; draft.points_program=$('#pointsProgram').value.trim(); draft.taxes_fees=$('#taxesFees').value; draft.taxes_currency=$('#taxesCurrency').value; draft.point_value_cents=$('#pointValueCents').value;
  draft.comparison_value_usd=$('#comparisonValue').value;
  draft.booking_source=$('#bookingSource').value.trim(); draft.notes=$('#notes').value.trim();
  const missing=draft.segments.find(s=>!s.entered_date||!s.entered_flight_number||!s.scheduled_out_utc||!s.scheduled_in_utc);
  if(missing) throw new Error('Every segment needs a successful FlightAware lookup before saving.');
  const payload={...draft,segments:draft.segments.map(s=>{const c={...s}; delete c._matches; delete c._selectedMatch; return c;})};
  await api('/api/options',{method:'POST',body:JSON.stringify(payload)}); $('#optionDialog').close(); await load(); expandedSearch=draft.search_id; if(activeTab==='searches') renderSearchDetail(); flash('Option saved. Optimizer updated.','ok');
}

function openSearchDialog(){
  $('#searchForm').reset(); $('#searchTicketType').value='One Way'; $('#searchLeg2').classList.add('hidden'); $('#searchDialog').showModal();
}
function updateSearchLeg2(){ $('#searchLeg2').classList.toggle('hidden',$('#searchTicketType').value==='One Way'); }
async function saveSearch(){
  const payload={ticket_type:$('#searchTicketType').value,leg1_date:$('#searchLeg1Date').value,leg1_origin:$('#searchLeg1Origin').value,leg1_destination:$('#searchLeg1Destination').value,leg2_date:$('#searchLeg2Date').value,leg2_origin:$('#searchLeg2Origin').value,leg2_destination:$('#searchLeg2Destination').value,what_to_search:$('#searchLabel').value.trim()};
  const out=await api('/api/searches',{method:'POST',body:JSON.stringify(payload)}); $('#searchDialog').close(); await load(); expandedSearch=out.id; activeTab='searches'; render(); renderSearchDetail(); flash(`Custom search ${out.id} added.`,'ok');
}
async function deleteCustomSearch(id){
  if(!confirm(`Delete custom search ${id} and all of its saved fare options?`)) return;
  await api(`/api/searches?id=${encodeURIComponent(id)}`,{method:'DELETE'}); expandedSearch=null; await load(); flash(`Custom search ${id} deleted.`,'ok');
}

$('#optionForm').addEventListener('submit',async e=>{e.preventDefault(); const b=$('#saveOption');b.disabled=true;try{await saveDraft();}catch(err){flash(err.message);}finally{b.disabled=false;}});
$('#deleteOption').addEventListener('click',async()=>{ if(!draft?.id)return; if(!confirm('Delete this fare option?'))return; try{await api(`/api/options?id=${encodeURIComponent(draft.id)}`,{method:'DELETE'}); $('#optionDialog').close(); await load(); expandedSearch=draft.search_id; if(activeTab==='searches')renderSearchDetail(); flash('Option deleted. Optimizer updated.','ok');}catch(e){flash(e.message);} });
$('#closeDialog').onclick=()=>$('#optionDialog').close(); $('#cancelOption').onclick=()=>$('#optionDialog').close();
$('#pricingType').addEventListener('change',()=>updatePricingUI(true));
['totalPrice','currency','pointsAmount','taxesFees','taxesCurrency','pointValueCents'].forEach(id=>$('#'+id).addEventListener('input',()=>updatePricingUI(true)));
$('#searchForm').addEventListener('submit',async e=>{e.preventDefault(); const b=$('#saveSearch');b.disabled=true;try{await saveSearch();}catch(err){flash(err.message);}finally{b.disabled=false;}});
$('#searchTicketType').addEventListener('change',updateSearchLeg2); $('#closeSearchDialog').onclick=()=>$('#searchDialog').close(); $('#cancelSearch').onclick=()=>$('#searchDialog').close();
$('#refreshBtn').onclick=load;
$$('.tab').forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;render();});

load();
