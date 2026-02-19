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
    state = data.state; nextTeamId = data.nextTeamId || 1; if(typeof state.bracketTeamCount !== 'number') state.bracketTeamCount = 10;
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
  bracketTeamCount: 10,
  bracket: null,
  // When true, pool schedule is being built in manual mode.
  manualSchedule: false
};
var nextTeamId = 1;
var bracketResizeBound = false;
var bracketModalEscHandler = null;


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
function teamName(id){ if(id==='BYE') return 'BYE'; var t=state.teams.find(function(x){return x.id===id;}); return t? t.name : '-'; }
function buildSelect(id, withBye, placeholder){
  var s = create('select', { id:id });
  if(placeholder){
    s.appendChild(create('option', { value:'', disabled:'', selected:'' }, placeholder));
  }
  var src = withBye ? state.teams.concat([{id:'BYE', name:'BYE'}]) : state.teams;
  src.forEach(function(t){ s.appendChild(create('option', { value:String(t.id) }, t.name)); });
  return s;
}
function getMaxBracketTeams(){
  if(Array.isArray(state.rankings) && state.rankings.length > 0) return state.rankings.length;
  if(state.bracket && typeof state.bracket.qualifiers === 'number') return state.bracket.qualifiers;
  return state.teams.length;
}
function clampBracketTeamCount(value, maxCount){
  var limit = Math.max(2, maxCount || 2);
  var n = parseInt(value, 10);
  if(Number.isNaN(n)) n = Math.min(10, limit);
  if(n < 2) n = 2;
  if(n > limit) n = limit;
  return n;
}
function syncBracketTeamControl(){
  var input = el('#bracketTeamCount');
  if(!input) return;

  var maxCount = getMaxBracketTeams();
  var canChoose = maxCount >= 2;
  input.disabled = !canChoose;
  if(!canChoose){
    input.value = '';
    return;
  }

  input.min = '2';
  input.max = String(maxCount);
  state.bracketTeamCount = clampBracketTeamCount(state.bracketTeamCount, maxCount);
  input.value = String(state.bracketTeamCount);
}
function getBracketQualifierCountFromControl(){
  var maxCount = getMaxBracketTeams();
  if(maxCount < 2){
    alert('Need at least 2 teams to build a bracket.');
    return null;
  }

  var input = el('#bracketTeamCount');
  if(!input){
    return askBracketQualifierCount(Math.min(10, maxCount));
  }

  var chosen = clampBracketTeamCount(input.value, maxCount);
  state.bracketTeamCount = chosen;
  input.value = String(chosen);
  return chosen;
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
  syncBracketTeamControl();
}



/*****************************
 * 1) Team registration & check-in
 *****************************/
function addTeam(name){
  if(!name) return;
  if(state.teams.length >= 20){ alert('Max 20 teams.'); return; }
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
  // Built-in formats tuned for quick day-of use (few rounds) rather than full round-robin.
  // 8  -> 4 rounds, 4 matches per round (each team plays 4)
  // 10 -> 5 rounds, 4 matches per round + a dedicated Bye row (2 teams rest each round, no BYE matches)
  // 12 -> 4 rounds, 6 matches per round (each team plays 4)
  // 14 -> 4 rounds, 7 matches per round (each team plays 4)
  // 15 -> 4 rounds, 8 pairings generated; one will be a BYE match each round
  // 16 -> 4 rounds, 8 matches per round (each team plays 4)
  if(teamCount===8)  return { rounds:4, matchesPerRound:4, includeBye:false };
  if(teamCount===10) return { rounds:5, matchesPerRound:4, includeBye:true };
  if(teamCount===12) return { rounds:4, matchesPerRound:6, includeBye:false };

  // Support 6-20 teams (except 10/12 handled above) by running 4 rounds of round-robin pairings.
  // matchesPerRound is half the field (rounded up for odd counts, which creates a BYE match).
  if(teamCount>=6 && teamCount<=20){
    return { rounds:4, matchesPerRound:Math.ceil(teamCount/2), includeBye:false };
  }
  return null; // unsupported
}

function createSchedule(roundCount){ // roundCount optional; when omitted we auto-pick from team count
  // Always schedule all registered teams for pool play.
  var poolTeams = state.teams.slice();
  if(poolTeams.length < 2){ alert('Need at least 2 teams.'); return; }
  var ids = poolTeams.map(function(t){return t.id;});
  var manual = el('#manualMode').checked;

  // Track manual vs auto schedule so render logic can keep dropdowns editable.
  state.manualSchedule = !!manual;

  var fmt = computeFormat(poolTeams.length);
  var autoMode = !roundCount && fmt;
  if(!roundCount && !fmt){
    alert('For now, auto scheduling supports 6-20 teams (with special handling for 10-team bye rounds). You currently have '+poolTeams.length+'.');
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
        opt.textContent = '* ' + t.name + (alreadyByed.has(t.id) ? ' (already had bye)' : ' (taken)');
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
        var o = create('option', { value:String(t.id) }, '* '+teamName(t.id)+' (played/taken)'); o.disabled = true; sel.appendChild(o);
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

  // If either side is blank, treat this match as not set yet.
  if(!aVal || !bVal){
    m.a = null; m.b = null;
    m.aScore = ''; m.bScore = '';
    m.winnerId = null; m.diff = 0; m.played = false;
    persist();
    return;
  }

  if(aVal === bVal){
    // Prevent same team on both sides. Reset the most recently changed dropdown.
    if (aSel && bSel) {
      // Prefer clearing B if it matches A, since B is commonly changed second.
      bSel.value = '';
    }
    m.a = null; m.b = null;
    m.aScore = ''; m.bScore = '';
    m.winnerId = null; m.diff = 0; m.played = false;
    persist();
    return;
  }

  var aId = aVal==='BYE' ? 'BYE' : parseInt(aVal,10);
  var bId = bVal==='BYE' ? 'BYE' : parseInt(bVal,10);
  if(aId === 'BYE' || bId === 'BYE'){
    // BYE is only valid on the dedicated bye row.
    if (aSel) aSel.value = '';
    if (bSel) bSel.value = '';
    m.a = null; m.b = null;
    m.aScore = ''; m.bScore = '';
    m.winnerId = null; m.diff = 0; m.played = false;
    persist();
    return;
  }

  // Don't allow conflict with bye or double-use this round
  if (r.bye && (aId===r.bye.a || aId===r.bye.b || bId===r.bye.a || bId===r.bye.b)){
    if (aSel) aSel.value = '';
    if (bSel) bSel.value = '';
    m.a = null; m.b = null;
    m.aScore = ''; m.bScore = '';
    m.winnerId = null; m.diff = 0; m.played = false;
    persist();
    return;
  }
  var used = new Set();
  r.matches.forEach(function(mm, i){
    if(mm.isBye || i===idx) return;
    if(mm.a!=null) used.add(mm.a);
    if(mm.b!=null) used.add(mm.b);
  });
  if(used.has(aId) || used.has(bId)){
    if (aSel) aSel.value = '';
    if (bSel) bSel.value = '';
    m.a = null; m.b = null;
    m.aScore = ''; m.bScore = '';
    m.winnerId = null; m.diff = 0; m.played = false;
    persist();
    return;
  }

  // If the teams changed, clear any typed scores because they belong to the old pairing.
  var teamsChanged = (m.a!==aId) || (m.b!==bId);
  m.a = aId; m.b = bId;
  if (teamsChanged){
    m.aScore = ''; m.bScore = '';
    m.winnerId = null; m.diff = 0; m.played = false;
  }
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
        byeWrap.appendChild(create('span', { class:'muted tiny' }, ' - these two teams rest; no scores recorded'));

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
      var keepEditable = !!state.manualSchedule && !m.played;

      if (keepEditable){
        // Manual schedule: keep teams editable until the round is saved.
        var aSel = buildSelect('aSel-'+r.round+'-'+idx, true, 'Pick team A');
        var bSel = buildSelect('bSel-'+r.round+'-'+idx, true, 'Pick team B');

        // Restore any existing picks
        if (m.a!=null) aSel.value = String(m.a);
        if (m.b!=null) bSel.value = String(m.b);

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

      } else if (m.a==null || m.b==null) {
        // In auto schedule, this should not happen, but keep a safe fallback.
        var teamABoxEmpty = create('div', { class:'teamA' }, [
          create('div', { class:'mono muted' }, 'Pick teams'),
          aIn
        ]);
        var teamBBoxEmpty = create('div', { class:'teamB' }, [
          create('div', { class:'mono muted' }, 'Pick teams'),
          bIn
        ]);
        var vsBoxEmpty = create('div', { class:'vs mono' }, 'vs');
        row.appendChild(teamABoxEmpty);
        row.appendChild(vsBoxEmpty);
        row.appendChild(teamBBoxEmpty);

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

    if (state.manualSchedule) {
      wrap.appendChild(create('span', { style:'display:inline-block;width:8px;' }, ''));
      var resetRoundBtn = create('button', { class:'secondary', id:'resetRound-'+r.round }, 'Reset Round ' + r.round);
      resetRoundBtn.addEventListener('click', function(){
        resetRoundTeams(r.round);
      });
      wrap.appendChild(resetRoundBtn);
    }

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

function resetRoundTeams(roundNo){
  var r = state.schedule.find(function(x){return x.round===roundNo;});
  if(!r) return;

  r.matches.forEach(function(m){
    if(m.isBye) return;
    m.a = null; m.b = null;
    m.aScore = ''; m.bScore = '';
    m.winnerId = null; m.diff = 0; m.played = false;
  });

  // Clear bye picks for this round, if present
  if(r.bye){ r.bye = { a: null, b: null }; }

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
  state.bracketTeamCount = clampBracketTeamCount(state.bracketTeamCount, state.rankings.length);
  state.bracket = null;
  el('#bracket').innerHTML='';
  el('#champion').innerHTML='';
  syncBracketTeamControl();

  alert('Pool complete. Rankings locked. Set bracket teams, then build the bracket.');
  el('#buildBracket').disabled = false;
  persist();
}

/*****************************
 * 3) Elimination bracket (flexible qualifiers)
 *****************************/
function nextPowerOfTwo(n){
  var size = 1;
  while(size < n) size *= 2;
  return size;
}
function traditionalSeedOrder(size){
  if(size===2) return [1,2];
  var prev = traditionalSeedOrder(size/2);
  var out = [];
  prev.forEach(function(seed){
    out.push(seed);
    out.push(size + 1 - seed);
  });
  return out;
}
function getRoundLabel(teamsInRound){
  if(teamsInRound===2) return 'Final';
  if(teamsInRound===4) return 'Semifinals';
  if(teamsInRound===8) return 'Quarterfinals';
  return 'Round of '+teamsInRound;
}
function allBracketMatches(){
  if(!state.bracket || !Array.isArray(state.bracket.rounds)) return [];
  var out = [];
  state.bracket.rounds.forEach(function(round){
    round.matches.forEach(function(m){ out.push(m); });
  });
  return out;
}
function findBracketMatch(matchId){
  return allBracketMatches().find(function(m){ return m.id===matchId; }) || null;
}
function ensureFinalSets(match){
  if(!match.sets || !Array.isArray(match.sets) || match.sets.length!==3){
    match.sets = [{a:'',b:''},{a:'',b:''},{a:'',b:''}];
  }
}
function clearMatchResult(match){
  match.winner = null;
  match.aScore = '';
  match.bScore = '';
  if(match.sets){
    match.sets = [{a:'',b:''},{a:'',b:''},{a:'',b:''}];
  }
}
function migrateLegacyBracketIfNeeded(){
  if(!state.bracket || Array.isArray(state.bracket.rounds)) return;
  if(Array.isArray(state.bracket.playins) && Array.isArray(state.bracket.quarters) && Array.isArray(state.bracket.semis) && state.bracket.final){
    var legacy = state.bracket;
    ensureFinalSets(legacy.final);
    var qualifiers = state.bracketTeamCount || 10;
    var seedByTeamId = {};
    state.rankings.slice(0, qualifiers).forEach(function(teamId, idx){
      seedByTeamId[String(teamId)] = idx + 1;
    });
    state.bracket = {
      qualifiers: qualifiers,
      seedByTeamId: seedByTeamId,
      rounds: [
        { id:'R1', title:'Play-in', matches:legacy.playins, isFinal:false },
        { id:'R2', title:'Quarterfinals', matches:legacy.quarters, isFinal:false },
        { id:'R3', title:'Semifinals', matches:legacy.semis, isFinal:false },
        { id:'R4', title:'Final', matches:[legacy.final], isFinal:true }
      ]
    };
  } else {
    state.bracket = null;
  }
}
function askBracketQualifierCount(defaultCount){
  var maxCount = state.standings.length || state.rankings.length;
  if(maxCount < 2){
    alert('Need at least 2 teams to build a bracket.');
    return null;
  }
  var suggested = defaultCount || 10;
  if(suggested > maxCount) suggested = maxCount;
  if(suggested < 2) suggested = 2;

  while(true){
    var raw = prompt('How many teams should enter the bracket phase? (2-'+maxCount+')', String(suggested));
    if(raw===null) return null;
    var parsed = parseInt(String(raw).trim(), 10);
    if(!Number.isNaN(parsed) && parsed>=2 && parsed<=maxCount){
      return parsed;
    }
    alert('Enter a whole number from 2 to '+maxCount+'.');
  }
}
function buildBracketFromRankings(){
  if(!Array.isArray(state.rankings) || state.rankings.length<2){
    alert('Finalize pool rankings first.');
    return;
  }

  var qualifiers = getBracketQualifierCountFromControl();
  if(qualifiers===null) return;

  var rankedTeams = state.rankings.slice(0, qualifiers);
  var seedByTeamId = {};
  rankedTeams.forEach(function(teamId, idx){ seedByTeamId[String(teamId)] = idx + 1; });

  var bracketSize = nextPowerOfTwo(rankedTeams.length);
  var seeds = rankedTeams.slice();
  while(seeds.length < bracketSize) seeds.push('BYE');
  var seedOrder = traditionalSeedOrder(bracketSize);
  var positionedSeeds = seedOrder.map(function(seedNumber){
    return seeds[seedNumber - 1] || 'BYE';
  });

  var rounds = [];
  var roundCount = Math.log2(bracketSize);

  for(var r=1; r<=roundCount; r++){
    var teamsInRound = bracketSize / Math.pow(2, r-1);
    var matchCount = teamsInRound / 2;
    var matches = [];

    for(var m=0; m<matchCount; m++){
      var matchId = 'R'+r+'M'+(m+1);
      var match = { id:matchId, aScore:'', bScore:'', winner:null };

      if(r===1){
        match.a = positionedSeeds[m*2];
        match.b = positionedSeeds[m*2+1];
      } else {
        match.a = { from: rounds[r-2].matches[m*2].id };
        match.b = { from: rounds[r-2].matches[m*2+1].id };
      }

      if(r===roundCount){
        match.sets = [{a:'',b:''},{a:'',b:''},{a:'',b:''}];
      }
      matches.push(match);
    }

    rounds.push({
      id: 'R'+r,
      title: getRoundLabel(teamsInRound),
      matches: matches,
      isFinal: (r===roundCount)
    });
  }

  state.bracket = { qualifiers: qualifiers, seedByTeamId: seedByTeamId, rounds: rounds };
  normalizeBracketProgress();
  renderBracket();
  persist();
}
function resolveEntry(entry){
  if(entry==='BYE') return 'BYE';
  if(typeof entry==='number') return teamName(entry);
  if(entry && entry.from){
    var w = findWinner(entry.from);
    return w ? w : ('Winner of '+entry.from);
  }
  return '-';
}
function getSeedForEntry(entry){
  if(!state.bracket || !state.bracket.seedByTeamId) return '';
  var teamId = getEntryId(entry);
  if(typeof teamId!=='number') return '';
  return state.bracket.seedByTeamId[String(teamId)] || '';
}
function findWinner(id){
  var m = findBracketMatch(id);
  if(!m || m.winner==null) return null;
  if(m.winner==='BYE') return 'BYE';
  return teamName(m.winner);
}
function isByeEntry(entry){ return getEntryId(entry)==='BYE'; }
function getEntryId(entry){
  if(typeof entry==='number') return entry;
  if(entry==='BYE') return 'BYE';
  if(entry && entry.from){
    var m = findBracketMatch(entry.from);
    return (m && m.winner!=null) ? m.winner : null;
  }
  return null;
}
function normalizeBracketProgress(){
  if(!state.bracket || !Array.isArray(state.bracket.rounds)) return;

  state.bracket.rounds.forEach(function(round){
    round.matches.forEach(function(m){
      if(round.isFinal) ensureFinalSets(m);

      var aId = getEntryId(m.a);
      var bId = getEntryId(m.b);

      if(aId==null || bId==null){
        clearMatchResult(m);
        return;
      }

      if(aId==='BYE' && bId==='BYE'){
        m.winner = 'BYE';
        m.aScore = '';
        m.bScore = '';
        if(m.sets) m.sets = [{a:'',b:''},{a:'',b:''},{a:'',b:''}];
        return;
      }

      if(aId==='BYE' && bId!=='BYE'){
        m.winner = bId;
        m.aScore = '';
        m.bScore = '';
        if(m.sets) m.sets = [{a:'',b:''},{a:'',b:''},{a:'',b:''}];
        return;
      }
      if(bId==='BYE' && aId!=='BYE'){
        m.winner = aId;
        m.aScore = '';
        m.bScore = '';
        if(m.sets) m.sets = [{a:'',b:''},{a:'',b:''},{a:'',b:''}];
        return;
      }

      if(m.winner!=null && m.winner!==aId && m.winner!==bId){
        clearMatchResult(m);
      }
    });
  });
}
function getBracketRoundContext(matchId){
  if(!state.bracket || !Array.isArray(state.bracket.rounds)) return null;
  for(var r=0; r<state.bracket.rounds.length; r++){
    var round = state.bracket.rounds[r];
    for(var m=0; m<round.matches.length; m++){
      if(round.matches[m].id===matchId){
        return { round: round, roundIndex: r, match: round.matches[m], matchIndex: m };
      }
    }
  }
  return null;
}
function recordBracketScore(matchId, aVal, bVal){
  var m = findBracketMatch(matchId);
  if(!m) return false;

  normalizeBracketProgress();
  var aId = getEntryId(m.a);
  var bId = getEntryId(m.b);

  if(aId==null || bId==null){
    alert('This match is waiting on earlier results.');
    return false;
  }
  if(aId==='BYE' || bId==='BYE'){
    normalizeBracketProgress();
    renderBracket();
    persist();
    return true;
  }

  var a = parseInt(aVal,10), b = parseInt(bVal,10);
  if(Number.isNaN(a) || Number.isNaN(b) || a<0 || b<0){
    alert('Enter valid non negative scores.');
    return false;
  }
  if(a===b){
    alert('No ties in elimination.');
    return false;
  }

  m.aScore = a;
  m.bScore = b;
  m.winner = (a>b) ? aId : bId;

  normalizeBracketProgress();
  renderBracket();
  persist();
  return true;
}
function recordFinalSets(matchId, a1,b1,a2,b2,a3,b3){
  var m = findBracketMatch(matchId);
  if(!m) return false;

  normalizeBracketProgress();
  var aId = getEntryId(m.a);
  var bId = getEntryId(m.b);
  if(aId==null || bId==null){
    alert('Final is waiting on semifinal results.');
    return false;
  }

  if(aId==='BYE' && bId!=='BYE'){
    m.winner = bId;
    renderBracket();
    persist();
    return true;
  }
  if(bId==='BYE' && aId!=='BYE'){
    m.winner = aId;
    renderBracket();
    persist();
    return true;
  }

  ensureFinalSets(m);
  var A = [a1,a2,a3].map(function(x){ return x===''? '' : parseInt(x,10); });
  var B = [b1,b2,b3].map(function(x){ return x===''? '' : parseInt(x,10); });
  if(A[0]==='' || B[0]==='' || A[1]==='' || B[1]===''){
    alert('Enter scores for Set 1 and Set 2.');
    return false;
  }

  function checkSet(a,b,idx){
    if(a===b) throw new Error('Set '+(idx+1)+' cannot be a tie.');
    if(Number.isNaN(a) || Number.isNaN(b) || a<0 || b<0) throw new Error('Scores must be non-negative numbers.');
  }

  try{
    checkSet(A[0],B[0],0);
    checkSet(A[1],B[1],1);
    if(A[0]>B[0] && A[1]>B[1]){ m.winner = aId; }
    else if(A[0]<B[0] && A[1]<B[1]){ m.winner = bId; }
    else {
      if(A[2]==='' || B[2]===''){
        alert('Match is 1-1. Enter Set 3 scores.');
        return false;
      }
      checkSet(A[2],B[2],2);
      m.winner = (A[2]>B[2]) ? aId : bId;
    }
  } catch(e){
    alert(e.message);
    return false;
  }

  m.sets = [{a:A[0],b:B[0]},{a:A[1],b:B[1]},{a:A[2],b:B[2]}];
  renderBracket();
  persist();
  return true;
}
function closeBracketScoreModal(){
  var backdrop = el('#scoreModalBackdrop');
  if(backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  document.body.classList.remove('modal-open');
  if(bracketModalEscHandler){
    document.removeEventListener('keydown', bracketModalEscHandler);
    bracketModalEscHandler = null;
  }
}
function openBracketScoreModal(matchId){
  normalizeBracketProgress();
  var ctx = getBracketRoundContext(matchId);
  if(!ctx) return;
  var round = ctx.round;
  var m = ctx.match;

  closeBracketScoreModal();

  var aId = getEntryId(m.a);
  var bId = getEntryId(m.b);
  var aName = resolveEntry(m.a);
  var bName = resolveEntry(m.b);
  var aSeed = getSeedForEntry(m.a);
  var bSeed = getSeedForEntry(m.b);

  var backdrop = create('div', { class:'score-modal-backdrop', id:'scoreModalBackdrop' });
  var modal = create('div', { class:'score-modal', role:'dialog', 'aria-modal':'true', 'aria-labelledby':'scoreModalTitle' });

  var head = create('div', { class:'score-modal-head' }, [
    create('div', { class:'score-modal-title mono', id:'scoreModalTitle' }, (round.isFinal ? 'Final' : round.title)+' - '+m.id),
    create('button', { type:'button', class:'score-modal-close secondary', 'aria-label':'Close' }, 'x')
  ]);
  head.querySelector('button').addEventListener('click', closeBracketScoreModal);

  var tabs = create('div', { class:'score-modal-tabs' }, [
    create('div', { class:'score-modal-tab' }, 'Match Info'),
    create('div', { class:'score-modal-tab active' }, 'Report Scores')
  ]);

  var body = create('div', { class:'score-modal-body' });
  body.appendChild(create('div', { class:'score-match-meta tiny muted' }, (round.isFinal ? 'Best of 3 sets' : 'Single elimination match')));

  var canSubmit = true;
  if(aId==null || bId==null){
    canSubmit = false;
    body.appendChild(create('div', { class:'score-modal-note' }, 'This match is waiting on earlier round results.'));
  } else if(aId==='BYE' && bId==='BYE'){
    canSubmit = false;
    body.appendChild(create('div', { class:'score-modal-note' }, 'Both entries are BYE. No score entry required.'));
  } else if(aId==='BYE' || bId==='BYE'){
    canSubmit = false;
    body.appendChild(create('div', { class:'score-modal-note' }, 'Auto-advance winner: '+teamName(m.winner)));
  }

  var footer = create('div', { class:'score-modal-actions' });
  var leftActions = create('div', { class:'row' });
  var rightActions = create('div', { class:'row' });
  leftActions.appendChild(create('button', { type:'button', class:'secondary' }, 'Cancel'));
  leftActions.querySelector('button').addEventListener('click', closeBracketScoreModal);
  footer.appendChild(leftActions);
  footer.appendChild(rightActions);

  if(canSubmit){
    if(round.isFinal){
      ensureFinalSets(m);
      var setRows = [];
      var setGrid = create('div', { class:'score-set-grid' });
      for(var setIdx=0; setIdx<3; setIdx++){
        var setLabel = create('div', { class:'tiny muted' }, 'Set '+(setIdx+1));
        var aInput = create('input', { type:'number', min:'0', value:(m.sets[setIdx].a!=null ? m.sets[setIdx].a : ''), class:'score-input' });
        var bInput = create('input', { type:'number', min:'0', value:(m.sets[setIdx].b!=null ? m.sets[setIdx].b : ''), class:'score-input' });
        setRows.push({ a:aInput, b:bInput });
        var row = create('div', { class:'score-set-line' }, [
          setLabel,
          create('div', { class:'score-set-team mono' }, (aSeed ? (aSeed+' ') : '')+aName),
          aInput,
          create('div', { class:'score-set-team mono' }, (bSeed ? (bSeed+' ') : '')+bName),
          bInput
        ]);
        setGrid.appendChild(row);
      }
      body.appendChild(setGrid);

      var submitFinal = create('button', { type:'button' }, 'Submit Scores');
      submitFinal.addEventListener('click', function(){
        var ok = recordFinalSets(
          m.id,
          setRows[0].a.value, setRows[0].b.value,
          setRows[1].a.value, setRows[1].b.value,
          setRows[2].a.value, setRows[2].b.value
        );
        if(ok) closeBracketScoreModal();
      });
      rightActions.appendChild(submitFinal);
    } else {
      function buildTeamRow(seed, name, value){
        return create('div', { class:'score-team-row' }, [
          create('div', { class:'score-team-seed mono' }, seed ? String(seed) : ''),
          create('div', { class:'score-team-name mono' }, name),
          create('input', { type:'number', min:'0', value:value, class:'score-input' })
        ]);
      }

      var rowA = buildTeamRow(aSeed, aName, (m.aScore!=null ? m.aScore : ''));
      var rowB = buildTeamRow(bSeed, bName, (m.bScore!=null ? m.bScore : ''));
      body.appendChild(rowA);
      body.appendChild(rowB);

      var submit = create('button', { type:'button' }, 'Submit Scores');
      submit.addEventListener('click', function(){
        var aVal = rowA.querySelector('input').value;
        var bVal = rowB.querySelector('input').value;
        var ok = recordBracketScore(m.id, aVal, bVal);
        if(ok) closeBracketScoreModal();
      });
      rightActions.appendChild(submit);
    }
  }

  modal.appendChild(head);
  modal.appendChild(tabs);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);

  backdrop.addEventListener('click', function(e){
    if(e.target===backdrop) closeBracketScoreModal();
  });

  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  bracketModalEscHandler = function(ev){
    if(ev.key==='Escape') closeBracketScoreModal();
  };
  document.addEventListener('keydown', bracketModalEscHandler);
}
function drawBracketConnectors(){
  var shell = el('#bracket .bracket-shell');
  if(!shell || !state.bracket || !Array.isArray(state.bracket.rounds)) return;

  var grid = shell.querySelector('.bracket-grid');
  var svg = shell.querySelector('.bracket-connectors');
  if(!grid || !svg) return;

  var rounds = state.bracket.rounds;
  var rect = grid.getBoundingClientRect();
  var width = Math.max(1, Math.ceil(rect.width));
  var height = Math.max(1, Math.ceil(rect.height));

  svg.setAttribute('viewBox', '0 0 '+width+' '+height);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.innerHTML = '';

  if(rounds.length < 2) return;

  function getAnchorY(matchEl){
    var stageWrap = matchEl.parentNode;
    var y = parseFloat(matchEl.getAttribute('data-anchor-y'));
    if(stageWrap && !Number.isNaN(y)){
      var stageRect = stageWrap.getBoundingClientRect();
      return (stageRect.top - rect.top) + y;
    }
    var box = matchEl.getBoundingClientRect();
    return (box.top + box.height/2) - rect.top;
  }

  for(var r=0; r<rounds.length-1; r++){
    var currentRound = rounds[r];
    var nextRound = rounds[r+1];
    for(var i=0; i<currentRound.matches.length; i++){
      var fromMatch = currentRound.matches[i];
      var toMatch = nextRound.matches[Math.floor(i/2)];
      if(!toMatch) continue;

      var src = grid.querySelector('[data-match-id="'+fromMatch.id+'"]');
      var dst = grid.querySelector('[data-match-id="'+toMatch.id+'"]');
      if(!src || !dst) continue;

      var sRect = src.getBoundingClientRect();
      var dRect = dst.getBoundingClientRect();
      var x1 = sRect.right - rect.left;
      var y1 = getAnchorY(src);
      var x4 = dRect.left - rect.left;
      var y4 = getAnchorY(dst);

      var elbow = x1 + Math.max(24, (x4 - x1) * 0.45);
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'bracket-link');
      path.setAttribute('d', 'M'+x1+' '+y1+' L'+elbow+' '+y1+' L'+elbow+' '+y4+' L'+x4+' '+y4);
      svg.appendChild(path);
    }
  }
}
function renderBracket(){
  migrateLegacyBracketIfNeeded();
  normalizeBracketProgress();
  syncBracketTeamControl();

  var b = state.bracket;
  var box = el('#bracket');
  box.innerHTML='';
  if(!b || !Array.isArray(b.rounds) || b.rounds.length===0) return;

  var shell = create('div', { class:'bracket-shell' });
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'bracket-connectors');
  svg.setAttribute('aria-hidden', 'true');

  var grid = create('div', { class:'bracket-grid' });

  var cardHeight = 112;
  var firstRoundGap = 40;
  var topPadding = 18;
  var bottomPadding = 24;
  var centers = [];

  centers[0] = Array.from({length: b.rounds[0].matches.length}, function(_, i){
    return topPadding + (i * (cardHeight + firstRoundGap)) + (cardHeight / 2);
  });
  for(var lr=1; lr<b.rounds.length; lr++){
    var prev = centers[lr-1];
    centers[lr] = Array.from({length: b.rounds[lr].matches.length}, function(_, i){
      return (prev[i*2] + prev[(i*2)+1]) / 2;
    });
  }

  b.rounds.forEach(function(round, roundIdx){
    var stage = create('section', { class:'bracket-stage', 'data-round-index': String(roundIdx) });
    stage.appendChild(create('h3', { class:'bracket-stage-title sr-only' }, round.title));

    var matchesWrap = create('div', { class:'bracket-stage-matches' });
    var anchors = centers[roundIdx];
    var maxCenter = anchors.length ? anchors[anchors.length-1] : (topPadding + cardHeight/2);
    matchesWrap.style.height = String(Math.ceil(maxCenter + (cardHeight/2) + bottomPadding))+'px';

    round.matches.forEach(function(m, matchIdx){
      var aName = resolveEntry(m.a);
      var bName = resolveEntry(m.b);
      var aSeed = getSeedForEntry(m.a);
      var bSeed = getSeedForEntry(m.b);
      var cardTop = Math.round(anchors[matchIdx] - (cardHeight / 2));
      var card = create('article', { class:'bracket-match', 'data-match-id': m.id, 'data-anchor-y': String(Math.round(anchors[matchIdx])) });
      card.style.position = 'absolute';
      card.style.top = String(cardTop)+'px';
      card.style.left = '0';

      var face = create('div', { class:'bracket-match-card' }, [
        create('div', { class:'bracket-team-row' }, [
          create('div', { class:'mono bracket-seed' }, aSeed ? String(aSeed) : ''),
          create('div', { class:'mono bracket-team-name' }, aName)
        ]),
        create('div', { class:'bracket-team-row' }, [
          create('div', { class:'mono bracket-seed' }, bSeed ? String(bSeed) : ''),
          create('div', { class:'mono bracket-team-name' }, bName)
        ])
      ]);

      var metaLeft = round.isFinal ? 'Best of 3 sets' : 'Single match';
      var metaRight = '';
      if(m.winner && m.winner!=='BYE') metaRight = 'Winner: '+teamName(m.winner);
      else if(m.winner==='BYE') metaRight = 'Auto-advance';

      var footer = create('div', { class:'bracket-match-footer' }, [
        create('div', { class:'bracket-match-meta' }, [
          create('div', { class:'tiny muted' }, metaLeft),
          create('div', { class:'tiny muted' }, metaRight)
        ]),
        create('button', { type:'button', class:'bracket-report-btn secondary' }, round.isFinal ? 'Report sets' : 'Report score')
      ]);
      footer.querySelector('button').addEventListener('click', function(){ openBracketScoreModal(m.id); });

      card.appendChild(face);
      card.appendChild(footer);
      matchesWrap.appendChild(card);
    });

    stage.appendChild(matchesWrap);
    grid.appendChild(stage);
  });

  shell.appendChild(svg);
  shell.appendChild(grid);
  box.appendChild(shell);

  if(!bracketResizeBound){
    window.addEventListener('resize', function(){
      if(state.bracket) drawBracketConnectors();
    });
    bracketResizeBound = true;
  }
  requestAnimationFrame(drawBracketConnectors);

  var finalRound = b.rounds[b.rounds.length-1];
  var finalMatch = finalRound && finalRound.matches ? finalRound.matches[0] : null;
  if(finalMatch && finalMatch.winner && finalMatch.winner!=='BYE'){
    el('#champion').innerHTML = '<h2>Champion: <span class="winner">'+teamName(finalMatch.winner)+'</span></h2>';
  } else {
    el('#champion').innerHTML = '';
  }
}

/*****************************
 * Wire up UI & Session controls
 *****************************/
if (loadPersisted()){
  if(typeof state.bracketTeamCount !== 'number') state.bracketTeamCount = 10;
  migrateLegacyBracketIfNeeded();
  renderTeams();
  renderSchedule();
  renderStandings();
  renderBracket();
  syncUIStateFromState();
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
      if(typeof state.bracketTeamCount !== 'number') state.bracketTeamCount = 10;
      migrateLegacyBracketIfNeeded();

      persist();

      renderTeams();
      renderSchedule();
      renderStandings();
      renderBracket();
      syncUIStateFromState();

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
    closeBracketScoreModal();
    state.teams=[]; nextTeamId=1; state.schedule=[]; state.standings=[]; state.rankings=[]; state.bracketTeamCount=10; state.bracket=null;
    renderTeams(); el('#poolSchedule').innerHTML=''; el('#standings').innerHTML=''; el('#bracket').innerHTML=''; el('#champion').innerHTML='';
    el('#buildBracket').disabled=true; el('#finalizePool').disabled=true; syncUIStateFromState(); persist();
  });

  // Pool controls
  el('#makeSchedule').addEventListener('click', function(){ createSchedule(); });
  el('#resetSchedule').addEventListener('click', function(){ closeBracketScoreModal(); state.schedule=[]; state.standings=[]; state.rankings=[]; el('#poolSchedule').innerHTML=''; el('#standings').innerHTML=''; el('#finalizePool').disabled=true; el('#buildBracket').disabled=true; syncUIStateFromState(); persist(); });
  el('#finalizePool').addEventListener('click', finalizePool);

  // Bracket controls
  function onBracketTeamCountChange(){
    var input = el('#bracketTeamCount');
    if(!input) return;
    var maxCount = getMaxBracketTeams();
    var chosen = clampBracketTeamCount(input.value, maxCount);
    state.bracketTeamCount = chosen;
    input.value = String(chosen);
    persist();
  }
  el('#bracketTeamCount').addEventListener('change', onBracketTeamCountChange);
  el('#buildBracket').addEventListener('click', buildBracketFromRankings);
  el('#resetBracket').addEventListener('click', function(){ closeBracketScoreModal(); state.bracket=null; el('#bracket').innerHTML=''; el('#champion').innerHTML=''; syncUIStateFromState(); persist(); });

  // Tests
  el('#runTests').addEventListener('click', runTests);
  renderTeams();
  syncUIStateFromState();

/*****************************
 * Tests (basic, visible in console)
 *****************************/
function logResult(msg, ok){
  var line = document.createElement('div'); line.className = ok? 'pass' : 'fail';
  line.textContent = (ok? 'PASS: ' : 'FAIL: ') + msg; el('#testResults').appendChild(line);
  (ok? console.log : console.error)(line.textContent);
}
function resetAll(){
  closeBracketScoreModal();
  state.teams=[]; nextTeamId=1; state.schedule=[]; state.standings=[]; state.rankings=[]; state.bracketTeamCount=10; state.bracket=null;
  renderTeams();
  el('#poolSchedule').innerHTML='';
  el('#standings').innerHTML='';
  el('#bracket').innerHTML='';
  el('#champion').innerHTML='';
  el('#buildBracket').disabled=true;
  el('#finalizePool').disabled=true;
  el('#testResults').innerHTML='';
  syncUIStateFromState();
  clearPersisted();
}
function getRequestedTestTeamCount(){
  var input = el('#testTeamCount');
  var count = input ? parseInt(input.value,10) : 10;
  if(Number.isNaN(count)) count = 10;
  if(count < 8) count = 8;
  if(count > 20) count = 20;
  if(input) input.value = String(count);
  return count;
}
function getRequestedTestBracketCount(maxCount){
  var input = el('#testBracketCount');
  var count = input ? parseInt(input.value,10) : 8;
  if(Number.isNaN(count)) count = Math.min(8, maxCount);
  if(count < 2) count = 2;
  if(count > maxCount) count = maxCount;
  if(input) input.value = String(count);
  return count;
}
function buildTestTeamNames(count){
  var names = [];
  for(var i=1;i<=count;i++) names.push('T'+i);
  return names;
}
function addAndCheckTeams(names){
  names.forEach(function(name){
    addTeam(name);
    var t = state.teams[state.teams.length-1];
    if(t) t.checked = true;
  });
  renderTeams();
  persist();
}
function runTests(){
  var testTeamCount = getRequestedTestTeamCount();
  var requestedBracketCount = getRequestedTestBracketCount(testTeamCount);
  var testTeamNames = buildTestTeamNames(testTeamCount);
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
  addAndCheckTeams(['Alpha','Bravo','Charlie','Delta']);
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
  resetAll(); addAndCheckTeams(['A','B','C','D','E','F','G','H']);
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

  // Auto-schedule flow with variable pool team count and bracket qualifiers
  resetAll(); addAndCheckTeams(testTeamNames);
  el('#manualMode').checked = false; createSchedule();
  var fmt = computeFormat(testTeamCount);
  var expectedMatchesPerRound = fmt ? fmt.matchesPerRound : Math.ceil(testTeamCount/2);
  var poolUsesAllTeams = state.schedule.every(function(r){
    return r.matches.filter(function(m){ return !m.isBye; }).length === expectedMatchesPerRound;
  });
  logResult('Pool auto-schedule uses configured team count per round', poolUsesAllTeams===true);

  state.schedule.forEach(function(r){
    r.matches.forEach(function(m, mi){
      if(m.isBye) return;
      if(m.a==='BYE' || m.b==='BYE') return;
      el('#aScore-'+r.round+'-'+mi).value='21';
      el('#bScore-'+r.round+'-'+mi).value='19';
    });
    var byeA = el('#byeA-'+r.round), byeB = el('#byeB-'+r.round);
    if(byeA && byeB){
      var used = new Set();
      r.matches.forEach(function(m){
        if(m.isBye) return;
        if(m.a && m.a!=='BYE') used.add(m.a);
        if(m.b && m.b!=='BYE') used.add(m.b);
      });
      var resting = state.teams.map(function(t){ return t.id; }).filter(function(id){ return !used.has(id); });
      if(resting.length>=2){
        byeA.value = String(resting[0]);
        byeB.value = String(resting[1]);
      }
    }
    saveRound(r.round);
  });

  finalizePool();
  var qualifierCount = Math.max(2, Math.min(requestedBracketCount, state.rankings.length));
  el('#bracketTeamCount').value = String(qualifierCount);

  buildBracketFromRankings();
  logResult('Bracket uses configured qualifier count', !!state.bracket && state.bracket.qualifiers===qualifierCount);
  state.bracket.rounds.forEach(function(round){
    if(round.isFinal) return;
    round.matches.forEach(function(mm){
      if(mm.winner) return;
      var aId = getEntryId(mm.a);
      var bId = getEntryId(mm.b);
      if(aId==null || bId==null) return;
      if(aId==='BYE' || bId==='BYE') return;
      recordBracketScore(mm.id, 21, 19);
    });
  });
  renderBracket();
  // Final best-of-3: 2-0
  var finalRound = state.bracket.rounds[state.bracket.rounds.length-1];
  var finalMatch = finalRound && finalRound.matches ? finalRound.matches[0] : null;
  if(finalMatch){
    recordFinalSets(finalMatch.id, 25,22, 25,23, '', '');
  }
  var champSet = !!el('#champion').textContent.includes('Champion');
  logResult('Final best-of-3 determines champion with 2-0', champSet===true);
}

