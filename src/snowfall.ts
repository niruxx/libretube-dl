// Ambient particle drift behind the UI — small motes in the app's accent colors,
// falling slowly with a gentle sideways sway. Purely decorative, so it stays cheap
// (a few dozen particles, capped DPR, paused when the window isn't visible) and
// backs off entirely for users who've asked for reduced motion.

interface Particle {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  swayPhase: number;
  swayAmount: number;
  opacity: number;
  color: string;
}

const COLORS = [
  "124, 92, 255", // accent
  "217, 70, 239", // accent-2
  "255, 255, 255", // soft white motes for contrast
];

export function initSnowfall(canvasId: string, count = 55): void {
  const canvasEl = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvasEl) return;
  const canvas = canvasEl;

  const context = canvas.getContext("2d");
  if (!context) return;
  const ctx = context;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let particles: Particle[] = [];

  function makeParticle(randomY: boolean): Particle {
    const radius = 0.8 + Math.random() * 1.8;
    return {
      x: Math.random() * width,
      y: randomY ? Math.random() * height : -10,
      radius,
      speed: 8 + Math.random() * 16,
      drift: -6 + Math.random() * 12,
      swayPhase: Math.random() * Math.PI * 2,
      swayAmount: 6 + Math.random() * 14,
      opacity: 0.12 + Math.random() * 0.28,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    particles = Array.from({ length: count }, () => makeParticle(true));
  }

  resize();
  seed();

  if (reduceMotion) {
    // Static, faint scatter with no animation loop for reduced-motion users.
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.color}, ${p.opacity})`;
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    window.addEventListener("resize", () => {
      resize();
      seed();
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.color}, ${p.opacity})`;
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    return;
  }

  let lastTime = performance.now();
  let running = true;

  function step(now: number) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      p.y += p.speed * dt;
      p.swayPhase += dt * 0.6;
      p.x += p.drift * dt + Math.sin(p.swayPhase) * p.swayAmount * dt;

      if (p.y > height + 10) {
        Object.assign(p, makeParticle(false));
      } else if (p.x < -10) {
        p.x = width + 10;
      } else if (p.x > width + 10) {
        p.x = -10;
      }

      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.color}, ${p.opacity})`;
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(step);
  }

  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      lastTime = performance.now();
      requestAnimationFrame(step);
    }
  });

  window.addEventListener("resize", () => {
    const oldWidth = width || 1;
    const oldHeight = height || 1;
    const xScale = window.innerWidth / oldWidth;
    const yScale = window.innerHeight / oldHeight;
    resize();
    for (const p of particles) {
      p.x *= xScale;
      p.y *= yScale;
    }
  });

  requestAnimationFrame(step);
}
