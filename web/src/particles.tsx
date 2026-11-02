import { useEffect, useRef } from 'react';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  px: number;
  py: number;
  size: number;
  alpha: number;
  tone: number;
  glow: boolean;
  phase: number;
  twinkle: number;
};

const repelRadius = 130; // px around the cursor that pushes particles away
const repelForce = 900; // px/s² at the cursor itself, fading to zero at the radius
const damping = 0.94; // share of the push kept per 60 fps frame (inertia)

function spawn(width: number, height: number): Particle {
  const angle = Math.random() * Math.PI * 2,
    speed = 3 + Math.random() * 11;
  const size = 0.5 + Math.random() ** 2 * 1.5;
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    px: 0,
    py: 0,
    size,
    alpha: 0.15 + Math.random() * 0.55,
    tone: 170 + Math.floor(Math.random() * 86),
    glow: size > 1.3 && Math.random() < 0.45,
    phase: Math.random() * Math.PI * 2,
    twinkle: 0.3 + Math.random() * 0.9,
  };
}

/** Full-viewport canvas of slowly drifting particles that drift away from the cursor; static when reduced motion is preferred. */
export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current!,
      ctx = canvas.getContext('2d');
    if (!ctx) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0,
      height = 0,
      frame = 0,
      last = 0;
    let particles: Particle[] = [];
    const pointer = { x: -1e4, y: -1e4 };

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      width = innerWidth;
      height = innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round(Math.min(400, Math.max(80, (width * height) / 4500)));
      particles = particles.filter(p => p.x <= width + 10 && p.y <= height + 10).slice(0, target);
      while (particles.length < target) particles.push(spawn(width, height));
      if (motion.matches) draw(0);
    }
    function draw(time: number) {
      ctx!.clearRect(0, 0, width, height);
      for (const p of particles) {
        const alpha = motion.matches ? p.alpha : p.alpha * (0.7 + 0.3 * Math.sin((time / 1000) * p.twinkle + p.phase));
        const color = `${p.tone},${p.tone},${Math.min(255, p.tone + 10)}`;
        if (p.glow) {
          ctx!.fillStyle = `rgba(${color},${alpha * 0.12})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.fillStyle = `rgba(${color},${alpha})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fill();
      }
    }
    function step(time: number) {
      const dt = Math.min(0.05, last ? (time - last) / 1000 : 0);
      last = time;
      const keep = damping ** (dt * 60);
      for (const p of particles) {
        const dx = p.x - pointer.x,
          dy = p.y - pointer.y,
          distance = Math.hypot(dx, dy);
        if (distance < repelRadius && distance > 0.01) {
          const push = repelForce * (1 - distance / repelRadius) ** 2 * dt;
          p.px += (dx / distance) * push;
          p.py += (dy / distance) * push;
        }
        p.px *= keep;
        p.py *= keep;
        p.x += (p.vx + p.px) * dt;
        p.y += (p.vy + p.py) * dt;
        // Wrap with a small margin so particles re-enter from the opposite edge out of sight.
        if (p.x < -10) p.x = width + 10;
        else if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        else if (p.y > height + 10) p.y = -10;
      }
      draw(time);
      frame = requestAnimationFrame(step);
    }
    function start() {
      cancelAnimationFrame(frame);
      last = 0;
      if (motion.matches) draw(0);
      else frame = requestAnimationFrame(step);
    }
    const move = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };
    const leave = () => {
      pointer.x = pointer.y = -1e4;
    };
    const lift = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') leave();
    };
    resize();
    start();
    addEventListener('resize', resize);
    addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    addEventListener('pointerup', lift);
    motion.addEventListener('change', start);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', resize);
      removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      removeEventListener('pointerup', lift);
      motion.removeEventListener('change', start);
    };
  }, []);
  return <canvas ref={canvasRef} className="particle-field" aria-hidden="true" />;
}
