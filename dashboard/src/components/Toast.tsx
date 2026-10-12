import { useEffect, useRef, useCallback } from 'react';

let showToastFn: ((msg: string) => void) | null = null;

export function toast(msg: string) {
  showToastFn?.(msg);
}

export function copyText(text: string) {
  navigator.clipboard?.writeText(text);
  toast('Copied!');
}

export default function Toast() {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback((msg: string) => {
    const el = ref.current;
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateY(0) scale(1)';
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px) scale(0.96)';
    }, 2500);
  }, []);

  useEffect(() => {
    showToastFn = show;
    return () => { showToastFn = null; };
  }, [show]);

  return (
    <div
      ref={ref}
      className="fixed bottom-6 right-6 z-[200] rounded-xl px-6 py-3.5 text-sm font-medium pointer-events-none"
      style={{
        background: 'var(--color-card2)',
        border: '1px solid var(--color-border2)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        opacity: 0,
        transform: 'translateY(10px) scale(0.96)',
        transition: 'all 0.3s cubic-bezier(0.23,1,0.32,1)',
      }}
    />
  );
}
