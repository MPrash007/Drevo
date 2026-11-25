'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

type HoleBackgroundProps = React.ComponentProps<'div'> & {
  strokeColor?: string;
  numberOfLines?: number;
  numberOfDiscs?: number;
  particleRGBColor?: [number, number, number];
};

type Point = { x: number; y: number };
type DiscBounds = Point & { w: number; h: number };
type Disc = DiscBounds & { p: number };
type Particle = Point & { sx: number; dx: number; vy: number; p: number; r: number; c: string };
type Scene = {
  discs: Disc[];
  lines: Point[][];
  particles: Particle[];
  clip: { disc: DiscBounds; path: Path2D | null };
  startDisc: DiscBounds;
  endDisc: DiscBounds;
  rect: { width: number; height: number };
  render: { width: number; height: number; dpi: number };
  particleArea: { sw: number; ew: number; h: number; sx: number; ex: number };
  linesCanvas: HTMLCanvasElement | null;
};
const emptyDisc = { x: 0, y: 0, w: 0, h: 0 };
const DEFAULT_PARTICLE: [number, number, number] = [255, 255, 255];

function HoleBackground({
  strokeColor = '#737373',
  numberOfLines = 50,
  numberOfDiscs = 50,
  particleRGBColor = DEFAULT_PARTICLE,
  animated = true,
  className,
  children,
  ...props
}: HoleBackgroundProps & { animated?: boolean }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [motionOn, setMotionOn] = React.useState(false);
  const stateRef = React.useRef<Scene>({
    discs: [],
    lines: [],
    particles: [],
    clip: { disc: emptyDisc, path: null },
    startDisc: emptyDisc,
    endDisc: emptyDisc,
    rect: { width: 0, height: 0 },
    render: { width: 0, height: 0, dpi: 1 },
    particleArea: { sw: 0, ew: 0, h: 0, sx: 0, ex: 0 },
    linesCanvas: null,
  });

  const linear = (p: number) => p;
  const easeInExpo = (p: number) => (p === 0 ? 0 : Math.pow(2, 10 * (p - 1)));

  const tweenValue = React.useCallback(
    (start: number, end: number, p: number, ease: 'inExpo' | null = null) => {
      const delta = end - start;
      const easeFn = ease === 'inExpo' ? easeInExpo : linear;
      return start + delta * easeFn(p);
    },
    [],
  );

  const tweenDisc = React.useCallback(
    (disc: Disc) => {
      const { startDisc, endDisc } = stateRef.current;
      disc.x = tweenValue(startDisc.x, endDisc.x, disc.p);
      disc.y = tweenValue(startDisc.y, endDisc.y, disc.p, 'inExpo');
      disc.w = tweenValue(startDisc.w, endDisc.w, disc.p);
      disc.h = tweenValue(startDisc.h, endDisc.h, disc.p);
    },
    [tweenValue],
  );

  const setSize = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    stateRef.current.rect = { width: rect.width, height: rect.height };
    stateRef.current.render = {
      width: rect.width,
      height: rect.height,
      dpi: window.devicePixelRatio || 1,
    };
    canvas.width = stateRef.current.render.width * stateRef.current.render.dpi;
    canvas.height =
      stateRef.current.render.height * stateRef.current.render.dpi;
  }, []);

  const setDiscs = React.useCallback(() => {
    const { width, height } = stateRef.current.rect;
    stateRef.current.discs = [];
    stateRef.current.startDisc = {
      x: width * 0.5,
      y: height * 0.45,
      w: width * 0.75,
      h: height * 0.7,
    };
    stateRef.current.endDisc = {
      x: width * 0.5,
      y: height * 0.95,
      w: 0,
      h: 0,
    };
    let prevBottom = height;
    let clipDisc = stateRef.current.startDisc;
    for (let i = 0; i < numberOfDiscs; i++) {
      const p = i / numberOfDiscs;
      const disc = { p, x: 0, y: 0, w: 0, h: 0 };
      tweenDisc(disc);
      const bottom = disc.y + disc.h;
      if (bottom <= prevBottom) {
        clipDisc = { ...disc };
      }
      prevBottom = bottom;
      stateRef.current.discs.push(disc);
    }
    const clipPath = new Path2D();
    const disc = clipDisc;
    clipPath.ellipse(disc.x, disc.y, disc.w, disc.h, 0, 0, Math.PI * 2);
    clipPath.rect(disc.x - disc.w, 0, disc.w * 2, disc.y);
    stateRef.current.clip = { disc, path: clipPath };
  }, [numberOfDiscs, tweenDisc]);

  const setLines = React.useCallback(() => {
    const { width, height } = stateRef.current.rect;
    stateRef.current.lines = [];
    const linesAngle = (Math.PI * 2) / numberOfLines;
    for (let i = 0; i < numberOfLines; i++) {
      stateRef.current.lines.push([]);
    }
    stateRef.current.discs.forEach((disc) => {
      for (let i = 0; i < numberOfLines; i++) {
        const angle = i * linesAngle;
        const p = {
          x: disc.x + Math.cos(angle) * disc.w,
          y: disc.y + Math.sin(angle) * disc.h,
        };
        stateRef.current.lines[i].push(p);
      }
    });
    const offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;
    const ctx = offCanvas.getContext('2d');
    const path = stateRef.current.clip.path;
    if (!ctx || !path) return;
    stateRef.current.lines.forEach((line) => {
      ctx.save();
      let lineIsIn = false;
      line.forEach((p1, j) => {
        if (j === 0) return;
        const p0 = line[j - 1];
        if (
          !lineIsIn &&
          (ctx.isPointInPath(path, p1.x, p1.y) ||
            ctx.isPointInStroke(path, p1.x, p1.y))
        ) {
          lineIsIn = true;
        } else if (lineIsIn) {
          ctx.clip(path);
        }
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.closePath();
      });
      ctx.restore();
    });
    stateRef.current.linesCanvas = offCanvas;
  }, [numberOfLines, strokeColor]);

  const particleColor = particleRGBColor.join(',');
  const initParticle = React.useCallback(
    (start: boolean = false) => {
      const [red, green, blue] = particleColor.split(',').map(Number);
      const sx =
        stateRef.current.particleArea.sx +
        stateRef.current.particleArea.sw * Math.random();
      const ex =
        stateRef.current.particleArea.ex +
        stateRef.current.particleArea.ew * Math.random();
      const dx = ex - sx;
      const y = start
        ? stateRef.current.particleArea.h * Math.random()
        : stateRef.current.particleArea.h;
      const r = 0.5 + Math.random() * 4;
      const vy = 0.5 + Math.random();
      return {
        x: sx,
        sx,
        dx,
        y,
        vy,
        p: 0,
        r,
        c: `rgba(${red}, ${green}, ${blue}, ${Math.random()})`,
      };
    },
    [particleColor],
  );

  const setParticles = React.useCallback(() => {
    const { width, height } = stateRef.current.rect;
    stateRef.current.particles = [];
    const disc = stateRef.current.clip.disc;
    const sw = disc.w * 0.5, ew = disc.w * 2;
    stateRef.current.particleArea = { sw, ew, h: height * 0.85, sx: (width - sw) / 2, ex: (width - ew) / 2 };
    const totalParticles = 100;
    for (let i = 0; i < totalParticles; i++) {
      stateRef.current.particles.push(initParticle(true));
    }
  }, [initParticle]);

  const drawDiscs = React.useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      const outerDisc = stateRef.current.startDisc;
      ctx.beginPath();
      ctx.ellipse(
        outerDisc.x,
        outerDisc.y,
        outerDisc.w,
        outerDisc.h,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.closePath();
      const { path, disc: clippedDisc } = stateRef.current.clip;
      stateRef.current.discs.forEach((disc, i) => {
        if (i % 5 !== 0) return;
        if (path && disc.w < clippedDisc.w - 5) {
          ctx.save();
          ctx.clip(path);
        }
        ctx.beginPath();
        ctx.ellipse(disc.x, disc.y, disc.w, disc.h, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.closePath();
        if (path && disc.w < clippedDisc.w - 5) {
          ctx.restore();
        }
      });
    },
    [strokeColor],
  );

  const drawLines = React.useCallback((ctx: CanvasRenderingContext2D) => {
    if (stateRef.current.linesCanvas) {
      ctx.drawImage(stateRef.current.linesCanvas, 0, 0);
    }
  }, []);

  const drawParticles = React.useCallback((ctx: CanvasRenderingContext2D) => {
    const path = stateRef.current.clip.path;
    if (!path) return;
    ctx.save();
    ctx.clip(path);
    stateRef.current.particles.forEach((particle) => {
      ctx.fillStyle = particle.c;
      ctx.beginPath();
      ctx.rect(particle.x, particle.y, particle.r, particle.r);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }, []);

  const moveDiscs = React.useCallback(() => {
    stateRef.current.discs.forEach((disc) => {
      disc.p = (disc.p + 0.001) % 1;
      tweenDisc(disc);
    });
  }, [tweenDisc]);

  const moveParticles = React.useCallback(() => {
    if (!stateRef.current.particleArea.h) return;
    stateRef.current.particles.forEach((particle, idx) => {
      particle.p = 1 - particle.y / stateRef.current.particleArea.h;
      particle.x = particle.sx + particle.dx * particle.p;
      particle.y -= particle.vy;
      if (particle.y < 0) {
        stateRef.current.particles[idx] = initParticle();
      }
    });
  }, [initParticle]);

  const tick = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(stateRef.current.render.dpi, stateRef.current.render.dpi);
    moveDiscs();
    moveParticles();
    drawDiscs(ctx);
    drawLines(ctx);
    drawParticles(ctx);
    ctx.restore();
  }, [moveDiscs, moveParticles, drawDiscs, drawLines, drawParticles]);

  const init = React.useCallback(() => {
    setSize();
    setDiscs();
    setLines();
    setParticles();
  }, [setSize, setDiscs, setLines, setParticles]);

  React.useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    init();

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let onScreen = true;
    let frame = 0;
    let stopped = false;

    const draw = () => {
      tick();
    };
    const stopLoop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const sync = () => {
      if (stopped) return;
      const hidden = document.visibilityState === 'hidden';
      const run = animated && onScreen && !hidden && !reduce.matches;
      setMotionOn(run);
      if (!run) {
        stopLoop();
        draw();
        return;
      }
      if (frame) return;
      const loop = () => {
        if (stopped) return;
        draw();
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    };

    sync();
    let observer: IntersectionObserver | undefined;
    if (animated && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(([entry]) => {
        if (stopped) return;
        onScreen = entry.isIntersecting;
        sync();
      });
      observer.observe(root);
    }
    const onReduce = () => sync();
    const onVisibility = () => sync();
    reduce.addEventListener('change', onReduce);
    document.addEventListener('visibilitychange', onVisibility);
    const handleResize = () => {
      setSize();
      setDiscs();
      setLines();
      setParticles();
      draw();
    };
    window.addEventListener('resize', handleResize);
    return () => {
      stopped = true;
      stopLoop();
      observer?.disconnect();
      reduce.removeEventListener('change', onReduce);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', handleResize);
    };
  }, [animated, init, tick, setSize, setDiscs, setLines, setParticles]);

  return (
    <div
      data-slot="hole-background"
      className={cn(
        'relative size-full overflow-hidden',
        'before:content-[""] before:absolute before:top-1/2 before:left-1/2 before:block before:size-[140%] dark:before:[background:radial-gradient(ellipse_at_50%_55%,transparent_10%,black_50%)] before:[background:radial-gradient(ellipse_at_50%_55%,transparent_10%,white_50%)] before:[transform:translate3d(-50%,-50%,0)]',
        'after:content-[""] after:absolute after:z-[5] after:top-1/2 after:left-1/2 after:block after:size-full after:[background:radial-gradient(ellipse_at_50%_75%,#a900ff_20%,transparent_75%)] after:[transform:translate3d(-50%,-50%,0)] after:mix-blend-overlay',
        className,
      )}
      {...props}
      ref={rootRef}
      aria-hidden="true"
    >
      {children}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block size-full dark:opacity-20 opacity-10"
      />
      <div
        className={cn(
          'absolute top-[-71.5%] left-1/2 z-[3] w-[30%] h-[140%] rounded-b-full blur-3xl opacity-75 dark:mix-blend-plus-lighter mix-blend-plus-darker [transform:translate3d(-50%,0,0)] [background-position:0%_100%] [background-size:100%_200%]',
          'dark:[background:linear-gradient(20deg,#00f8f1,#ffbd1e20_16.5%,#fe848f_33%,#fe848f20_49.5%,#00f8f1_66%,#00f8f160_85.5%,#ffbd1e_100%)_0_100%_/_100%_200%] [background:linear-gradient(20deg,#00f8f1,#ffbd1e40_16.5%,#fe848f_33%,#fe848f40_49.5%,#00f8f1_66%,#00f8f180_85.5%,#ffbd1e_100%)_0_100%_/_100%_200%]',
          motionOn && 'motion-safe:animate-[drevo-hero-wash_5s_linear_infinite]',
        )}
      />
      <div className="absolute top-0 left-0 z-[7] size-full dark:[background:repeating-linear-gradient(transparent,transparent_1px,white_1px,white_2px)] mix-blend-overlay opacity-50" />
    </div>
  );
}

export { HoleBackground, type HoleBackgroundProps };
