/* Starfield, nebula clouds and black hole background. Static layers are pre-rendered to an offscreen canvas;
   only twinkle, accretion disk rotation and in-falling particles animate (30 fps, paused when hidden;
   reduced-motion preferences render a still frame instead). */
(() => {
  const canvas = document.getElementById('space');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let staticLayer = null;
  let stars = [], twinkle = [], particles = [];
  let bh = { x: 0, y: 0, r: 0 };
  let t = 0, last = 0, raf = 0;
  const FPS = 30;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function buildStatic() {
    staticLayer = document.createElement('canvas');
    staticLayer.width = W * dpr; staticLayer.height = H * dpr;
    const c = staticLayer.getContext('2d');
    c.scale(dpr, dpr);
    // base
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#05040f'); g.addColorStop(.5, '#060716'); g.addColorStop(1, '#03030a');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // nebula clouds
    const clouds = [
      { x: .18, y: .25, r: .42, col: [139, 92, 246], a: .22 },
      { x: .32, y: .70, r: .36, col: [236, 72, 153], a: .14 },
      { x: .62, y: .18, r: .40, col: [34, 211, 238], a: .13 },
      { x: .85, y: .55, r: .30, col: [245, 165, 36], a: .10 },
      { x: .50, y: .50, r: .55, col: [60, 40, 140], a: .16 },
      { x: .05, y: .85, r: .30, col: [34, 211, 238], a: .08 },
    ];
    c.globalCompositeOperation = 'lighter';
    for (const n of clouds) {
      const cx = n.x * W, cy = n.y * H, cr = n.r * Math.max(W, H);
      const rg = c.createRadialGradient(cx, cy, 0, cx, cy, cr);
      rg.addColorStop(0, `rgba(${n.col.join(',')},${n.a})`);
      rg.addColorStop(.45, `rgba(${n.col.join(',')},${n.a * .45})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = rg; c.fillRect(0, 0, W, H);
      // wispy filaments
      for (let i = 0; i < 26; i++) {
        const fx = cx + rnd(-cr, cr) * .8, fy = cy + rnd(-cr, cr) * .6, fr = rnd(cr * .08, cr * .3);
        const fg = c.createRadialGradient(fx, fy, 0, fx, fy, fr);
        fg.addColorStop(0, `rgba(${n.col.join(',')},${n.a * .35})`);
        fg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = fg; c.beginPath(); c.ellipse(fx, fy, fr * rnd(.6, 1.6), fr * rnd(.4, 1), rnd(0, Math.PI), 0, Math.PI * 2); c.fill();
      }
    }
    // dust lane (dark)
    c.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 14; i++) {
      const fx = rnd(0, W), fy = rnd(0, H), fr = rnd(60, 220);
      const fg = c.createRadialGradient(fx, fy, 0, fx, fy, fr);
      fg.addColorStop(0, 'rgba(3,3,10,.35)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = fg; c.beginPath(); c.ellipse(fx, fy, fr * 1.8, fr * .5, rnd(0, Math.PI), 0, Math.PI * 2); c.fill();
    }
    // static stars
    stars = [];
    const n = Math.floor((W * H) / 1800);
    for (let i = 0; i < n; i++) stars.push({ x: rnd(0, W), y: rnd(0, H), r: Math.random() < .9 ? rnd(.3, 1.1) : rnd(1.2, 2.2), a: rnd(.3, 1) });
    for (const s of stars) {
      c.fillStyle = `rgba(255,255,255,${s.a})`;
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill();
      if (s.r > 1.5) { // cross glare on big stars
        c.strokeStyle = `rgba(255,255,255,${s.a * .35})`; c.lineWidth = .6;
        c.beginPath(); c.moveTo(s.x - s.r * 4, s.y); c.lineTo(s.x + s.r * 4, s.y); c.moveTo(s.x, s.y - s.r * 4); c.lineTo(s.x, s.y + s.r * 4); c.stroke();
      }
    }
    // distant galaxy
    const gx = W * .12, gy = H * .62;
    c.save(); c.translate(gx, gy); c.rotate(-.5);
    const gg = c.createRadialGradient(0, 0, 0, 0, 0, 90);
    gg.addColorStop(0, 'rgba(255,240,220,.55)'); gg.addColorStop(.3, 'rgba(200,170,255,.18)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gg; c.beginPath(); c.ellipse(0, 0, 90, 28, 0, 0, Math.PI * 2); c.fill(); c.restore();

    twinkle = stars.filter(() => Math.random() < .12).map(s => Object.assign({}, s, { ph: rnd(0, 6.28), sp: rnd(.8, 2.4) }));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bh = { x: W * .86, y: H * .84, r: Math.min(W, H) * .095 };
    buildStatic();
    particles = [];
    for (let i = 0; i < 90; i++) particles.push(newParticle(true));
  }

  function newParticle(spread) {
    const ang = rnd(0, Math.PI * 2);
    const d = spread ? rnd(bh.r * 1.3, bh.r * 4.5) : bh.r * 4.5;
    return { ang, d, sp: rnd(.004, .012), fall: rnd(.08, .25), sz: rnd(.6, 1.8), hue: Math.random() < .6 ? [255, 190, 90] : [180, 150, 255] };
  }

  function drawBlackHole() {
    const { x, y, r } = bh;
    ctx.save();
    // ambient lensing glow
    const glow = ctx.createRadialGradient(x, y, r * .9, x, y, r * 5);
    glow.addColorStop(0, 'rgba(245,165,36,.16)'); glow.addColorStop(.4, 'rgba(139,92,246,.08)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, Math.PI * 2); ctx.fill();

    // accretion disk (tilted ellipse), back half
    const tilt = .32;
    const drawDisk = (half) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(1, tilt);
      const cg = ctx.createConicGradient(t * .9, 0, 0);
      cg.addColorStop(0, 'rgba(255,220,150,.95)'); cg.addColorStop(.18, 'rgba(245,165,36,.55)'); cg.addColorStop(.42, 'rgba(236,72,153,.35)');
      cg.addColorStop(.6, 'rgba(139,92,246,.45)'); cg.addColorStop(.8, 'rgba(255,200,120,.7)'); cg.addColorStop(1, 'rgba(255,220,150,.95)');
      ctx.lineWidth = r * .9; ctx.strokeStyle = cg; ctx.lineCap = 'butt';
      ctx.shadowBlur = 30; ctx.shadowColor = 'rgba(245,165,36,.6)';
      ctx.beginPath();
      if (half === 'back') ctx.arc(0, 0, r * 1.75, Math.PI, Math.PI * 2); else ctx.arc(0, 0, r * 1.75, 0, Math.PI);
      ctx.stroke();
      // thin bright inner edge
      ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,240,200,.8)';
      ctx.beginPath(); if (half === 'back') ctx.arc(0, 0, r * 1.32, Math.PI, Math.PI * 2); else ctx.arc(0, 0, r * 1.32, 0, Math.PI); ctx.stroke();
      ctx.restore();
    };
    drawDisk('back');
    // photon ring (vertical lensed arc over the top)
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,230,180,.85)'; ctx.shadowBlur = 18; ctx.shadowColor = 'rgba(255,200,120,.9)';
    ctx.beginPath(); ctx.arc(x, y, r * 1.12, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); ctx.restore();
    // event horizon
    const core = ctx.createRadialGradient(x, y, r * .7, x, y, r * 1.08);
    core.addColorStop(0, '#000'); core.addColorStop(.85, '#000'); core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, r * 1.08, 0, Math.PI * 2); ctx.fill();
    drawDisk('front');
    // in-falling particles
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      p.ang += p.sp * (bh.r * 3 / p.d); p.d -= p.fall;
      if (p.d < r * 1.05) Object.assign(p, newParticle(false));
      const px = x + Math.cos(p.ang) * p.d, py = y + Math.sin(p.ang) * p.d * tilt;
      const a = Math.min(1, (bh.r * 4.5 - p.d) / (bh.r * 2));
      ctx.fillStyle = `rgba(${p.hue.join(',')},${a * .9})`;
      ctx.beginPath(); ctx.arc(px, py, p.sz, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function paint() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(staticLayer, 0, 0, W, H);
    // twinkle
    for (const s of twinkle) {
      const a = .4 + .6 * Math.abs(Math.sin(t * s.sp + s.ph));
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (1 + .4 * a), 0, Math.PI * 2); ctx.fill();
    }
    drawBlackHole();
  }

  function frame(now) {
    raf = 0;
    if (document.hidden || motion.matches) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS) return;
    last = now; t += 1 / FPS;
    paint();
  }

  function syncMotion() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (document.hidden) return;
    if (motion.matches) paint();
    else raf = requestAnimationFrame(frame);
  }

  motion.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  window.addEventListener('resize', () => {
    resize();
    if (motion.matches && !document.hidden) paint();
  });
  resize();
  syncMotion();
})();
