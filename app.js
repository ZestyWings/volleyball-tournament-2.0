"use strict";
/*****************************
 * Persistence (localStorage)
 *****************************/
var STORAGE_KEY = 'vtm_state_v1';
function persist(){
  try{
    var payload = { state: state, nextTeamId: nextTeamId };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }catch(e){ console.warn('Persist failed', e); }
}
function loadPersisted(){
  try{
    var raw = localStorage.getItem(STORAGE_KEY); if(!raw) return false;
    var data = JSON.parse(raw);
    if(!data || !data.state) return false;
    state = data.state; nextTeamId = data.nextTeamId || 1;
    return true;
  }catch(e){ console.warn('Load failed', e); return false; }
}
function clearPersisted(){ try{ localStorage.removeItem(STORAGE_KEY); }catch(e){} }

/*****************************
 * State
 *****************************/
var state = {
  teams: [], // {id, name, checked, wins, diff}
  schedule: [], // [{round, matches:[{a,b,aScore,bScore,winnerId,diff,played,isBye}], bye:{a,b}}]
  standings: [],
  rankings: [],
  bracket: null
};
var nextTeamId = 1;


/*****************************
 * Helpers
 *****************************/
function el(sel){ return document.querySelector(sel); }
function create(tag, props, children){
  if(props===undefined) props={}; if(children===undefined) children=[];
  var n = document.createElement(tag);
  for (var k in props){ if(props.hasOwnProperty(k)){ if(k==='class') n.className = props[k]; else if(k==='html') n.innerHTML = props[k]; else n.setAttribute(k, props[k]); }}
  var arr = Array.isArray(children) ? children : [children];
  arr.forEach(function(c){ n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return n;
}
function teamName(id){ if(id==='BYE') return 'BYE'; var t=state.teams.find(function(x){return x.id===id;}); return t? t.name : '—'; }
function buildSelect(id, withBye, placeholder){
  var s = create('select', { id:id });
  if(placeholder){
    s.appendChild(create('option', { value:'', disabled:'', selected:'' }, placeholder));
  }
  var src = withBye ? state.teams.concat([{id:'BYE', name:'BYE'}]) : state.teams;
  src.forEach(function(t){ s.appendChild(create('option', { value:String(t.id) }, t.name)); });
  return s;
}

function syncUIStateFromState(){
  // Do we have a schedule? If yes, user should be able to finalize pool.
  var hasSchedule = Array.isArray(state.schedule) && state.schedule.length > 0;

  // Has pool already been finalized? (rankings locked)
  var poolComplete = Array.isArray(state.rankings) && state.rankings.length > 0;

  // Bracket already built?
  var hasBracket = !!state.bracket;

  // Finalize pool button:
  var finalizeBtn = document.querySelector('#finalizePool');
  if (finalizeBtn) {
    finalizeBtn.disabled = !hasSchedule;
  }

  // Build bracket button:
  var buildBtn = document.querySelector('#buildBracket');
  if (buildBtn) {
    // If the pool is already finalized (rankings exist), they should be allowed to build bracket.
    // If bracket already exists, we can keep it enabled too.
    buildBtn.disabled = !(poolComplete || hasBracket);
  }
}



/*****************************
 * 1) Team registration & check-in
 *****************************/
function addTeam(name){
  if(!name) return;
  if(state.teams.length >= 12){ alert('Max 12 teams.'); return; }
  state.teams.push({ id: nextTeamId++, name: String(name).trim(), checked: false, wins: 0, diff: 0 });
  renderTeams(); persist();
}
function removeTeam(id){ state.teams = state.teams.filter(function(t){return t.id!==id;}); renderTeams(); persist(); }
function toggleCheck(id){ var t=state.teams.find(function(x){return x.id===id;}); if(t){ t.checked = !t.checked; renderTeams(); persist(); } }
function renderTeams(){
  var tbody = el('#teamsTable tbody');
  tbody.innerHTML = '';
  state.teams.forEach(function(t,i){
    var tr = document.createElement('tr');
    tr.appendChild(create('td', {}, String(i+1)));
    var nameTd = create('td'); nameTd.appendChild(create('span', { class: t.checked? 'winner':'' }, t.name)); tr.appendChild(nameTd);
    tr.appendChild(create('td', {}, create('span', { class:(t.checked? 'pill ok':'pill warn') }, t.checked? 'checked in':'not checked')));
    var actions = create('td');
    var btnCheck = create('button'); btnCheck.textContent = t.checked? 'Uncheck':'Check in'; btnCheck.addEventListener('click',function(){toggleCheck(t.id);}); actions.appendChild(btnCheck);
    actions.appendChild(create('span', { style:'display:inline-block;width:8px;' }, ''));
    var btnRemove = create('button', { class:'secondary' }); btnRemove.textContent='Remove'; btnRemove.addEventListener('click',function(){removeTeam(t.id);}); actions.appendChild(btnRemove);
    tr.appendChild(actions);
    tbody.appendChild(tr);
  });
}

/*****************************
 * 2) Pool scheduling
 *****************************/
function roundRobinPairings(teamIds){
  var ids = teamIds.slice();
  if(ids.length % 2 === 1) ids.push('BYE');
  var n = ids.length, half = n/2, rounds=[];
  var left = ids.slice(0,half), right = ids.slice(half).reverse();
  for(var r=0; r<n-1; r++){
    var pairings=[];
    for(var i=0;i<half;i++){
      var a=left[i], b=right[i];
      if(a!=='BYE' && b!=='BYE') pairings.push([a,b]);
      else if(a==='BYE' && b!=='BYE') pairings.push([b,'BYE']);
      else if(b==='BYE' && a!=='BYE') pairings.push([a,'BYE']);
    }
    rounds.push(pairings);
    var fixed = left[0];
    var firstRight = right[0];
    right = right.slice(1).concat(left.pop());
    left = [fixed].concat([firstRight]).concat(left.slice(1));
  }
  return rounds;
}

// Determine rounds & matches per round from team count.
function computeFormat(teamCount){
  if(teamCount===8) return { rounds:4, matchesPerRound:4, includeBye:false };
  if(teamCount===10) return { rounds:5, matchesPerRound:4, includeBye:true };// two teams rest per round via Bye row (manual selectors)
  if(teamCount===12) return { rounds:4, matchesPerRound:6, includeBye:false };
  return null; // unsupported
}

function createSchedule(roundCount){ // roundCount optional; when omitted we auto-pick from team count
  var poolTeams = state.teams.filter(function(t){return t.checked;});
  if(poolTeams.length===0) poolTeams = state.teams.slice();
  if(poolTeams.length < 2){ alert('Need at least 2 teams.'); return; }
  var ids = poolTeams.map(function(t){return t.id;});
  var manual = el('#manualMode').checked;

  var fmt = computeFormat(poolTeams.length);
  var autoMode = !roundCount && fmt;
  if(!roundCount && !fmt){
    alert('For now, only 8, 10, or 12 teams are supported for auto scheduling. You currently have '+poolTeams.length+'.');
    return;
  }
  var roundsToMake = autoMode ? fmt.rounds : roundCount;
  var matchesPerRound = autoMode ? fmt.matchesPerRound : 4; // legacy default for tests
  var includeBye = autoMode ? fmt.includeBye : (roundCount===5);

  if(!manual){
    var rr = roundRobinPairings(ids).slice(0, roundsToMake);
    state.schedule = rr.map(function(pairings, idx){
      return { round: idx+1,
        matches: pairings.slice(0, matchesPerRound).map(function(p){ return { a:p[0], b:p[1], aScore:'', bScore:'', winnerId:null, diff:0, played:false }; }),
        bye: null };
    });
  } else {
    state.schedule = Array.from({length: roundsToMake}, function(_,r){
      return { round: r+1,
        matches: Array.from({length: matchesPerRound}, function(){ return { a:null, b:null, aScore:'', bScore:'', winnerId:null, diff:0, played:false }; }),
        bye: null };
    });
  }

  state.schedule.forEach(function(r){
    if(r.matches.length > matchesPerRound) r.matches = r.matches.slice(0,matchesPerRound);
    while(r.matches.length < matchesPerRound){ r.matches.push({ a:null, b:null, aScore:'', bScore:'', winnerId:null, diff:0, played:false }); }
    r.bye = null; // set below if we include a bye selector row
  });

  if (includeBye) {
    state.schedule.forEach(function(r){
      var hasByeRow = r.matches.some(function(m){ return m.isBye; });
      if (!hasByeRow) {
        r.matches.push({ isBye:true, a:'BYE', b:'BYE', aScore:'', bScore:'', winnerId:null, diff:0, played:true });
        if (!r.bye) r.bye = { a: null, b: null };
      }
    });
  }

  state.teams.forEach(function(t){ t.wins=0; t.diff=0; });
  state.standings = []; state.rankings = [];
  renderSchedule();
  renderStandings();
  syncUIStateFromState();
  persist();

}

/* Eligibility helpers (manual assist) */
function pairKey(a,b){ if(a==='BYE' || b==='BYE') return null; var x = typeof a==='number'? a : parseInt(a,10); var y = typeof b==='number'? b : parseInt(b,10); var p = x<y? x:y; var q = x<y? y:x; return String(p)+'-'+String(q); }
function seenPairsBefore(roundNo){
  var map = new Map();
  state.schedule.forEach(function(r){
    if(r.round>=roundNo) return; r.matches.forEach(function(m){ if(m.isBye) return; if(m.a==null||m.b==null) return; var k = pairKey(m.a,m.b); if(k){ map.set(k, r.round); } });
  });
  return map;
}
function teamsWithByeSoFar(roundNo){
  var set = new Set();
  state.schedule.forEach(function(r){ if(r.round>=roundNo) return; if(r.bye){ if(r.bye.a!=null) set.add(r.bye.a); if(r.bye.b!=null) set.add(r.bye.b); } });
  return set;
}
// Map teamId -> Set(opponentIds) played in prior rounds
function previousOpponentsMap(roundNo){
  var map = new Map();
  state.schedule.forEach(function(r){
    if(r.round>=roundNo) return;
    r.matches.forEach(function(m){
      if(m.isBye) return; if(m.a==null||m.b==null) return;
      if(m.a!=='BYE' && m.b!=='BYE'){
        if(!map.has(m.a)) map.set(m.a, new Set());
        if(!map.has(m.b)) map.set(m.b, new Set());
        map.get(m.a).add(m.b); map.get(m.b).add(m.a);
      }
    });
  });
  return map;
}
// Teams already taken in this round (matches + byes)
function roundTakenTeams(roundNo){
  var set = new Set();
  var r = state.schedule.find(function(x){return x.round===roundNo;}); if(!r) return set;
  r.matches.forEach(function(m){ if(m.isBye) return; if(m.a!=null) set.add(m.a); if(m.b!=null) set.add(m.b); });
  if(r.bye){ if(r.bye.a!=null) set.add(r.bye.a); if(r.bye.b!=null) set.add(r.bye.b); }
  return set;
}
// Make the two BYE selectors only allow valid teams:
// - not already used in a match this round
// - not already assigned bye in earlier rounds
// - not equal to the other bye picker
function applyEligibilityForBye(roundNo){
  var r = state.schedule.find(function(x){return x.round===roundNo;});
  if(!r) return;

  var aSel = el('#byeA-'+roundNo);
  var bSel = el('#byeB-'+roundNo);
  if(!aSel || !bSel) return;

  // Teams used in matches (DO NOT include current bye picks so user can change them)
  var taken = new Set();
  r.matches.forEach(function(m){
    if(m.isBye) return;
    if(m.a!=null) taken.add(m.a);
    if(m.b!=null) taken.add(m.b);
  });

  // Teams that already received a bye before this round
  var alreadyByed = teamsWithByeSoFar(roundNo);

  function rebuildBye(sel, otherVal, placeholderText){
    var keepVal = sel.value;
    sel.innerHTML = '';
    // true placeholder
    sel.appendChild(create('option', { value:'', disabled:'', selected:'' }, placeholderText || 'Select team (rest)'));

    state.teams.forEach(function(t){
      var opt = create('option', { value:String(t.id) }, t.name);
      var disable = taken.has(t.id) || alreadyByed.has(t.id) || (otherVal && String(t.id)===String(otherVal));
      if(disable){
        opt.disabled = true;
        opt.textContent = '• ' + t.name + (alreadyByed.has(t.id) ? ' (already had bye)' : ' (taken)');
      }
      sel.appendChild(opt);
    });

    // restore only if still valid
    if(keepVal){
      var o = sel.querySelector('option[value="'+keepVal+'"]');
      sel.value = (o && !o.disabled) ? keepVal : '';
    }else{
      sel.value = '';
    }
  }

  rebuildBye(aSel, bSel.value, 'Select team A (rest)');
  rebuildBye(bSel, aSel.value, 'Select team B (rest)');
}

// Given a primary team, return list of eligible opponents for this round (no rematch and not taken this round)
function eligibleOpponents(roundNo, primaryId){
  var prior = previousOpponentsMap(roundNo);
  var taken = roundTakenTeams(roundNo);
  var bannedVsPrimary = prior.get(primaryId) || new Set();
  return state.teams
    .map(function(t){return t.id;})
    .filter(function(id){ return id!==primaryId && !taken.has(id) && !(bannedVsPrimary.has(id)); });
}
// Apply filtering/labels on a manual row when Assist is on
function applyEligibilityForRow(roundNo, idx){
  if(!el('#assistManual') || !el('#assistManual').checked) return; // opt-in
  var aSel = el('#aSel-'+roundNo+'-'+idx);
  var bSel = el('#bSel-'+roundNo+'-'+idx);
  if(!aSel || !bSel) return;
  var aVal = aSel.value? (aSel.value==='BYE' ? 'BYE' : parseInt(aSel.value,10)) : null;
  var bVal = bSel.value? (bSel.value==='BYE' ? 'BYE' : parseInt(bSel.value,10)) : null;
  // Helper to rebuild options with eligible first, ineligible disabled
  function rebuild(sel, primaryId){
    var keepVal = sel.value;
    sel.innerHTML = '';
    sel.appendChild(create('option', { value:'', disabled:'', selected:'' }, 'Pick team'));
    var eligibleIds = primaryId && primaryId!=='BYE' ? eligibleOpponents(roundNo, primaryId) : state.teams.map(function(t){return t.id;});
    var taken = roundTakenTeams(roundNo);
    eligibleIds = eligibleIds.filter(function(id){ return !taken.has(id); });
    // Build eligible list
    eligibleIds.forEach(function(id){ sel.appendChild(create('option', { value:String(id) }, teamName(id))); });
    // Add remaining (disabled)
    state.teams.forEach(function(t){
      if(eligibleIds.indexOf(t.id)===-1){
        var o = create('option', { value:String(t.id) }, '• '+teamName(t.id)+' (played/taken)'); o.disabled = true; sel.appendChild(o);
      }
    });
    // restore
    // restore only if still valid and enabled; else reset to placeholder
if (keepVal) {
  var opt = sel.querySelector('option[value="' + keepVal + '"]');
  sel.value = (opt && !opt.disabled) ? keepVal : '';
} else {
  sel.value = '';
}

  }
  rebuild(aSel, bVal && bVal!=='BYE' ? bVal : null);
  rebuild(bSel, aVal && aVal!=='BYE' ? aVal : null);
}

// Persist manual selections immediately so Export JSON captures them.
function updateManualMatchOnChange(roundNo, idx){
  var r = state.schedule.find(function(x){return x.round===roundNo;}); if(!r) return;
  var m = r.matches[idx]; if(!m || m.isBye) return;

  var aSel = el('#aSel-'+roundNo+'-'+idx);
  var bSel = el('#bSel-'+roundNo+'-'+idx);
  var aVal = aSel && aSel.value ? aSel.value : '';
  var bVal = bSel && bSel.value ? bSel.value : '';
  if(!aVal || !bVal) return;
  if(aVal === bVal) return;

  var aId = aVal==='BYE' ? 'BYE' : parseInt(aVal,10);
  var bId = bVal==='BYE' ? 'BYE' : parseInt(bVal,10);
  if(aId === 'BYE' || bId === 'BYE') return; // BYE only on the bye row

  // Don’t allow conflict with bye or double-use this round
  if (r.bye && (aId===r.bye.a || aId===r.bye.b || bId===r.bye.a || bId===r.bye.b)) return;
  var used = new Set();
  r.matches.forEach(function(mm, i){
    if(mm.isBye || i===idx) return;
    if(mm.a!=null) used.add(mm.a);
    if(mm.b!=null) used.add(mm.b);
  });
  if(used.has(aId) || used.has(bId)) return;

  m.a = aId; m.b = bId; // persist pairing
  persist();
}

function renderSchedule(){
  var holder = el('#poolSchedule');
  holder.innerHTML='';
  if(state.schedule.length===0) return;

  state.schedule.forEach(function(r){
    // One card per round
    var wrap = create('div', { class:'card', id:'round-'+r.round });
    wrap.appendChild(create('h3', {}, 'Round ' + r.round));

    r.matches.forEach(function(m, idx){
      // One row per match
      var row = create('div', { class:'match', id:'match-'+r.round+'-'+idx });

      /**********************
       * BYE ROW
       **********************/
      if (m.isBye){
        // bye row spans full width visually
        var byeWrap = create('div', { class:'byeRow' });

        byeWrap.appendChild(create('strong', {}, 'Bye game'));

        var aSelB = buildSelect('byeA-'+r.round, false, 'Select team A (rest)');
        var bSelB = buildSelect('byeB-'+r.round, false, 'Select team B (rest)');

        // restore previous bye picks if they exist
        if (r.bye && r.bye.a != null) aSelB.value = String(r.bye.a);
        if (r.bye && r.bye.b != null) bSelB.value = String(r.bye.b);

        byeWrap.appendChild(aSelB);
        byeWrap.appendChild(create('span', { class:'mono' }, 'and'));
        byeWrap.appendChild(bSelB);
        byeWrap.appendChild(create('span', { class:'muted tiny' }, ' — these two teams rest; no scores recorded'));

        // (optional assist) keep bye dropdowns legal and auto-save when both chosen
        if (typeof applyEligibilityForBye === 'function') {
          function persistByeLive(){
            var rr = state.schedule.find(function(x){return x.round===r.round;});
            if (!rr) return;
            applyEligibilityForBye(r.round); // refresh disables, etc.

            var aVal = aSelB.value;
            var bVal = bSelB.value;
            if (aVal && bVal && aVal !== bVal){
              rr.bye = { a: parseInt(aVal,10), b: parseInt(bVal,10) };
              persist();
            }
          }
          applyEligibilityForBye(r.round);
          aSelB.addEventListener('change', persistByeLive);
          bSelB.addEventListener('change', persistByeLive);
        }

        row.appendChild(byeWrap);
        wrap.appendChild(row);
        return; // done with this row
      }

      /**********************
       * SCORE INPUTS
       * (we build them first so we can insert them in the right place)
       **********************/
      var aValForInput = (m.aScore!=null ? m.aScore : '');
      var bValForInput = (m.bScore!=null ? m.bScore : '');

      var aIn = create('input', {
        type:'number',
        min:'0',
        value:aValForInput,
        placeholder:'A score',
        id:'aScore-'+r.round+'-'+idx,
        class:'scoreInput'
      });

      var bIn = create('input', {
        type:'number',
        min:'0',
        value:bValForInput,
        placeholder:'B score',
        id:'bScore-'+r.round+'-'+idx,
        class:'scoreInput'
      });

      /**********************
       * TEAM / MATCH DISPLAY
       * We now build:
       *   <div class="teamA"> [Team A select or name] [A score below] </div>
       *   <div class="vs">vs</div>
       *   <div class="teamB"> [Team B select or name] [B score below] </div>
       **********************/
      if (m.a===null || m.b===null){
        // Manual mode: still picking teams
        var aSel = buildSelect('aSel-'+r.round+'-'+idx, true, 'Pick team A');
        var bSel = buildSelect('bSel-'+r.round+'-'+idx, true, 'Pick team B');

        // Team A column = dropdown then A's score box under it
        var teamABox = create('div', { class:'teamA' }, [
          aSel,
          aIn
        ]);

        // Team B column = dropdown then B's score box under it
        var teamBBox = create('div', { class:'teamB' }, [
          bSel,
          bIn
        ]);

        var vsBox = create('div', { class:'vs mono' }, 'vs');

        row.appendChild(teamABox);
        row.appendChild(vsBox);
        row.appendChild(teamBBox);

        // Manual assist listeners (prevent duplicate teams, rematches, etc.)
        aSel.addEventListener('change', function(){
          if (typeof applyEligibilityForRow === 'function') applyEligibilityForRow(r.round, idx);
          if (typeof updateManualMatchOnChange === 'function') updateManualMatchOnChange(r.round, idx);
        });
        bSel.addEventListener('change', function(){
          if (typeof applyEligibilityForRow === 'function') applyEligibilityForRow(r.round, idx);
          if (typeof updateManualMatchOnChange === 'function') updateManualMatchOnChange(r.round, idx);
        });

        if (typeof applyEligibilityForRow === 'function') applyEligibilityForRow(r.round, idx);

      } else {
        // Locked pairing: names instead of dropdowns
        var teamABoxLocked = create('div', { class:'teamA' }, [
          create('div', { class:'mono' }, teamName(m.a)),
          aIn
        ]);

        var teamBBoxLocked = create('div', { class:'teamB' }, [
          create('div', { class:'mono' }, teamName(m.b)),
          bIn
        ]);

        var vsBoxLocked = create('div', { class:'vs mono' }, 'vs');

        row.appendChild(teamABoxLocked);
        row.appendChild(vsBoxLocked);
        row.appendChild(teamBBoxLocked);
      }

      /**********************
       * STATUS LINE (FULL WIDTH UNDERNEATH)
       **********************/
      var statusText = m.played
        ? ('Saved. Winner: ' + teamName(m.winnerId) + ' (diff ' + m.diff + ')')
        : '';
      var statusNode = create('div', {
        class:'status tiny muted',
        id:'status-'+r.round+'-'+idx
      }, statusText);

      row.appendChild(statusNode);

      wrap.appendChild(row);
    });

    // Save Round button
    var saveRoundBtn = create('button', { id:'saveRound-'+r.round }, 'Save Round ' + r.round);
    saveRoundBtn.addEventListener('click', function(){
      saveRound(r.round);
      persist();
    });
    wrap.appendChild(saveRoundBtn);

    holder.appendChild(wrap);
  });
}


function saveRound(roundNo){
  var r = state.schedule.find(function(x){return x.round===roundNo;}); if(!r) return;

  var byeSelectA = el('#byeA-'+roundNo);
  var byeSelectB = el('#byeB-'+roundNo);
  if (byeSelectA && byeSelectB) {
    var aValB = byeSelectA.value; var bValB = byeSelectB.value;
    if (!aValB || !bValB) { alert('Pick both bye teams for this round.'); return; }
    if (aValB === bValB) { alert('The two bye teams must be different.'); return; }
    var alreadyByed = teamsWithByeSoFar(roundNo);
    var aIdBye = parseInt(aValB,10), bIdBye = parseInt(bValB,10);
    if (alreadyByed.has(aIdBye) || alreadyByed.has(bIdBye)) { alert('A team can only receive one bye across pool play. Choose different teams.'); return; }
    r.bye = { a: aIdBye, b: bIdBye };
  }

  var appearances = new Map();
  function count(id){ if(id==='BYE') return; appearances.set(id, (appearances.get(id)||0)+1); }
  r.matches.forEach(function(m){ if(!m.isBye){ if(m.a) count(m.a); if(m.b) count(m.b); }});
  if (r.bye && r.bye.a) count(r.bye.a); if (r.bye && r.bye.b) count(r.bye.b);
  appearances.forEach(function(c, id){ if (c > 1) { alert('Team '+teamName(id)+' is scheduled more than once in Round '+roundNo+' (including bye). Adjust pairings/bye.'); throw new Error('dup'); } });

  var priorPairs = seenPairsBefore(roundNo);
  for(var idx=0; idx<r.matches.length; idx++){
    var m = r.matches[idx];
    if(m.isBye) continue;

    if(m.a===null || m.b===null){
      var aSel = el('#aSel-'+roundNo+'-'+idx);
      var bSel = el('#bSel-'+roundNo+'-'+idx);
      if(!aSel || !bSel){ alert('Missing team selects.'); return; }
      var aVal=aSel.value, bVal=bSel.value;
      if(!aVal || !bVal){ alert('Please choose teams for all matches.'); return; }
      if(aVal===bVal){ alert('A team cannot play itself. Choose different teams.'); return; }
      var aId = aVal==='BYE' ? 'BYE' : parseInt(aVal,10);
      var bId = bVal==='BYE' ? 'BYE' : parseInt(bVal,10);
      if (r.bye && (aId===r.bye.a || aId===r.bye.b || bId===r.bye.a || bId===r.bye.b)) { alert('A bye team is currently assigned to a match in this round. Adjust bye or match.'); return; }
      var k = pairKey(aId, bId);
      if(k && priorPairs.has(k)){
        var priorRound = priorPairs.get(k);
        alert('Rematch detected: '+teamName(aId)+' vs '+teamName(bId)+' already played in Round '+priorRound+'.');
        return;
      }
      m.a = aId; m.b = bId;
    }

    var aScore = parseInt(el('#aScore-'+roundNo+'-'+idx).value,10);
    var bScore = parseInt(el('#bScore-'+roundNo+'-'+idx).value,10);

    if(m.a!=='BYE' && m.b!=='BYE'){
      if(Number.isNaN(aScore) || Number.isNaN(bScore)) { alert('Enter scores for match '+(idx+1)+' in Round '+roundNo+'.'); return; }
      if(aScore===bScore){ alert('No ties. Please adjust one score.'); return; }
      if(aScore>bScore){ m.winnerId=m.a; m.diff=aScore-bScore; }
      else { m.winnerId=m.b; m.diff=bScore-aScore; }
      m.aScore=aScore; m.bScore=bScore; m.played=true;
    } else if(m.a==='BYE' && m.b!=='BYE'){
      m.winnerId=m.b; m.diff=0; m.played=true; m.aScore=''; m.bScore='';
    } else if(m.b==='BYE' && m.a!=='BYE'){
      m.winnerId=m.a; m.diff=0; m.played=true; m.aScore=''; m.bScore='';
    }

    var status = el('#status-'+roundNo+'-'+idx);
    if(status) status.textContent = m.played? ('Saved. Winner: '+teamName(m.winnerId)+' (diff '+m.diff+')') : '';
  }
  recomputeStandings();
  renderStandings();
  renderSchedule();
  persist();
}

function recomputeStandings(){
  state.teams.forEach(function(t){ t.wins=0; t.diff=0; });
  state.schedule.forEach(function(r){ r.matches.forEach(function(m){
    if(!m.played) return;
    if(m.a==='BYE' || m.b==='BYE') return;
    var ta = state.teams.find(function(t){return t.id===m.a;});
    var tb = state.teams.find(function(t){return t.id===m.b;});
    if(!ta || !tb) return;
    var d = Math.abs(m.aScore - m.bScore);
    if(m.winnerId===ta.id){ ta.wins+=1; ta.diff+=d; tb.diff-=d; }
    else { tb.wins+=1; tb.diff+=d; ta.diff-=d; }
  }); });
  var rows = state.teams.map(function(t){return { id:t.id, name:t.name, wins:t.wins, diff:t.diff };});
  rows.sort(function(a,b){ return (b.wins - a.wins) || (b.diff - a.diff) || a.name.localeCompare(b.name); });
  state.standings = rows;
}
function renderStandings(){
  recomputeStandings();
  var box = el('#standings');
  if(state.standings.length===0){ box.innerHTML=''; return; }
  var table = create('table', { class:'table' });
  table.appendChild(create('thead', {}, create('tr', {}, [
    create('th', {}, '#'), create('th', {}, 'Team'), create('th', {}, 'Wins'), create('th', {}, 'Point diff')
  ])));
  var tb = create('tbody');
  state.standings.forEach(function(s,i){
    tb.appendChild(create('tr', {}, [
      create('td', {}, String(i+1)), create('td', {}, s.name), create('td', {}, String(s.wins)), create('td', {}, String(s.diff))
    ]));
  });
  table.appendChild(tb);
  box.innerHTML='';
  box.appendChild(create('h3', {}, 'Current standings'));
  box.appendChild(table);
}
function finalizePool(){
  for(var i=0;i<state.schedule.length;i++){
    var r = state.schedule[i];
    if (r.bye && (r.bye.a==null || r.bye.b==null)) return alert('Round '+r.round+' bye teams not selected.');
    for(var j=0;j<r.matches.length;j++){
      var m=r.matches[j];
      if(m.isBye) continue;
      if(!m.played) return alert('Round '+r.round+' has an unsaved match. Use "Save Round '+r.round+'".');
    }
  }
  recomputeStandings();
  state.rankings = state.standings.map(function(s){return s.id;});
  alert('Pool complete. Rankings locked. You can now build the bracket.');
  el('#buildBracket').disabled = false;
  persist();
}

/*****************************
 * 3) Elimination bracket (10 teams)
 *****************************/
function buildBracketFromRankings(){
  var n = state.rankings.length;
  if(n < 10) alert('Bracket expects 10 teams. Fewer teams will be padded with BYE.');
  var seeds = state.rankings.slice(0,10);
  while(seeds.length < 10) seeds.push('BYE');
  state.bracket = {
    playins:[
      { id:'P1', a:seeds[6], b:seeds[9], aScore:'', bScore:'', winner:null },
      { id:'P2', a:seeds[7], b:seeds[8], aScore:'', bScore:'', winner:null }
    ],
    quarters:[
      { id:'Q1', a:seeds[0], b:{from:'P2'}, aScore:'', bScore:'', winner:null },
      { id:'Q2', a:seeds[3], b:seeds[4], aScore:'', bScore:'', winner:null },
      { id:'Q3', a:seeds[2], b:{from:'P1'}, aScore:'', bScore:'', winner:null },
      { id:'Q4', a:seeds[1], b:seeds[5], aScore:'', bScore:'', winner:null }
    ],
    semis:[
      { id:'S1', a:{from:'Q1'}, b:{from:'Q2'}, aScore:'', bScore:'', winner:null },
      { id:'S2', a:{from:'Q3'}, b:{from:'Q4'}, aScore:'', bScore:'', winner:null }
    ],
    final:{ id:'F', a:{from:'S1'}, b:{from:'S2'}, aScore:'', bScore:'', winner:null, sets:[{a:'',b:''},{a:'',b:''},{a:'',b:''}] }
  };
  renderBracket();
  persist();
}
function resolveEntry(entry){
  if(entry==='BYE') return 'BYE';
  if(typeof entry==='number') return teamName(entry);
  if(entry && entry.from){ var w = findWinner(entry.from); return w? w : ('Winner of '+entry.from); }
  return '—';
}
function findWinner(id){
  var b = state.bracket; var all = b.playins.concat(b.quarters).concat(b.semis).concat([b.final]);
  var m = all.find(function(x){return x.id===id;}); if(!m || !m.winner) return null; return teamName(m.winner) || 'BYE';
}
function isByeEntry(entry){ return entry==='BYE'; }
function getEntryId(entry){
  if(typeof entry==='number') return entry;
  if(entry==='BYE') return 'BYE';
  if(entry && entry.from){
    var b = state.bracket; var find = function(ix){ return b.playins.concat(b.quarters).concat(b.semis).concat([b.final]).find(function(x){ return x.id===ix; }); };
    var m = find(entry.from); return (m && m.winner) ? m.winner : null;
  }
  return null;
}
function recordBracketScore(stage, idx, aVal, bVal){
  var st = state.bracket[stage]; var m = Array.isArray(st)? st[idx] : st;
  if(stage==='final') return; // final handled separately
  var a = parseInt(aVal,10), b = parseInt(bVal,10);
  if(Number.isNaN(a) || Number.isNaN(b) || a<0 || b<0) return alert('Enter valid non negative scores.');
  m.aScore=a; m.bScore=b;
  if(isByeEntry(m.a) && !isByeEntry(m.b)) m.winner = getEntryId(m.b);
  else if(!isByeEntry(m.a) && isByeEntry(m.b)) m.winner = getEntryId(m.a);
  else if(a===b) return alert('No ties in elimination.');
  else m.winner = a>b ? getEntryId(m.a) : getEntryId(m.b);
  renderBracket();
  persist();
}
function recordFinalSets(a1,b1,a2,b2,a3,b3){
  var m = state.bracket.final;
  var A = [a1,a2,a3].map(function(x){ return x===''? '' : parseInt(x,10); });
  var B = [b1,b2,b3].map(function(x){ return x===''? '' : parseInt(x,10); });
  if(A[0]==='' || B[0]==='' || A[1]==='' || B[1]==='') return alert('Enter scores for Set 1 and Set 2.');
  function checkSet(a,b,idx){ if(a===b) throw new Error('Set '+(idx+1)+' cannot be a tie.'); if(Number.isNaN(a)||Number.isNaN(b)||a<0||b<0) throw new Error('Scores must be non-negative numbers.'); }
  try{
    checkSet(A[0],B[0],0); checkSet(A[1],B[1],1);
    if(A[0]>B[0] && A[1]>B[1]){ m.winner = getEntryId(m.a); }
    else if(A[0]<B[0] && A[1]<B[1]){ m.winner = getEntryId(m.b); }
    else {
      if(A[2]==='' || B[2]==='') return alert('Match is 1–1. Enter Set 3 scores.');
      checkSet(A[2],B[2],2);
      m.winner = (A[2]>B[2]) ? getEntryId(m.a) : getEntryId(m.b);
    }
  } catch(e){ alert(e.message); return; }
  m.sets = [{a:A[0],b:B[0]},{a:A[1],b:B[1]},{a:A[2],b:B[2]}];
  renderBracket();
  if(m.winner){ el('#champion').innerHTML = '<h2>Champion: <span class="winner">'+teamName(m.winner)+'</span></h2>'; }
  persist();
}
function renderBracket(){
  var b = state.bracket; var box = el('#bracket'); box.innerHTML=''; if(!b) return;
  function col(title, items, stageKey){
    var container = create('div', { class:'bracket-col' });
    container.appendChild(create('h3', {}, title));
    (Array.isArray(items)? items : [items]).forEach(function(m, idx){
      var a = resolveEntry(m.a), bName = resolveEntry(m.b);
      var slot = create('div', { class:'slot' });

      if(stageKey==='final'){
        slot.appendChild(create('div', { class:'mono' }, a+' vs '+bName));
        var f1a = (m.sets && m.sets[0] && m.sets[0].a!=null ? m.sets[0].a : '');
        var f1b = (m.sets && m.sets[0] && m.sets[0].b!=null ? m.sets[0].b : '');
        var f2a = (m.sets && m.sets[1] && m.sets[1].a!=null ? m.sets[1].a : '');
        var f2b = (m.sets && m.sets[1] && m.sets[1].b!=null ? m.sets[1].b : '');
        var f3a = (m.sets && m.sets[2] && m.sets[2].a!=null ? m.sets[2].a : '');
        var f3b = (m.sets && m.sets[2] && m.sets[2].b!=null ? m.sets[2].b : '');
        var r1 = create('div', { class:'row' }, [ create('span', { class:'muted tiny' }, 'Set 1'), create('input', { type:'number', min:'0', value:f1a }), create('input', { type:'number', min:'0', value:f1b }) ]);
        var r2 = create('div', { class:'row' }, [ create('span', { class:'muted tiny' }, 'Set 2'), create('input', { type:'number', min:'0', value:f2a }), create('input', { type:'number', min:'0', value:f2b }) ]);
        var r3 = create('div', { class:'row' }, [ create('span', { class:'muted tiny' }, 'Set 3 (if needed)'), create('input', { type:'number', min:'0', value:f3a }), create('input', { type:'number', min:'0', value:f3b }) ]);
        var save = create('button', {}, 'Save Final');
        save.addEventListener('click', function(){
          var vals = [r1,r2,r3].map(function(rr){ return Array.from(rr.querySelectorAll('input')).map(function(i){return i.value;}); });
          recordFinalSets(vals[0][0],vals[0][1],vals[1][0],vals[1][1],vals[2][0],vals[2][1]);
        });
        var status = create('div', { class:'tiny muted', style:'margin-top:6px;' }, m.winner? ('Winner: '+teamName(m.winner)+' (best of 3)') : '');
        slot.append(r1,r2,r3,save,status);
      } else {
        var va = (m.aScore!=null? m.aScore : '');
        var vb = (m.bScore!=null? m.bScore : '');
        var row1 = create('div', { class:'row' }, [ create('div', { class:'mono' }, a), create('span', { class:'muted tiny' }, 'score'), create('input', { type:'number', min:'0', value:va }) ]);
        var row2 = create('div', { class:'row' }, [ create('div', { class:'mono' }, bName), create('span', { class:'muted tiny' }, 'score'), create('input', { type:'number', min:'0', value:vb }) ]);
        var save2 = create('button', {}, 'Save');
        save2.addEventListener('click', function(){
          var aVal = row1.querySelector('input').value; var bVal = row2.querySelector('input').value;
          recordBracketScore(stageKey, Array.isArray(items)? idx : undefined, aVal, bVal);
        });
        var status2 = create('div', { class:'tiny muted', style:'margin-top:6px;' }, m.winner? ('Winner: '+teamName(m.winner)) : '');
        slot.append(row1,row2,save2,status2);
      }
      container.appendChild(slot);
    });
    return container;
  }
  var grid = create('div', { class:'bracket-row' });
  grid.appendChild(col('Play in', state.bracket.playins, 'playins'));
  grid.appendChild(col('Quarterfinals', state.bracket.quarters, 'quarters'));
  grid.appendChild(col('Semifinals', state.bracket.semis, 'semis'));
  grid.appendChild(col('Final', state.bracket.final, 'final'));
  box.appendChild(grid);
}

/*****************************
 * Wire up UI & Session controls
 *****************************/
if (loadPersisted()){
  renderTeams();
  renderSchedule();
  renderStandings();
  renderBracket();
  syncUIStateFromState(); // <-- add this
}


  // Export / Import / Start fresh
  el('#exportBtn').addEventListener('click', function(){
    var blob = new Blob([localStorage.getItem(STORAGE_KEY) || JSON.stringify({state: state, nextTeamId: nextTeamId})], {type:'application/json'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vtm-session.json'; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);}, 1000);
  });
  el('#importBtn').addEventListener('click', function(){ el('#importFile').click(); });
  el('#importFile').addEventListener('change', function(e){
  var f = e.target.files && e.target.files[0];
  if(!f) return;

  var reader = new FileReader();
  reader.onload = function(){
    try {
      var data = JSON.parse(String(reader.result));
      if(!data || !data.state) throw new Error('Bad file');

      state = data.state;
      nextTeamId = data.nextTeamId || 1;

      persist();

      renderTeams();
      renderSchedule();
      renderStandings();
      renderBracket();
      syncUIStateFromState(); // <-- add this

    } catch(err){
      alert('Invalid JSON.');
    }
  };
  reader.readAsText(f);
});

  el('#freshBtn').addEventListener('click', function(){ if(!confirm('Start fresh? This clears the saved session.')) return; clearPersisted(); location.reload(); });

  // Team form submit handles both Enter and the Add Team button
  el('#teamForm').addEventListener('submit', function(e){
    e.preventDefault();
    var input = el('#teamName'); var name = input.value.trim();
    addTeam(name); input.value=''; input.focus();
  });
  el('#clearTeams').addEventListener('click', function(){
    if(!confirm('Remove all teams?')) return;
    state.teams=[]; nextTeamId=1; state.schedule=[]; state.standings=[]; state.rankings=[]; state.bracket=null;
    renderTeams(); el('#poolSchedule').innerHTML=''; el('#standings').innerHTML=''; el('#bracket').innerHTML=''; el('#champion').innerHTML='';
    el('#buildBracket').disabled=true; el('#finalizePool').disabled=true; persist();
  });

  // Pool controls
  el('#makeSchedule').addEventListener('click', function(){ createSchedule(); });
  el('#resetSchedule').addEventListener('click', function(){ state.schedule=[]; state.standings=[]; state.rankings=[]; el('#poolSchedule').innerHTML=''; el('#standings').innerHTML=''; el('#finalizePool').disabled=true; el('#buildBracket').disabled=true; persist(); });
  el('#finalizePool').addEventListener('click', finalizePool);

  // Bracket controls
  el('#buildBracket').addEventListener('click', buildBracketFromRankings);
  el('#resetBracket').addEventListener('click', function(){ state.bracket=null; el('#bracket').innerHTML=''; el('#champion').innerHTML=''; persist(); });

  // Tests
  el('#runTests').addEventListener('click', runTests);
  renderTeams();

/*****************************
 * Tests (basic, visible in console)
 *****************************/
function logResult(msg, ok){
  var line = document.createElement('div'); line.className = ok? 'pass' : 'fail';
  line.textContent = (ok? 'PASS: ' : 'FAIL: ') + msg; el('#testResults').appendChild(line);
  (ok? console.log : console.error)(line.textContent);
}
function resetAll(){
  state.teams=[]; nextTeamId=1; state.schedule=[]; state.standings=[]; state.rankings=[]; state.bracket=null;
  renderTeams();
  el('#poolSchedule').innerHTML='';
  el('#standings').innerHTML='';
  el('#bracket').innerHTML='';
  el('#champion').innerHTML='';
  el('#buildBracket').disabled=true;
  el('#finalizePool').disabled=true;
  el('#testResults').innerHTML='';
  clearPersisted();
}
function runTests(){
  resetAll();

  // Enter/submit adds a team
  var form = el('#teamForm'); var input = el('#teamName');
  input.value = 'Echo';
  form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
  logResult('Form submit adds team via Enter simulation', state.teams.length===1 && state.teams[0].name==='Echo');

  // Click Add team button adds a team
  input.value = 'Foxtrot';
  el('#addTeam').click();
  logResult('Clicking Add team button adds team', state.teams.length===2 && state.teams[1].name==='Foxtrot');

  // Build a small pool for deterministic checks
  resetAll();
  addTeam('Alpha'); addTeam('Bravo'); addTeam('Charlie'); addTeam('Delta');
  logResult('Added 4 teams', state.teams.length===4);

  // Force 5-round schedule (legacy test path) -> 4 matches + Bye row
  createSchedule(5);
  var fourGamesEach = state.schedule.every(function(r){ return r.matches.filter(function(m){return !m.isBye;}).length===4; });
  var byeRows = state.schedule.every(function(r){ return r.matches.length===5 && r.matches[r.matches.length-1].isBye===true && r.bye && r.bye.a===null && r.bye.b===null; });
  logResult('5-round schedule: exactly 4 matches per round', fourGamesEach);
  logResult('5-round schedule: Bye game present as last row with selectors', byeRows);

  // Save round 1 (enter scores for 4 matches)
  renderSchedule();
  var r1 = state.schedule[0];
  r1.matches.forEach(function(m, idx){
    if(m.isBye) return;
    el('#aScore-1-'+idx).value='21';
    el('#bScore-1-'+idx).value='19';
  });
  // pick two distinct bye teams
  var byeA = el('#byeA-1'), byeB = el('#byeB-1');
  if(byeA && byeB){
    var used = new Set();
    r1.matches.forEach(function(m){ if(!m.isBye){ used.add(m.a); used.add(m.b); } });
    var rest = state.teams.map(function(t){return t.id;}).filter(function(id){ return !used.has(id); });
    if(rest.length>=2){ byeA.value=String(rest[0]); byeB.value=String(rest[1]); }
  }
  saveRound(1);
  var r1Saved = r1.matches.filter(function(m){return !m.isBye;}).every(function(m){return m.played;});
  logResult('Round 1 saved with 4 matches', r1Saved===true);

  // Finalize must fail while unsaved matches remain
  var finalizeBlocked=false; const originalAlertX = window.alert;
  window.alert = function(msg){ if(String(msg).includes('unsaved match')) finalizeBlocked=true; };
  finalizePool(); window.alert = originalAlertX;
  logResult('Finalize blocked when unsaved matches remain', finalizeBlocked===true);

  // Rematch prevention (manual schedule)
  resetAll(); ['A','B','C','D','E','F','G','H','I','J'].forEach(addTeam);
  el('#manualMode').checked = true; createSchedule(4);
  // Round 1: set a known match A vs B
  el('#aSel-1-0').value = String(state.teams[0].id);
  el('#bSel-1-0').value = String(state.teams[1].id);
  el('#aScore-1-0').value='21'; el('#bScore-1-0').value='18';
  // Fill remaining matches
  function fill(r, idx, a,b){ el('#aSel-'+r+'-'+idx).value=String(a); el('#bSel-'+r+'-'+idx).value=String(b); el('#aScore-'+r+'-'+idx).value='21'; el('#bScore-'+r+'-'+idx).value='17'; }
  fill(1,1,state.teams[2].id,state.teams[3].id);
  fill(1,2,state.teams[4].id,state.teams[5].id);
  fill(1,3,state.teams[6].id,state.teams[7].id);
  saveRound(1);
  // Round 2: try to repeat A vs B -> expect block
  el('#aSel-2-0').value = String(state.teams[0].id);
  el('#bSel-2-0').value = String(state.teams[1].id);
  fill(2,1,state.teams[2].id,state.teams[3].id);
  fill(2,2,state.teams[4].id,state.teams[5].id);
  fill(2,3,state.teams[6].id,state.teams[7].id);
  var rematchBlocked=false; const prevAlert2 = window.alert; window.alert=function(m){ if(String(m).includes('Rematch detected')) rematchBlocked=true; };
  saveRound(2); window.alert=prevAlert2;
  logResult('Rematch prevention enforced across rounds', rematchBlocked===true);

  // Auto-schedule flow to finish bracket path quickly
  resetAll(); ['A','B','C','D','E','F','G','H','I','J'].forEach(addTeam);
  el('#manualMode').checked = false; createSchedule(4);
  state.schedule.forEach(function(r){
    r.matches.forEach(function(m, mi){
      if(m.isBye) return; el('#aScore-'+r.round+'-'+mi).value='21'; el('#bScore-'+r.round+'-'+mi).value='19';
    });
    saveRound(r.round);
  });
  finalizePool(); buildBracketFromRankings();
  function simpleAdvance(list, key){ list.forEach(function(mm, i){ if(mm.winner) return; recordBracketScore(key, i, 21, 19); }); }
  simpleAdvance(state.bracket.playins,'playins'); simpleAdvance(state.bracket.quarters,'quarters'); simpleAdvance(state.bracket.semis,'semis');
  renderBracket();
  // Final best-of-3: 2-0
  var finalCol = el('#bracket');
  var inputs = finalCol.querySelectorAll('.bracket-col:last-child input');
  inputs[0].value='25'; inputs[1].value='22'; // Set 1
  inputs[2].value='25'; inputs[3].value='23'; // Set 2
  finalCol.querySelector('.bracket-col:last-child button').click();
  var champSet = !!el('#champion').textContent.includes('Champion');
  logResult('Final best-of-3 determines champion with 2-0', champSet===true);
}
