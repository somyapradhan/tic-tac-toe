console.log('[client] boot test page');
window.addEventListener('error', (e)=>{
  try { console.error('[client] window error', e?.message || e); } catch {}
});

const BASE_URL = window.location.origin;
let sock;
let currentGameId = null;
let lastState = null;
let token = localStorage.getItem('ttt_token') || null;
let user = token ? parseJwt(token) : null;
let myMark = null; // 'X' or 'O'
let opponent = null; // { id, username }
let opponentName = null;

function formatWithMark(username, mark){
  return `${username} (${mark})`;
}
let joinTimer = null;

function parseJwt(t){
  try{ const p = t.split('.')[1]; return JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')));}catch(e){ return null; }
}

function drawGrid(state){
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const board = state?.board || Array(9).fill(null);
  const win = computeWin(board);
  board.forEach((val, idx)=>{
    const d=document.createElement('div');
    d.className='cell' + (win?.indexes?.includes(idx)?' win':'');
    d.textContent = val || '';
    d.onclick = ()=>{
      if(!currentGameId) return;
      if(!user){ alert('Login first'); return; }
      sock.emit('game:move', { gameId: currentGameId, playerId: user.id, index: idx });
    };
    grid.appendChild(d);
  });
  drawStrike(win);
  updateStatus(state, win);
}

function connectSocket(){
  if (sock && sock.connected) return;
  // Use server-served Socket.IO client; transports default
  sock = io(BASE_URL, { auth: token ? { token } : undefined });
  sock.on('connect', ()=>{ console.log('[client] connected', sock.id); startAutoJoin(); autoJoin(); });
  sock.on('connect_error', (e)=>{ console.warn('[client] connect_error', e?.message || e); });
  sock.on('matchmaking:queued', ()=>{ console.log('[client] queued'); });
  sock.on('game:matched', (d)=>{
    currentGameId = d.gameId;
    const px = d.players?.X; const po = d.players?.O;
    if (px && po && user) {
      if (px.id === user.id) { myMark = 'X'; opponent = po; }
      else if (po.id === user.id) { myMark = 'O'; opponent = px; }
    }
    // Compute names with marks
    const other = myMark === 'X' ? d.players?.O : d.players?.X;
    const otherMark = myMark === 'X' ? 'O' : 'X';
    const otherU = other?.username || opponent?.username || 'opponent';
    opponentName = formatWithMark(otherU, otherMark);
    setStatus(`Matched with ${opponentName} · You are ${myMark}`);
    showToast(`Matched with ${opponentName}`);
    stopAutoJoin();
    const bar = document.getElementById('bottomBar'); if (bar) bar.style.display='none';
  });
  sock.on('game:state', (s)=>{ lastState = s; drawGrid(s); });
  sock.on('game:ended', (d)=>{
    if (!lastState) return;
    const outcome = lastState.winner; // 'X' | 'O' | 'draw'
    if (outcome === 'draw') {
      setStatus('Game ended in a draw');
      showToast('Game ended in a draw');
      document.getElementById('bottomBar').style.display = '';
      return;
    }
    if (outcome === myMark) { setStatus('You won!'); showToast('You won!'); }
    else { setStatus('You lost.'); showToast('You lost.'); }
    document.getElementById('bottomBar').style.display = '';
  });
}

function autoJoin(){
  if(!user){ return; }
  if(!currentGameId){ sock.emit('matchmaking:join', { playerId: user.id, username: user.username }); }
}

function startAutoJoin(){
  stopAutoJoin();
  joinTimer = setInterval(()=>{
    if (!currentGameId && sock && sock.connected) autoJoin();
  }, 3000);
}
function stopAutoJoin(){ if (joinTimer) { clearInterval(joinTimer); joinTimer = null; } }

function logout(){ token=null; user=null; localStorage.removeItem('ttt_token'); try{ sock?.disconnect(); }catch{} window.location.href = '/'; }

function setStatus(text){ const el = document.getElementById('statusText'); if (el) el.textContent = text; }

function updateStatus(state, win){
  if (!state) { setStatus('Matching with a player...'); return; }
  if (state.status === 'active') {
    const yourTurn = myMark && state.currentTurn === myMark;
    const opp = opponentName || (opponent ? formatWithMark(opponent.username, myMark === 'X' ? 'O' : 'X') : 'opponent');
    setStatus(`${opp} vs You · ${yourTurn ? 'Your turn' : "Opponent's turn"}`);
  } else if (state.status === 'completed') {
    if (state.winner === 'draw') setStatus('Game ended in a draw');
    else if (state.winner === myMark) setStatus('You won!');
    else setStatus('You lost.');
  } else {
    setStatus('Matching with a player...');
  }
}

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];
function computeWin(board){
  for (let i=0; i<WIN_LINES.length; i++){
    const [a,b,c] = WIN_LINES[i];
    if (board[a] && board[a]===board[b] && board[a]===board[c]){
      return { indexes:[a,b,c], line:i };
    }
  }
  return null;
}
function drawStrike(win){
  const strike = document.getElementById('strike');
  if (!strike) return;
  if (!win) { strike.className='strike'; strike.style.opacity='0'; return; }
  const line = win.line;
  const grid = document.getElementById('grid');
  const rect = grid.getBoundingClientRect();
  const width = rect.width; const height = rect.height;
  strike.style.opacity='1';
  strike.style.left = '0px';
  strike.style.top = '0px';
  strike.style.width = width + 'px';
  strike.style.height = '6px';
  strike.style.transform = 'none';
  if (line===0||line===1||line===2){
    const y = (line*1 + 0.5) * (height/3);
    strike.style.top = (y - 3) + 'px';
    strike.style.transform = 'none';
  } else if (line===3||line===4||line===5){
    const x = ((line-3)*1 + 0.5) * (width/3);
    strike.style.left = (x - 3) + 'px';
    strike.style.width = '6px';
    strike.style.height = height + 'px';
  } else if (line===6){
    const len = Math.sqrt(width*width + height*height);
    strike.style.width = len + 'px';
    strike.style.left = '0px';
    strike.style.top = '0px';
    strike.style.transformOrigin = 'left top';
    strike.style.transform = 'rotate(45deg) translateY(-3px)';
  } else if (line===7){
    const len = Math.sqrt(width*width + height*height);
    strike.style.width = len + 'px';
    strike.style.left = width + 'px';
    strike.style.top = '0px';
    strike.style.transformOrigin = 'left top';
    strike.style.transform = 'rotate(-45deg) translate(-100%, -3px)';
  }
}

function showToast(message){
  const container = document.getElementById('toast');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 't';
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(()=> el.classList.add('show'));
  setTimeout(()=>{
    el.classList.remove('show');
    setTimeout(()=>{ try{ container.removeChild(el); }catch{} }, 200);
  }, 2500);
}

function playAgain(){
  currentGameId = null;
  lastState = null;
  myMark = null;
  opponent = null;
  drawGrid(null);
  setStatus('Matching with a player...');
  const bar = document.getElementById('bottomBar');
  if (bar) bar.style.display = 'none';
  startAutoJoin();
  autoJoin();
}

function init(){
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  document.getElementById('playAgainBtn')?.addEventListener('click', playAgain);
  if(!user){ window.location.href = '/'; return; }
  connectSocket();
  drawGrid(null);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
