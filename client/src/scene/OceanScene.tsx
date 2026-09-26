import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../lib/hooks';
import { OceanRenderer, type SceneParams } from './renderer';

/**
 * React wrapper around the canvas renderer. React only hands it new params; the animation loop runs
 * outside React. It pauses when scrolled out of view or when the tab is hidden.
 */
export function OceanScene({ params, className }: { params: SceneParams; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OceanRenderer | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new OceanRenderer(canvas, { reducedMotion: reduced });
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

    // Gentle parallax on mice and trackpads only; touch has nothing to hover with.
    const fine = window.matchMedia('(pointer: fine)').matches;
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      renderer.setPointer(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
    };
    if (fine && !reduced) window.addEventListener('pointermove', onPointer, { passive: true });

    renderer.start();
    return () => {
      renderer.stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('pointermove', onPointer);
      rendererRef.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    rendererRef.current?.setParams(params);
  }, [params]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
