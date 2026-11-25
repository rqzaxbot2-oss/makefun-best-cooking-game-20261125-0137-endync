(() => {
  const W = 1200, H = 720;
  const ING = [
    { id: 'brioche', name: 'Brioche', key: '1', prep: 'raw', col: '#e2a34b', acc: '#f8d594' },
    { id: 'wagyu', name: 'Wagyu', key: '2', prep: 'sear', col: '#c94c4c', acc: '#7a2a1d' },
    { id: 'tomato', name: 'Tomato', key: '3', prep: 'chop', col: '#e63946', acc: '#ff9b85' },
    { id: 'basil', name: 'Basil', key: '4', prep: 'chop', col: '#2d9348', acc: '#74c69d' },
    { id: 'salmon', name: 'Salmon', key: '5', prep: 'sear', col: '#f28466', acc: '#ffd1be' },
    { id: 'noodle', name: 'Pasta', key: '6', prep: 'boil', col: '#f4d35e', acc: '#fff0b3' },
    { id: 'truffle', name: 'Truffle', key: '7', prep: 'raw', col: '#ede4d3', acc: '#5c4b3b' },
    { id: 'lemon', name: 'Lemon', key: '8', prep: 'chop', col: '#f7d136', acc: '#fff3a8' }
  ];
  const BY_ID = Object.fromEntries(ING.map(i => [i.id, i]));
  const RECIPES = [
    { id: 'burger', name: 'Ember Smash Burger', price: 28, time: 58, needs: ['brioche:raw', 'wagyu:seared', 'tomato:chopped', 'basil:chopped'] },
    { id: 'salmon', name: 'Saffron Salmon Plate', price: 34, time: 54, needs: ['salmon:seared', 'lemon:chopped', 'basil:chopped'] },
    { id: 'pasta', name: 'Truffle Silk Pasta', price: 30, time: 52, needs: ['noodle:boiled', 'truffle:raw', 'basil:chopped'] },
    { id: 'surf', name: 'Bistro Surf & Herb', price: 42, time: 66, needs: ['salmon:seared', 'noodle:boiled', 'tomato:chopped', 'lemon:chopped'] }
  ];
  const LABEL = { raw: 'Fresh', chopped: 'Sliced', seared: 'Seared', boiled: 'Boiled', burnt: 'Burnt' };
  const NEED_STATE = { raw: 'raw', chop: 'chopped', sear: 'seared', boil: 'boiled' };
  const Z = {
    board: { x: 46, y: 186, w: 235, h: 215 },
    skillet: { x: 306, y: 186, w: 235, h: 215 },
    pot: { x: 566, y: 186, w: 225, h: 215 },
    plate: { x: 816, y: 186, w: 170, h: 215 },
    pass: { x: 1004, y: 186, w: 152, h: 215 },
    trash: { x: 1084, y: 454, w: 84, h: 170 }
  };

  let ac = null, muted = false;
  function ensureAudio() {
    if (muted) return null;
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (C) ac = new C();
    }
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  function tone(f1, dur, type = 'sine', vol = 0.12, f2 = f1, delay = 0) {
    const c = ensureAudio(); if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t);
    if (f2 !== f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, freq, vol = 0.09) {
    const c = ensureAudio(); if (!c) return;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), flt = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; flt.type = 'bandpass'; flt.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(flt); flt.connect(g); g.connect(c.destination); src.start();
  }
  function sfx(k) {
    if (k === 'pick') tone(520, 0.06, 'triangle', 0.1, 680);
    else if (k === 'chop') { noise(0.06, 2200, 0.12); tone(180, 0.05, 'square', 0.06, 90); }
    else if (k === 'sizzle') { noise(0.24, 3400, 0.08); tone(260, 0.1, 'sine', 0.06, 330); }
    else if (k === 'ready') { tone(880, 0.12, 'triangle', 0.11); tone(1320, 0.18, 'triangle', 0.11, 1320, 0.09); }
    else if (k === 'plate') { tone(1180, 0.08, 'sine', 0.09, 980); tone(1640, 0.06, 'sine', 0.05, 1640, 0.02); }
    else if (k === 'bell') { tone(1480, 0.55, 'sine', 0.14); tone(2960, 0.42, 'sine', 0.08); tone(4410, 0.25, 'triangle', 0.04); }
    else if (k === 'err') { tone(175, 0.14, 'sawtooth', 0.09, 120); }
    else if (k === 'over') { tone(440, 0.2, 'triangle', 0.1); tone(330, 0.24, 'triangle', 0.1, 330, 0.16); tone(262, 0.4, 'triangle', 0.12, 262, 0.34); }
  }

  let S, canvas, ctx, mouse = { x: W / 2, y: H / 2 }, lastT = 0, raf = 0;
  function keyOf(it) { return `${it.id}:${it.state}`; }
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const sa = [...a].sort(), sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
  }
  function findRecipe(items) {
    const ks = items.map(keyOf);
    return RECIPES.find(r => sameSet(r.needs, ks)) || null;
  }
  function mkOrder(rec, table, pct = 1) {
    return { id: ++S.seq, rec, table, maxT: rec.time, t: rec.time * pct, flash: 0 };
  }
  function initState() {
    S = {
      phase: 'play', shift: 150, score: 0, served: 0, missed: 0, combo: 1, bestCombo: 1,
      seq: 0, spawnT: 9, tableSeq: 4, hand: null,
      board: { item: { id: 'basil', state: 'raw' }, prog: 0.45, need: 1.3 },
      skillet: { item: null, t: 0, need: 3.8, burn: 11.0, chimed: false },
      pot: { item: { id: 'noodle', state: 'raw' }, t: 1.9, need: 3.4, burn: 11.5, chimed: false },
      plate: [
        { id: 'brioche', state: 'raw' },
        { id: 'wagyu', state: 'seared' },
        { id: 'tomato', state: 'chopped' }
      ],
      pass: {
        recipe: RECIPES[1],
        items: [{ id: 'salmon', state: 'seared' }, { id: 'lemon', state: 'chopped' }, { id: 'basil', state: 'chopped' }]
      },
      orders: [], particles: [], popups: [],
      toast: 'Hot Saffron Salmon on the Pass! Press [Space] or click it to serve!', toastT: 5.5,
      bellAnim: 0, t: 0
    };
    S.orders.push(mkOrder(RECIPES[1], 1, 0.84));
    S.orders.push(mkOrder(RECIPES[0], 2, 0.92));
    S.orders.push(mkOrder(RECIPES[2], 3, 0.98));
  }
  function toast(msg, sec = 2.6) { S.toast = msg; S.toastT = sec; }
  function popup(text, x, y, col = '#ffd166') { S.popups.push({ text, x, y, col, life: 1.25 }); }
  function burst(x, y, col, n = 10, spd = 85) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = spd * (0.4 + Math.random() * 0.8);
      S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 25, r: 2.5 + Math.random() * 3.5, col, life: 0.55 + Math.random() * 0.4 });
    }
  }

  function pickIng(idx) {
    if (S.phase !== 'play') return;
    const ing = ING[idx]; if (!ing) return;
    S.hand = { id: ing.id, state: 'raw' };
    sfx('pick');
    const hint = ing.prep === 'raw' ? 'Add to Assembly Plate [A]' :
      ing.prep === 'chop' ? 'Chop on Cutting Board [C]' :
      ing.prep === 'sear' ? 'Sear in Cast-Iron Skillet [F]' : 'Boil in Copper Pot [B]';
    toast(`${ing.name} in hand — ${hint}`, 2.1);
  }
  function useBoard() {
    if (S.phase !== 'play') return;
    const b = S.board;
    if (b.item && b.item.state === 'chopped' && !S.hand) {
      S.hand = b.item; b.item = null; b.prog = 0; sfx('pick'); toast(`Picked up sliced ${BY_ID[S.hand.id].name}`); return;
    }
    if (b.item && b.item.state === 'raw') {
      b.prog += 0.45; sfx('chop');
      burst(Z.board.x + 118, Z.board.y + 110, BY_ID[b.item.id].col, 7, 70);
      if (b.prog >= b.need) {
        b.item.state = 'chopped'; b.prog = b.need; sfx('ready');
        toast(`${BY_ID[b.item.id].name} chopped! Click board or press [C] to take.`);
      }
      return;
    }
    if (!b.item && S.hand) {
      if (S.hand.state === 'raw' && BY_ID[S.hand.id].prep === 'chop') {
        b.item = S.hand; b.prog = 0.25; S.hand = null; sfx('chop');
        burst(Z.board.x + 118, Z.board.y + 110, BY_ID[b.item.id].col, 6, 65);
        toast(`Chopping ${BY_ID[b.item.id].name}... tap [C] to chop faster!`);
      } else { sfx('err'); toast('Only raw Tomato, Basil, or Lemon go on the cutting board.'); }
      return;
    }
    if (b.item && b.item.state === 'chopped' && S.hand) {
      const tmp = S.hand;
      if (tmp.state === 'raw' && BY_ID[tmp.id].prep === 'chop') {
        S.hand = b.item; b.item = tmp; b.prog = 0.2; sfx('chop');
      } else { toast('Place or trash your held item first.'); sfx('err'); }
    }
  }
  function useCooker(st, mode, zone) {
    if (S.phase !== 'play') return;
    const doneState = mode === 'sear' ? 'seared' : 'boiled';
    if (st.item && !S.hand) {
      if (st.item.state === doneState || st.item.state === 'burnt') {
        S.hand = st.item; st.item = null; st.t = 0; st.chimed = false;
        sfx('pick'); toast(`Took ${LABEL[S.hand.state]} ${BY_ID[S.hand.id].name}`);
      } else toast('Still cooking... wait for the green chime!');
      return;
    }
    if (!st.item && S.hand) {
      if (S.hand.state === 'raw' && BY_ID[S.hand.id].prep === mode) {
        st.item = S.hand; st.t = 0; st.chimed = false; S.hand = null; sfx('sizzle');
        burst(zone.x + zone.w / 2, zone.y + 108, mode === 'sear' ? '#ff9f43' : '#e0f2fe', 9, 60);
        toast(`${mode === 'sear' ? 'Searing' : 'Boiling'} ${BY_ID[st.item.id].name}...`);
      } else {
        sfx('err');
        toast(mode === 'sear' ? 'Only raw Wagyu or Salmon sear in the skillet.' : 'Only raw Pasta boils in the copper pot.');
      }
      return;
    }
    if (st.item && S.hand) { sfx('err'); toast('Hands full! Plate [A] or trash [X] first.'); }
  }
  function addToPlate() {
    if (S.phase !== 'play') return;
    if (!S.hand) {
      const rec = findRecipe(S.plate);
      if (rec) moveToPass(); else toast('Pick an ingredient [1-8] to build a dish.');
      return;
    }
    if (S.hand.state === 'burnt') { sfx('err'); toast('Burnt food cannot be plated! Trash it [X].'); return; }
    const ing = BY_ID[S.hand.id];
    if (S.hand.state !== NEED_STATE[ing.prep]) {
      sfx('err');
      toast(`Prep ${ing.name} first (${ing.prep === 'chop' ? 'Board [C]' : ing.prep === 'sear' ? 'Skillet [F]' : 'Pot [B]'})!`);
      return;
    }
    if (S.plate.length >= 5) { sfx('err'); toast('Assembly plate is full! Trash [X] or plate it [E].'); return; }
    if (S.plate.some(i => keyOf(i) === keyOf(S.hand))) { sfx('err'); toast(`${ing.name} is already on the plate.`); return; }
    S.plate.push(S.hand); S.hand = null; sfx('plate');
    burst(Z.plate.x + Z.plate.w / 2, Z.plate.y + 115, '#fff3c4', 8, 60);
    const rec = findRecipe(S.plate);
    if (rec) {
      toast(`${rec.name} complete! Press [E] for Pass or [Space] to Serve!`, 3.2);
      popup('DISH READY!', Z.plate.x + Z.plate.w / 2, Z.plate.y + 42, '#7bf1a8');
    }
  }
  function moveToPass() {
    if (S.phase !== 'play') return;
    const rec = findRecipe(S.plate);
    if (!rec) { sfx('err'); toast('Plate does not match a recipe on the board yet.'); return; }
    if (S.pass) { sfx('err'); toast('Service Pass already has a hot plate! Serve it [Space] first.'); return; }
    S.pass = { recipe: rec, items: [...S.plate] }; S.plate = [];
    sfx('plate'); toast(`${rec.name} hot under the pass lamp! Press [Space] to serve!`);
  }
  function serveDish(orderId = null) {
    if (S.phase !== 'play') return;
    let src = null, rec = null, ox = Z.pass.x + 76, oy = Z.pass.y + 90;
    if (S.pass) { src = 'pass'; rec = S.pass.recipe; }
    else {
      const pr = findRecipe(S.plate);
      if (pr) { src = 'plate'; rec = pr; ox = Z.plate.x + 85; oy = Z.plate.y + 90; }
    }
    if (!rec) { sfx('err'); toast('No completed dish ready to serve yet.'); return; }
    const candidates = S.orders.filter(o => o.rec.id === rec.id && (!orderId || o.id === orderId));
    const target = candidates.sort((a, b) => a.t - b.t)[0];
    if (!target) { sfx('err'); toast(`No active ticket wants ${rec.name}.`); return; }
    const tip = Math.round((target.t / target.maxT) * 12);
    const mult = Math.min(5, S.combo);
    const earned = Math.round((rec.price + tip) * (1 + (mult - 1) * 0.25));
    S.score += earned; S.served++; S.combo = Math.min(5, S.combo + 1); S.bestCombo = Math.max(S.bestCombo, S.combo);
    S.orders = S.orders.filter(o => o.id !== target.id);
    if (src === 'pass') S.pass = null; else S.plate = [];
    S.bellAnim = 1; sfx('bell');
    burst(ox, oy, '#ffd166', 18, 120);
    popup(`+$${earned}${S.combo > 2 ? ` x${S.combo - 1}!` : '!'}`, ox, oy - 24, '#7bf1a8');
    toast(`Served ${rec.name} to Table ${target.table} (+$${earned})!`, 2.6);
    if (S.orders.length < 2) spawnOrder();
  }
  function trashAction() {
    if (S.phase !== 'play') return;
    if (S.hand) { S.hand = null; sfx('err'); toast('Trashed held item.'); }
    else if (S.plate.length) { S.plate = []; sfx('err'); toast('Cleared assembly plate.'); }
    else if (S.pass) { S.pass = null; sfx('err'); toast('Cleared pass plate.'); }
  }
  function spawnOrder() {
    if (S.orders.length >= 4) return;
    const rec = RECIPES[Math.floor(Math.random() * RECIPES.length)];
    S.orders.push(mkOrder(rec, S.tableSeq++, 1));
    sfx('pick');
  }
  function togglePause() { if (S.phase !== 'over') S.phase = S.phase === 'play' ? 'pause' : 'play'; }
  function toggleMute() { muted = !muted; toast(muted ? 'Sound Muted' : 'Sound On', 1.4); }
  function restart() { initState(); sfx('bell'); }

  function updateCooker(st, dt, doneState, zone, col) {
    if (!st.item) return;
    st.t += dt;
    if (Math.random() < dt * 7) {
      S.particles.push({ x: zone.x + zone.w / 2 + (Math.random() - 0.5) * 44, y: zone.y + 92, vx: (Math.random() - 0.5) * 14, vy: -28 - Math.random() * 24, r: 4 + Math.random() * 4, col: st.item.state === 'burnt' ? 'rgba(40,40,45,0.65)' : col, life: 0.75 });
    }
    if (st.t >= st.burn && st.item.state !== 'burnt') {
      st.item.state = 'burnt'; sfx('err'); toast(`${BY_ID[st.item.id].name} burnt! Take & trash [X].`);
    } else if (st.t >= st.need && st.item.state === 'raw') {
      st.item.state = doneState;
      if (!st.chimed) { st.chimed = true; sfx('ready'); popup('READY!', zone.x + zone.w / 2, zone.y + 44, '#7bf1a8'); }
    }
  }
  function update(dt) {
    S.t += dt;
    if (S.toastT > 0) S.toastT = Math.max(0, S.toastT - dt);
    if (S.bellAnim > 0) S.bellAnim = Math.max(0, S.bellAnim - dt * 2.4);
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) S.particles.splice(i, 1);
    }
    for (let i = S.popups.length - 1; i >= 0; i--) {
      const p = S.popups[i]; p.y -= 34 * dt; p.life -= dt;
      if (p.life <= 0) S.popups.splice(i, 1);
    }
    if (S.phase !== 'play') return;
    S.shift -= dt;
    if (S.shift <= 0) { S.shift = 0; S.phase = 'over'; sfx('over'); return; }
    if (S.board.item && S.board.item.state === 'raw') {
      S.board.prog += dt * 0.65;
      if (S.board.prog >= S.board.need) { S.board.item.state = 'chopped'; S.board.prog = S.board.need; sfx('ready'); }
    }
    updateCooker(S.skillet, dt, 'seared', Z.skillet, 'rgba(255,214,153,0.55)');
    updateCooker(S.pot, dt, 'boiled', Z.pot, 'rgba(235,248,255,0.6)');
    S.spawnT -= dt;
    if (S.spawnT <= 0) { spawnOrder(); S.spawnT = 13.5; }
    for (let i = S.orders.length - 1; i >= 0; i--) {
      const o = S.orders[i]; o.t -= dt;
      if (o.t <= 0) {
        S.orders.splice(i, 1); S.missed++; S.combo = 1; S.score = Math.max(0, S.score - 8);
        sfx('err'); toast(`Table ${o.table} left! Combo reset (-$8).`);
        if (S.orders.length < 2) spawnOrder();
      }
    }
    syncDom();
  }
  function syncDom() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const m = Math.floor(S.shift / 60), s = Math.floor(S.shift % 60);
    set('score', `$${S.score}`); set('timer', `${m}:${String(s).padStart(2, '0')}`);
    set('combo', `x${S.combo}`); set('served', `${S.served}`);
  }

  function rr(x, y, w, h, r, fill, stroke, lw = 2) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  function tx(s, x, y, sz = 14, col = '#fff', al = 'left', b = false) {
    ctx.font = `${b ? '700 ' : ''}${sz}px system-ui,-apple-system,Segoe UI,sans-serif`;
    ctx.fillStyle = col; ctx.textAlign = al; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
  }
  function drawFood(id, st, x, y, s = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const burnt = st === 'burnt';
    if (id === 'brioche') {
      ctx.fillStyle = '#d48d34'; ctx.beginPath(); ctx.ellipse(0, 6, 22, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ebaa4b'; ctx.beginPath(); ctx.arc(0, 2, 20, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#fff3d6'; [[-8, -7], [0, -10], [8, -6], [-3, -4], [5, -3]].forEach(([a, b]) => { ctx.beginPath(); ctx.ellipse(a, b, 2.2, 1.1, 0.3, 0, Math.PI * 2); ctx.fill(); });
    } else if (id === 'wagyu') {
      ctx.fillStyle = burnt ? '#222' : st === 'seared' ? '#6b321d' : '#cc4b4b';
      ctx.beginPath(); ctx.ellipse(0, 2, 22, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = burnt ? '#111' : st === 'seared' ? '#36150a' : '#f2b8b5'; ctx.lineWidth = 2.4;
      for (let i = -10; i <= 10; i += 7) { ctx.beginPath(); ctx.moveTo(i - 4, -5); ctx.lineTo(i + 4, 9); ctx.stroke(); }
    } else if (id === 'tomato') {
      ctx.fillStyle = '#e63946';
      if (st === 'chopped') {
        [-9, 9].forEach(dx => { ctx.beginPath(); ctx.arc(dx, 2, 11, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ff9b85'; ctx.beginPath(); ctx.arc(dx, 2, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e63946'; });
      } else {
        ctx.beginPath(); ctx.arc(0, 2, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2d9348'; ctx.fillRect(-2, -16, 4, 6);
      }
    } else if (id === 'basil') {
      ctx.fillStyle = '#2d9348';
      if (st === 'chopped') {
        [[-10, -4], [0, 4], [9, -3], [-4, 8], [7, 7], [-1, -8]].forEach(([a, b]) => { ctx.beginPath(); ctx.ellipse(a, b, 5, 2.6, a, 0, Math.PI * 2); ctx.fill(); });
      } else {
        [-7, 7].forEach(dx => { ctx.beginPath(); ctx.ellipse(dx, 1, 10, 14, dx * 0.05, 0, Math.PI * 2); ctx.fill(); });
      }
    } else if (id === 'salmon') {
      ctx.fillStyle = burnt ? '#252222' : st === 'seared' ? '#d96b38' : '#f48c71';
      rr(-22, -10, 44, 20, 7, ctx.fillStyle);
      ctx.strokeStyle = burnt ? '#3a3535' : '#ffe1d6'; ctx.lineWidth = 2;
      for (let i = -14; i <= 14; i += 7) { ctx.beginPath(); ctx.moveTo(i, -8); ctx.lineTo(i + 4, 8); ctx.stroke(); }
    } else if (id === 'noodle') {
      ctx.strokeStyle = burnt ? '#2c2925' : st === 'boiled' ? '#ffd86b' : '#e6c24f'; ctx.lineWidth = 4;
      for (let i = -10; i <= 10; i += 5) { ctx.beginPath(); ctx.arc(0, i * 0.4, 14 - Math.abs(i) * 0.3, 0.2, Math.PI - 0.2); ctx.stroke(); }
    } else if (id === 'truffle') {
      ctx.fillStyle = '#d9d2c5'; ctx.beginPath(); ctx.ellipse(0, 4, 17, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f7f1e3'; ctx.beginPath(); ctx.ellipse(0, 1, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a3b2c'; [[-4, 0], [3, 2], [0, -3], [6, -1]].forEach(([a, b]) => ctx.fillRect(a, b, 2.5, 2.5));
    } else if (id === 'lemon') {
      ctx.fillStyle = '#f7d136';
      ctx.beginPath(); ctx.arc(0, 2, st === 'chopped' ? 14 : 15, 0, Math.PI * 2); ctx.fill();
      if (st === 'chopped') { ctx.fillStyle = '#fff5b8'; ctx.beginPath(); ctx.arc(0, 2, 10, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
  function drawDish(items, x, y, sc = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.ellipse(0, 4, 48, 34, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(0, 1, 38, 26, 0, 0, Math.PI * 2); ctx.fill();
    items.forEach((it, idx) => drawFood(it.id, it.state, (idx - (items.length - 1) / 2) * 11, 6 - idx * 6, 0.92));
    ctx.restore();
  }
  function drawRing(x, y, r, pct, col) {
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, pct)); ctx.stroke();
  }
  function inRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }

  function draw() {
    ctx.fillStyle = '#231f20'; ctx.fillRect(0, 0, W, H);
    // Warm bistro subway tile backsplash
    ctx.fillStyle = '#2e2926'; ctx.fillRect(0, 146, W, 286);
    ctx.strokeStyle = 'rgba(255,240,215,0.06)'; ctx.lineWidth = 1;
    for (let y = 152; y < 432; y += 28) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      for (let x = (y % 56 === 0 ? 0 : 32); x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 28); ctx.stroke(); }
    }
    // Stainless steel station shelf & walnut prep counter
    rr(24, 168, W - 48, 250, 14, '#3d3a38', '#68625e', 2);
    const wg = ctx.createLinearGradient(0, 434, 0, H);
    wg.addColorStop(0, '#6e472b'); wg.addColorStop(1, '#472b18');
    ctx.fillStyle = wg; ctx.fillRect(0, 434, W, H - 434);
    ctx.fillStyle = '#8d5b37'; ctx.fillRect(0, 434, W, 8);

    // Overhead Brass Order Rail & Shift HUD
    ctx.fillStyle = '#191617'; ctx.fillRect(0, 0, W, 146);
    rr(18, 12, 854, 12, 6, '#c79a4b', '#f2cf7e', 1);
    const haveSet = new Set(S.plate.map(keyOf));
    S.orders.forEach((o, idx) => {
      const tx0 = 26 + idx * 212, ty0 = 20, tw = 200, th = 118;
      const pct = Math.max(0, o.t / o.maxT);
      const urgent = pct < 0.25 && Math.floor(S.t * 6) % 2 === 0;
      rr(tx0, ty0, tw, th, 8, urgent ? '#fff0ec' : '#fcf8ee', S.pass && S.pass.recipe.id === o.rec.id ? '#22c55e' : '#d6cbb8', S.pass && S.pass.recipe.id === o.rec.id ? 3 : 1.5);
      rr(tx0 + 82, ty0 - 5, 36, 10, 4, '#b08941');
      tx(`T${o.table} · ${o.rec.name}`, tx0 + 10, ty0 + 21, 12.5, '#1f1b18', 'left', true);
      tx(`$${o.rec.price}`, tx0 + tw - 10, ty0 + 21, 13, '#15803d', 'right', true);
      o.rec.needs.forEach((need, ni) => {
        const [id, st] = need.split(':'), ix = tx0 + 26 + ni * 46, iy = ty0 + 62;
        const got = haveSet.has(need);
        rr(ix - 18, iy - 18, 36, 36, 7, got ? '#dcfce7' : '#f1eadc', got ? '#16a34a' : '#d6cbb8', 1);
        drawFood(id, st, ix, iy - 2, 0.52);
        tx(st === 'raw' ? 'RAW' : st.slice(0, 4).toUpperCase(), ix, iy + 25, 8.5, '#57534e', 'center', true);
      });
      rr(tx0 + 10, ty0 + 102, tw - 20, 8, 4, '#e5ddd0');
      rr(tx0 + 10, ty0 + 102, (tw - 20) * pct, 8, 4, pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444');
    });

    // Right HUD Panel (Timer, Score, Combo, Controls)
    rr(886, 12, 296, 124, 12, '#252124', '#c79a4b', 2);
    const mm = Math.floor(S.shift / 60), ss = Math.floor(S.shift % 60);
    tx('SHIFT TIMER', 954, 32, 10, '#c79a4b', 'center', true);
    tx(`${mm}:${String(ss).padStart(2, '0')}`, 954, 62, 30, S.shift < 20 ? '#ff6b6b' : '#fef3c7', 'center', true);
    tx('REVENUE', 1072, 32, 10, '#7bf1a8', 'center', true);
    tx(`$${S.score}`, 1072, 60, 26, '#7bf1a8', 'center', true);
    tx(`SERVED ${S.served} · x${S.combo}`, 1014, 93, 12, '#e2e8f0', 'center', true);
    // HUD mini buttons
    const btns = [
      { id: 'mute', x: 902, y: 106, w: 80, h: 22, l: muted ? 'SOUND OFF' : 'SOUND ON' },
      { id: 'pause', x: 992, y: 106, w: 84, h: 22, l: S.phase === 'pause' ? 'RESUME' : 'PAUSE [P]' },
      { id: 'reset', x: 1086, y: 106, w: 82, h: 22, l: 'RESET [R]' }
    ];
    btns.forEach(b => { rr(b.x, b.y, b.w, b.h, 6, '#393438', '#68625e', 1); tx(b.l, b.x + b.w / 2, b.y + 11, 10, '#f8fafc', 'center', true); });

    // Station 1: Cutting Board
    rr(Z.board.x, Z.board.y, Z.board.w, Z.board.h, 12, '#504741', inRect(mouse.x, mouse.y, Z.board) ? '#f6c453' : '#786d64', 2);
    tx('CUTTING BOARD [C]', Z.board.x + 118, Z.board.y + 18, 12, '#fde68a', 'center', true);
    rr(Z.board.x + 22, Z.board.y + 40, 190, 124, 12, '#d4a373', '#9c6644', 3);
    if (S.board.item) {
      drawFood(S.board.item.id, S.board.item.state, Z.board.x + 118, Z.board.y + 104, 1.35);
      const pct = S.board.prog / S.board.need;
      rr(Z.board.x + 42, Z.board.y + 174, 150, 12, 6, '#231f20');
      rr(Z.board.x + 42, Z.board.y + 174, 150 * Math.min(1, pct), 12, 6, pct >= 1 ? '#22c55e' : '#f59e0b');
      tx(pct >= 1 ? 'SLICED! Click / [C]' : 'Chopping... tap [C]', Z.board.x + 118, Z.board.y + 199, 11, pct >= 1 ? '#7bf1a8' : '#fef3c7', 'center', true);
    } else tx('Place Tomato / Basil / Lemon', Z.board.x + 118, Z.board.y + 192, 11, '#d6d3d1', 'center');

    // Station 2: Cast-Iron Skillet
    rr(Z.skillet.x, Z.skillet.y, Z.skillet.w, Z.skillet.h, 12, '#3c3638', inRect(mouse.x, mouse.y, Z.skillet) ? '#f6c453' : '#786d64', 2);
    tx('CAST-IRON SKILLET [F]', Z.skillet.x + 118, Z.skillet.y + 18, 12, '#fdba74', 'center', true);
    ctx.fillStyle = S.skillet.item ? '#ea580c' : '#57534e';
    ctx.beginPath(); ctx.arc(Z.skillet.x + 118, Z.skillet.y + 108, 62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1f2326'; ctx.beginPath(); ctx.arc(Z.skillet.x + 118, Z.skillet.y + 108, 54, 0, Math.PI * 2); ctx.fill();
    rr(Z.skillet.x + 168, Z.skillet.y + 101, 50, 14, 6, '#1f2326', '#44403c', 1);
    if (S.skillet.item) {
      drawFood(S.skillet.item.id, S.skillet.item.state, Z.skillet.x + 118, Z.skillet.y + 108, 1.3);
      const st = S.skillet, warn = st.t > st.burn - 3 && st.item.state !== 'burnt';
      drawRing(Z.skillet.x + 118, Z.skillet.y + 108, 58, st.t / st.need, st.item.state === 'burnt' ? '#ef4444' : warn ? '#f97316' : st.t >= st.need ? '#22c55e' : '#fbbf24');
      tx(st.item.state === 'burnt' ? 'BURNT! Take & Trash' : st.t >= st.need ? (warn ? 'PULL NOW!' : 'SEARED! Click / [F]') : 'Searing...', Z.skillet.x + 118, Z.skillet.y + 193, 11, st.t >= st.need && !warn ? '#7bf1a8' : '#fde68a', 'center', true);
    } else tx('Sear Wagyu or Salmon', Z.skillet.x + 118, Z.skillet.y + 193, 11, '#d6d3d1', 'center');

    // Station 3: Copper Simmer Pot
    rr(Z.pot.x, Z.pot.y, Z.pot.w, Z.pot.h, 12, '#3c3638', inRect(mouse.x, mouse.y, Z.pot) ? '#f6c453' : '#786d64', 2);
    tx('COPPER POT [B]', Z.pot.x + 112, Z.pot.y + 18, 12, '#93c5fd', 'center', true);
    ctx.fillStyle = '#b45309'; ctx.beginPath(); ctx.arc(Z.pot.x + 112, Z.pot.y + 108, 58, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(Z.pot.x + 112, Z.pot.y + 108, 48, 0, Math.PI * 2); ctx.fill();
    if (S.pot.item) {
      drawFood(S.pot.item.id, S.pot.item.state, Z.pot.x + 112, Z.pot.y + 108, 1.28);
      const st = S.pot, warn = st.t > st.burn - 3 && st.item.state !== 'burnt';
      drawRing(Z.pot.x + 112, Z.pot.y + 108, 54, st.t / st.need, st.item.state === 'burnt' ? '#ef4444' : warn ? '#f97316' : st.t >= st.need ? '#22c55e' : '#7dd3fc');
      tx(st.item.state === 'burnt' ? 'OVERCOOKED!' : st.t >= st.need ? 'AL DENTE! Click / [B]' : 'Boiling Pasta...', Z.pot.x + 112, Z.pot.y + 193, 11, st.t >= st.need ? '#7bf1a8' : '#bae6fd', 'center', true);
    } else tx('Boil Hand-Cut Pasta', Z.pot.x + 112, Z.pot.y + 193, 11, '#d6d3d1', 'center');

    // Station 4: Assembly Plate (Dish Mid-Assembly)
    const plateRec = findRecipe(S.plate);
    rr(Z.plate.x, Z.plate.y, Z.plate.w, Z.plate.h, 12, '#44403c', plateRec ? '#22c55e' : inRect(mouse.x, mouse.y, Z.plate) ? '#f6c453' : '#786d64', plateRec ? 3 : 2);
    tx('ASSEMBLY [A]', Z.plate.x + 85, Z.plate.y + 18, 12, '#fef08a', 'center', true);
    drawDish(S.plate, Z.plate.x + 85, Z.plate.y + 106, 1.08);
    tx(plateRec ? `${plateRec.name}` : S.plate.length ? `Mid-Assembly (${S.plate.length})` : 'Empty Plate', Z.plate.x + 85, Z.plate.y + 174, 11, plateRec ? '#7bf1a8' : '#fef3c7', 'center', true);
    tx(plateRec ? 'Press [E] Pass / [Space]' : S.plate.map(i => BY_ID[i.id].name.slice(0, 3)).join('+'), Z.plate.x + 85, Z.plate.y + 194, 10, '#d6d3d1', 'center');

    // Station 5: Warm Heat-Lamp Service Pass (Plate Ready to Serve!)
    rr(Z.pass.x, Z.pass.y, Z.pass.w, Z.pass.h, 12, '#4a3525', S.pass ? '#fbbf24' : '#786d64', S.pass ? 3 : 2);
    const glow = ctx.createRadialGradient(Z.pass.x + 76, Z.pass.y + 92, 8, Z.pass.x + 76, Z.pass.y + 98, 84);
    glow.addColorStop(0, 'rgba(255,209,102,0.34)'); glow.addColorStop(1, 'rgba(255,209,102,0)');
    ctx.fillStyle = glow; ctx.fillRect(Z.pass.x, Z.pass.y, Z.pass.w, Z.pass.h);
    tx('SERVICE PASS', Z.pass.x + 76, Z.pass.y + 18, 12, '#fde68a', 'center', true);
    if (S.pass) {
      drawDish(S.pass.items, Z.pass.x + 76, Z.pass.y + 104, 1.08);
      tx('READY TO SERVE!', Z.pass.x + 76, Z.pass.y + 168, 11, '#7bf1a8', 'center', true);
      tx('Click / [Space]', Z.pass.x + 76, Z.pass.y + 185, 10.5, '#fef3c7', 'center', true);
    } else tx('Move dish here [E]', Z.pass.x + 76, Z.pass.y + 110, 11, '#d6c3b3', 'center');
    // Brass Service Bell
    const by = Z.pass.y + 204 - Math.sin(S.bellAnim * Math.PI) * 5;
    ctx.fillStyle = '#d97706'; ctx.beginPath(); ctx.arc(Z.pass.x + 76, by, 14, Math.PI, 0); ctx.fill();
    rr(Z.pass.x + 59, by, 34, 5, 2, '#92400e');

    // Counter Ingredients (1-8) & Trash Bin
    ING.forEach((ing, idx) => {
      const ix = 32 + idx * 130, iy = 458, iw = 118, ih = 158;
      const hov = inRect(mouse.x, mouse.y, { x: ix, y: iy, w: iw, h: ih });
      const sel = S.hand && S.hand.id === ing.id && S.hand.state === 'raw';
      rr(ix, iy, iw, ih, 12, sel ? '#5c3c24' : hov ? '#4d3220' : '#3b2416', sel ? '#fbbf24' : hov ? '#f3c98b' : '#8d5b37', sel ? 3 : 2);
      rr(ix + 8, iy + 8, 22, 22, 6, '#f59e0b');
      tx(ing.key, ix + 19, iy + 19, 12, '#1c1917', 'center', true);
      tx(ing.prep.toUpperCase(), ix + iw - 10, iy + 19, 9.5, '#d6c3b3', 'right', true);
      drawFood(ing.id, 'raw', ix + iw / 2, iy + 78, 1.4);
      tx(ing.name, ix + iw / 2, iy + 132, 13.5, '#fef3c7', 'center', true);
    });
    rr(Z.trash.x, Z.trash.y, Z.trash.w, Z.trash.h, 12, '#3f1d1d', inRect(mouse.x, mouse.y, Z.trash) ? '#f87171' : '#7f1d1d', 2);
    tx('TRASH', Z.trash.x + 42, Z.trash.y + 52, 12, '#fecaca', 'center', true);
    tx('[X]', Z.trash.x + 42, Z.trash.y + 74, 15, '#fca5a5', 'center', true);
    tx('Clear Hand', Z.trash.x + 42, Z.trash.y + 114, 10, '#fecaca', 'center');
    tx('or Plate', Z.trash.x + 42, Z.trash.y + 130, 10, '#fecaca', 'center');

    // Bottom Status & Toast Bar
    rr(24, 636, W - 48, 66, 12, '#1b1716', '#78563a', 1.5);
    const heldTxt = S.hand ? `HOLDING: ${LABEL[S.hand.state]} ${BY_ID[S.hand.id].name}` : 'HANDS EMPTY — Click an ingredient or press [1]-[8]';
    tx(heldTxt, 44, 658, 13.5, S.hand ? '#fde68a' : '#d6d3d1', 'left', true);
    tx(S.toastT > 0 ? S.toast : '[1-8] Pick · [C] Chop · [F] Sear · [B] Boil · [A] Plate · [E] Pass · [Space] Serve · [X] Trash', 44, 682, 12, S.toastT > 0 ? '#7bf1a8' : '#a8a29e', 'left');
    tx('EMBER & HERB BISTRO', W - 42, 668, 13, '#c79a4b', 'right', true);

    // Particles, Popups & Held Food Cursor
    S.particles.forEach(p => { ctx.globalAlpha = Math.max(0, Math.min(1, p.life)); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1;
    S.popups.forEach(p => { ctx.globalAlpha = Math.min(1, p.life); tx(p.text, p.x, p.y, 20, p.col, 'center', true); });
    ctx.globalAlpha = 1;
    if (S.hand) {
      rr(mouse.x + 14, mouse.y - 26, 48, 48, 24, 'rgba(25,22,23,0.85)', '#fbbf24', 2);
      drawFood(S.hand.id, S.hand.state, mouse.x + 38, mouse.y - 2, 0.85);
    }

    // Pause / Shift Over Overlay
    if (S.phase !== 'play') {
      ctx.fillStyle = 'rgba(15,12,12,0.78)'; ctx.fillRect(0, 0, W, H);
      rr(W / 2 - 220, H / 2 - 140, 440, 280, 18, '#231f20', '#c79a4b', 3);
      if (S.phase === 'pause') {
        tx('KITCHEN PAUSED', W / 2, H / 2 - 42, 30, '#fde68a', 'center', true);
        tx('Press [P] or click Resume to continue cooking', W / 2, H / 2 + 12, 15, '#e7e5e4', 'center');
        rr(W / 2 - 90, H / 2 + 56, 180, 46, 10, '#22c55e'); tx('RESUME', W / 2, H / 2 + 79, 16, '#052e16', 'center', true);
      } else {
        const stars = S.score >= 240 ? '★★★' : S.score >= 130 ? '★★☆' : '★☆☆';
        tx('SHIFT COMPLETE!', W / 2, H / 2 - 92, 30, '#fde68a', 'center', true);
        tx(stars, W / 2, H / 2 - 48, 32, '#fbbf24', 'center', true);
        tx(`Revenue: $${S.score}   ·   Served: ${S.served}   ·   Best Combo: x${S.bestCombo}`, W / 2, H / 2 + 4, 15, '#f5f5f4', 'center', true);
        tx(`Missed Tickets: ${S.missed}`, W / 2, H / 2 + 34, 13, '#d6d3d1', 'center');
        rr(W / 2 - 95, H / 2 + 66, 190, 46, 10, '#f59e0b'); tx('PLAY AGAIN [R]', W / 2, H / 2 + 89, 15, '#1c1917', 'center', true);
      }
    }
  }

  function handleClick(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
    mouse.x = x; mouse.y = y;
    if (S.phase === 'pause') { togglePause(); return; }
    if (S.phase === 'over') { if (inRect(x, y, { x: W / 2 - 95, y: H / 2 + 66, w: 190, h: 46 })) restart(); return; }
    if (inRect(x, y, { x: 902, y: 106, w: 80, h: 22 })) { toggleMute(); return; }
    if (inRect(x, y, { x: 992, y: 106, w: 84, h: 22 })) { togglePause(); return; }
    if (inRect(x, y, { x: 1086, y: 106, w: 82, h: 22 })) { restart(); return; }
    for (let i = 0; i < S.orders.length; i++) {
      if (inRect(x, y, { x: 26 + i * 212, y: 20, w: 200, h: 118 })) { serveDish(S.orders[i].id); return; }
    }
    if (inRect(x, y, Z.board)) { useBoard(); return; }
    if (inRect(x, y, Z.skillet)) { useCooker(S.skillet, 'sear', Z.skillet); return; }
    if (inRect(x, y, Z.pot)) { useCooker(S.pot, 'boil', Z.pot); return; }
    if (inRect(x, y, Z.plate)) { addToPlate(); return; }
    if (inRect(x, y, Z.pass)) { if (S.pass) serveDish(); else moveToPass(); return; }
    if (inRect(x, y, Z.trash)) { trashAction(); return; }
    for (let i = 0; i < ING.length; i++) {
      if (inRect(x, y, { x: 32 + i * 130, y: 458, w: 118, h: 158 })) { pickIng(i); return; }
    }
  }
  function handleKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '8') pickIng(Number(k) - 1);
    else if (k === 'c') useBoard();
    else if (k === 'f') useCooker(S.skillet, 'sear', Z.skillet);
    else if (k === 'b') useCooker(S.pot, 'boil', Z.pot);
    else if (k === 'a') addToPlate();
    else if (k === 'e') moveToPass();
    else if (k === ' ' || k === 'enter') { e.preventDefault(); serveDish(); }
    else if (k === 'x' || k === 'backspace') trashAction();
    else if (k === 'p') togglePause();
    else if (k === 'm') toggleMute();
    else if (k === 'r') restart();
  }

  function loop(ts) {
    const dt = Math.min(0.05, lastT ? (ts - lastT) / 1000 : 0.016);
    lastT = ts; update(dt); draw();
    raf = requestAnimationFrame(loop);
  }
  function boot() {
    canvas = document.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'game-canvas';
      canvas.style.cssText = 'width:100%;max-width:1200px;aspect-ratio:1200/720;display:block;margin:12px auto;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,0.45);cursor:pointer;';
      (document.querySelector('#game-container,#game,#app,main') || document.body).appendChild(canvas);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initState();
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - r.left) * (W / r.width); mouse.y = (e.clientY - r.top) * (H / r.height);
    });
    canvas.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKey);
    const bind = (sel, fn) => document.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn));
    bind('#start-btn,#play-btn,[data-action="start"]', () => {
      document.querySelectorAll('#start-overlay,#title-screen,.start-overlay').forEach(el => { el.style.display = 'none'; });
      if (S.phase !== 'play') restart();
    });
    bind('#restart-btn,[data-action="restart"]', restart);
    bind('#pause-btn,[data-action="pause"]', togglePause);
    bind('#mute-btn,[data-action="mute"]', toggleMute);
    window.KitchenGame = { get state() { return S; }, restart, serve: serveDish, togglePause, toggleMute, draw };
    draw(); raf = requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();