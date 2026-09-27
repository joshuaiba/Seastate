import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../lib/hooks';
import { OceanRenderer, type SceneParams } from './renderer';

const layer = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' } as const;

/**
 * React wrapper around the scene renderer: a WebGL canvas for sky, sea and sand under a 2D canvas for
 * everything standing on them. React only hands it new params; the animation loop runs outside React.
 * It pauses when scrolled out of view or when the tab is hidden.
 */
export function OceanScene({ params, className }: { params: SceneParams; className?: string }) {
  const seaRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OceanRenderer | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const reduced = useReducedMotion();

  useEffect(() => {
    const sea = seaRef.current;
    const canvas = canvasRef.current;
    if (!sea || !canvas) return;
    const fine = window.matchMedia('(pointer: fine)').matches;
    const renderer = new OceanRenderer(sea, canvas, { reducedMotion: reduced, coarse: !fine });
    rendererRef.current = renderer;
    renderer.setParams(paramsRef.current);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    let inView = true;
    const syncVisibility = () => renderer.setVisible(inView && document.visibilityState === 'visible');
    const intersection = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? true;
      syncVisibility();
    });
    intersection.observe(canvas);
    document.addEventListener('visibilitychange', syncVisibility);

    // Depth cues, kept small: the camera shifts a little with the pointer (mice and trackpads only) and
    // rises as the page scrolls, so near things move more than far ones.
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      renderer.setPointer(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const onScroll = () => renderer.setScroll(Math.min(window.scrollY, 1200));
    if (!reduced) {
      if (fine) window.addEventListener('pointermove', onPointer, { passive: true });
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    renderer.start();
    return () => {
      renderer.stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', onScroll);
      rendererRef.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    rendererRef.current?.setParams(params);
  }, [params]);

  return (
    <div className={className} style={{ position: 'relative' }} aria-hidden="true">
      <canvas ref={seaRef} style={layer} />
      <canvas ref={canvasRef} style={layer} />
    </div>
  );
}
