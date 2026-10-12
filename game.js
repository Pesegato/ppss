(async () => {
  // Risoluzione logica di gioco (in linea con WaveEditor in 16:9)
  const W = 960, H = 540, KEY = 'shmup_waves';

  /* ---------- Livelli & Demo Wave ---------- */
  const DEMO = {
    id: 'demo_wave',
    meta: 'Demo WaveEditor',
    duration: '20',
    entities: [
      'Slug_shell,0,true,Circular,0.8,180,90,3.0,0',
      'Slug_egg,3,true,Swoop,0.85,220,350,1.0,1.2',
      'Slug_captain,7,true,StopAndGo,0.5,300,1.0,2.5,400',
      'BOSS1GREEN,12,true,Lissajous,0.5,140,40,70,1.5'
    ]
  };

  const J = x => {
    if (typeof x !== 'string') return x;
    try { return JSON.parse(x); } catch { return null; }
  };

  function loadLevels() {
    const raw = J(localStorage.getItem(KEY));
    let a = [];
    if (Array.isArray(raw)) a = raw.map(J);
    else if (raw && Array.isArray(raw.entities)) a = [raw];
    else if (raw && typeof raw === 'object') {
      a = Object.entries(raw).map(([k, v]) => {
        v = J(v);
        return v && { ...v, id: v.id || k };
      });
    }
    a = a.filter(l => l && Array.isArray(l.entities));
    return a.length ? a : [DEMO];
  }

  // Parsing 100% compatibile con WaveEditor:
  // type, delay, on, mover, startPosition, ...specificArgs
  function parseEnt(s) {
    const p = String(s).split(',').map(x => x.trim());
    if (!p[0]) return null;
    return {
      name: p[0],
      delay: +p[1] || 0,
      on: p[2] !== 'false',
      mover: p[3] || 'Lissajous',
      startPos: isNaN(+p[4]) ? 0.5 : Math.max(0, Math.min(1, +p[4])),
      args: p.slice(5).map(Number)
    };
  }

  let levels = loadLevels(), sel = 0;

  document.getElementById('imp').onchange = async e => {
    const cur = loadLevels().filter(l => l !== DEMO);
    for (const f of e.target.files) {
      const o = J(await f.text());
      if (o && Array.isArray(o.entities)) {
        o.id = o.id || f.name.replace(/\.json$/i, '');
        cur.push(o);
      }
    }
    localStorage.setItem(KEY, JSON.stringify(cur));
    levels = loadLevels();
    sel = 0;
    e.target.value = '';
  };

  document.getElementById('clr').onclick = () => {
    localStorage.removeItem(KEY);
    levels = loadLevels();
    sel = 0;
  };

  /* ---------- Pixi.js Setup ---------- */
  const app = new PIXI.Application();
  await app.init({ width: W, height: H, background: 0x03030c, antialias: true });
  document.getElementById('stage').appendChild(app.canvas);

  // Caricamento texture PNG
  const shipTex = await PIXI.Assets.load('assets/ppss.png');
  const slugTex = await PIXI.Assets.load('assets/slug.png');

  const bg = new PIXI.Container(), world = new PIXI.Container(), ui = new PIXI.Container();
  app.stage.addChild(bg, world, ui);

  const T = (s, x, y, size, c) => {
    const t = new PIXI.Text({
      text: s,
      style: { fill: 0xdfe9ff, fontFamily: 'monospace', fontSize: size, align: 'center' }
    });
    if (c) t.anchor.set(0.5);
    t.position.set(x, y);
    ui.addChild(t);
    return t;
  };

  const hud = T('', 12, 8, 16), msg = T('', W / 2, H / 2, 22, true);
  const stars = [];
  for (let i = 0; i < 90; i++) {
    const l = 1 + i % 3;
    const g = new PIXI.Graphics().rect(0, 0, l, l).fill(0xffffff);
    g.alpha = .25 + l * .2;
    g.position.set(Math.random() * W, Math.random() * H);
    g.sp = l * 40;
    bg.addChild(g);
    stars.push(g);
  }

  /* ---------- Input (Tastiera + Gamepad) ---------- */
  const K = {}, prev = {};
  addEventListener('keydown', e => {
    K[e.code] = 1;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', e => { K[e.code] = 0; });
  const edge = (k, v) => { const r = v && !prev[k]; prev[k] = v; return r; };

  function input() {
    const i = {
      x: 0, y: 0,
      fire: !!(K.Space || K.KeyZ || K.KeyX),
      up: !!(K.ArrowUp || K.KeyW),
      down: !!(K.ArrowDown || K.KeyS),
      ok: !!(K.Enter || K.Space)
    };
    if (K.ArrowLeft || K.KeyA) i.x--;
    if (K.ArrowRight || K.KeyD) i.x++;
    if (i.up) i.y--;
    if (i.down) i.y++;

    const g = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (g) {
      const b = n => !!g.buttons[n]?.pressed, ax = g.axes[0] || 0, ay = g.axes[1] || 0;
      if (Math.abs(ax) > .2) i.x += ax;
      if (Math.abs(ay) > .2) i.y += ay;
      if (b(14)) i.x--; if (b(15)) i.x++;
      if (b(12)) i.y--; if (b(13)) i.y++;
      i.fire = i.fire || b(0) || b(2) || b(7);
      i.ok = i.ok || b(0) || b(9);
      i.up = i.up || b(12) || ay < -.5;
      i.down = i.down || b(13) || ay > .5;
    }
    i.x = Math.max(-1, Math.min(1, i.x));
    i.y = Math.max(-1, Math.min(1, i.y));
    return i;
  }

  /* ---------- Gioco ---------- */
  let st = 'menu', pl, bul = [], eb = [], en = [], fx = [], q = [], lt = 0, score = 0, lives = 3, lvl;
  const col = n => /GREEN/i.test(n) ? 0x44ff77 : /egg/i.test(n) ? 0xffd866 : /shell/i.test(n) ? 0xff7a59 : 0xc77dff;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function start() {
    world.removeChildren();
    bul = []; eb = []; en = []; fx = []; q = [];
    lt = 0; score = 0; lives = 3;
    lvl = levels[sel];

    for (const s of lvl.entities) {
      const d = parseEnt(s);
      if (!d || !d.on) continue;
      q.push({ d, time: d.delay });
    }
    q.sort((a, b) => a.time - b.time);


  const g = new PIXI.Sprite(shipTex);
  g.anchor.set(0.5); // Centra il perno dello sprite
  
  // Opzionale: scala la nave se è troppo grande/piccola (ad es. larghezza ~48px)
  const shipTargetW = 48;
  const shipScale = shipTargetW / shipTex.width;
  g.scale.set(shipScale);
  world.addChild(g);
  pl = { g, x: 90, y: H / 2, cd: 0, inv: 0 };
  g.position.set(pl.x, pl.y);
  st = 'play';
  }

  function mkB(list, x, y, vx, vy, c, r) {
    const g = new PIXI.Graphics().circle(0, 0, r).fill(c);
    g.position.set(x, y);
    world.addChild(g);
    list.push({ g, x, y, vx, vy, r });
  }

  function spawn(d) {
    const boss = /^BOSS/i.test(d.name);
    const r = boss ? 44 : 20;

    // Sprite slug
    const g = new PIXI.Sprite(slugTex);
    g.anchor.set(0.5); // Centra il perno

    // Dimensionamento: r * 2 di larghezza/altezza
    const targetSize = r * 2.2;
    g.width = targetSize;
    g.height = targetSize;

    // Se il nemico è una variante colorata (es. BOSS1GREEN, Slug_shell, ecc.)
    // possiamo applicare una tinta (tint) allo sprite:
    g.tint = col(d.name);

    // 0 = basso, 1 = alto -> H * (1 - startPos)
    const y0 = H * (1 - d.startPos);
    world.addChild(g);

    en.push({
      g, d, boss, r,
      x: W + r + 10,
      y: y0,
      y0,
      t: 0,
      phase: 'ENTER',
      phaseTimer: 0,
      bobbingTimer: 0,
      curAngle: (d.mover === 'Circular' ? (d.args[3] || 0) : 0),
      hp: boss ? 80 : 3,
      cd: 1 + Math.random() * 2,
      dead: false
    });
  }

  function boom(x, y, big) {
    const g = new PIXI.Graphics().circle(0, 0, big ? 40 : 16).fill(0xffc34d);
    g.position.set(x, y);
    world.addChild(g);
    fx.push({ g, t: 0, life: big ? .6 : .3 });
  }

  function hit() {
    if (pl.inv > 0) return;
    lives--;
    pl.inv = 1.8;
    boom(pl.x, pl.y, false);
    if (lives <= 0) st = 'over';
  }

  function fire(e) {
    const a = Math.atan2(pl.y - e.y, pl.x - e.x);
    for (const o of e.boss ? [-.25, 0, .25] : [0]) {
      mkB(eb, e.x, e.y, Math.cos(a + o) * 230, Math.sin(a + o) * 230, 0xff4466, 5);
    }
  }

  /* ---------- Fisica Traiettorie (WaveEditor Engine) ---------- */
  function updateEnemyMovement(e, dt) {
    e.t += dt;
    const t = e.t;
    const args = e.d.args;

    switch (e.d.mover) {
      case 'Lissajous': {
        // [baseSpeedX, ampX, ampY, freq]
        const bx = -Math.abs(args[0] ?? 160);
        const ax = args[1] ?? 50;
        const ay = args[2] ?? 50;
        const f = args[3] ?? 1.5;
        e.x = (W + e.r + 10) + bx * t + ax * Math.sin(f * t);
        e.y = e.y0 - ay * Math.sin(2 * f * t); // Simmetrico attorno a y0
        break;
      }

      case 'Swoop': {
        // [enterSpeed, swoopSpeed, diveDelay, diveDuration]
        const enterSpeed = -Math.abs(args[0] ?? 200);
        const swoopSpeed = Math.abs(args[1] ?? 350);
        const diveDelay = args[2] ?? 1.0;
        const diveDuration = (args[3] && args[3] > 0) ? args[3] : 1.2;

        let vx = enterSpeed, vy = 0;
        if (t < diveDelay) {
          vx = enterSpeed;
          vy = 0;
        } else if (t < diveDelay + diveDuration) {
          const diveProgress = (t - diveDelay) / diveDuration;
          const sinFactor = Math.sin(diveProgress * Math.PI);
          vx = enterSpeed - (sinFactor * swoopSpeed * 0.5);
          vy = sinFactor * swoopSpeed; // Scende verso il basso
        } else {
          vx = enterSpeed * 1.5;
          vy = 0;
        }
        e.x += vx * dt;
        e.y += vy * dt;
        break;
      }

      case 'StopAndGo': {
        // [enterSpeed, enterDuration, hoverDuration, retreatSpeed]
        const enterSpeed = -Math.abs(args[0] ?? 300);
        const enterDuration = Math.max(0.01, args[1] ?? 1.0);
        const hoverDuration = Math.max(0, args[2] ?? 2.5);
        const retreatSpeed = args[3] ?? 400;

        e.phaseTimer += dt;
        let vx = 0, vy = 0;

        if (e.phase === 'ENTER') {
          const progress = Math.min(1.0, e.phaseTimer / enterDuration);
          vx = enterSpeed * (1.0 - progress);
          if (e.phaseTimer >= enterDuration) {
            e.phase = 'HOVER';
            e.phaseTimer = 0;
          }
        } else if (e.phase === 'HOVER') {
          e.bobbingTimer += dt * 4.0;
          vx = 0;
          vy = -Math.cos(e.bobbingTimer) * 40.0;
          if (e.phaseTimer >= hoverDuration) {
            e.phase = 'RETREAT';
            e.phaseTimer = 0;
          }
        } else if (e.phase === 'RETREAT') {
          const progress = Math.min(1.0, e.phaseTimer * 2.0);
          vx = -retreatSpeed * progress;
        }

        e.x += vx * dt;
        e.y += vy * dt;
        break;
      }

      case 'Circular': {
        // [hSpeed, radius, angularSpeed, startAngle]
        const hSpeed = -Math.abs(args[0] ?? 180);
        const radius = args[1] ?? 100;
        const angularSpeed = args[2] ?? 3.0;

        e.curAngle += angularSpeed * dt;
        const vxCircle = -Math.sin(e.curAngle) * (radius * angularSpeed);
        const vyCircle = -Math.cos(e.curAngle) * (radius * angularSpeed);

        e.x += (hSpeed + vxCircle) * dt;
        e.y += vyCircle * dt;
        break;
      }

      default: {
        e.x -= 150 * dt;
      }
    }

    if (e.boss && e.x < W - 150) e.x = W - 150;
    e.g.position.set(e.x, e.y);
  }

  function play(dt) {
    const i = input();
    lt += dt;

    // Spawna entità che hanno raggiunto il loro delay
    while (q.length && q[0].time <= lt) {
      spawn(q.shift().d);
    }

    // Player
    pl.x = Math.max(20, Math.min(W - 20, pl.x + i.x * 320 * dt));
    pl.y = Math.max(16, Math.min(H - 16, pl.y + i.y * 320 * dt));
    pl.g.position.set(pl.x, pl.y);
    pl.inv = Math.max(0, pl.inv - dt);
    pl.g.alpha = pl.inv > 0 && (pl.inv * 10 | 0) % 2 ? .3 : 1;

    if ((pl.cd -= dt) <= 0 && i.fire) {
      pl.cd = .13;
      mkB(bul, pl.x + 22, pl.y, 700, 0, 0xfff27a, 3);
    }

    // Aggiorna nemici
    for (const e of en) {
      updateEnemyMovement(e, dt);

      if (e.x < W - 10 && (e.cd -= dt) <= 0) {
        e.cd = e.boss ? .8 : 2 + Math.random() * 2;
        fire(e);
      }
      if (!e.boss && (e.x < -e.r - 80 || e.x > W + e.r + 200)) e.dead = true;
      if (!e.dead && dist(e, pl) < e.r + 10) {
        hit();
        if (!e.boss) { e.dead = true; boom(e.x, e.y); }
      }
    }

    // Proiettili player
    for (const b of bul) {
      b.x += b.vx * dt;
      b.g.x = b.x;
      if (b.x > W + 10) b.dead = true;
      for (const e of en) {
        if (!b.dead && !e.dead && dist(b, e) < e.r + b.r) {
          b.dead = true;
          e.hp--;
          if (e.hp <= 0) {
            e.dead = true;
            score += e.boss ? 1000 : 100;
            boom(e.x, e.y, e.boss);
          }
        }
      }
    }

    // Proiettili nemici
    for (const b of eb) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.g.position.set(b.x, b.y);
      if (b.x < -10 || b.x > W + 10 || b.y < -10 || b.y > H + 10) b.dead = true;
      else if (dist(b, pl) < b.r + 8) {
        b.dead = true;
        hit();
      }
    }

    // Effetti particellari
    for (const f of fx) {
      f.t += dt;
      f.g.scale.set(1 + f.t * 3);
      f.g.alpha = Math.max(0, 1 - f.t / f.life);
      if (f.t >= f.life) f.dead = true;
    }

    // Cleanup oggetti distrutti
    for (const arr of ['bul', 'eb', 'en', 'fx']) {
      const list = { bul, eb, en, fx }[arr];
      for (const o of list) if (o.dead) o.g.destroy();
    }
    bul = bul.filter(o => !o.dead);
    eb = eb.filter(o => !o.dead);
    en = en.filter(o => !o.dead);
    fx = fx.filter(o => !o.dead);

    hud.text = `SCORE ${score}   VITE ${Math.max(0, lives)}   ${lvl.id || 'level'}${lvl.meta ? ' · ' + lvl.meta : ''}`;
    if (st === 'play' && !q.length && !en.length && lt >= (+lvl.duration || 0)) st = 'win';
  }

  /* ---------- Main Loop ---------- */
  app.ticker.add(tk => {
    const dt = Math.min(.05, tk.deltaMS / 1000);
    for (const s of stars) {
      s.x -= s.sp * dt;
      if (s.x < -2) { s.x = W + 2; s.y = Math.random() * H; }
    }

    const i = input(), ok = edge('ok', i.ok), up = edge('up', i.up), dn = edge('dn', i.down);

    if (st === 'menu') {
      if (up) sel = (sel + levels.length - 1) % levels.length;
      if (dn) sel = (sel + 1) % levels.length;
      hud.text = '';
      msg.text = 'SPACE SHMUP - SIMONETTA ENGINE\n\n' +
        levels.map((l, n) => `${n === sel ? '>' : ' '} ${l.id || 'level ' + (n + 1)}${l.meta ? ' (' + l.meta + ')' : ''} [${l.entities.length} nemici]`).join('\n') +
        '\n\n↑↓ scegli · Invio / Spazio / A = start\nFrecce/WASD + Spazio · oppure Gamepad';
      if (ok) { msg.text = ''; start(); }
    } else if (st === 'play') {
      msg.text = '';
      play(dt);
    } else {
      msg.text = (st === 'win' ? 'LIVELLO COMPLETATO!' : 'GAME OVER') + `\nScore ${score}\n\nInvio / A per tornare al menu`;
      play(dt * 0 + 0.0001);
      if (ok) { world.removeChildren(); st = 'menu'; }
    }
  });
})();
