import { useEffect, useRef } from 'react';
import { fmtTokens } from '@/lib/utils';

interface Bucket {
  start: number;
  tokens: number;
}

export default function Chart({ buckets, range }: { buckets: Bucket[]; range: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement!.getBoundingClientRect();
    const w = rect.width;
    const h = 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!buckets?.length) {
      ctx.fillStyle = '#626472';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data for this period', w / 2, h / 2);
      return;
    }

    const max = Math.max(...buckets.map(b => b.tokens)) || 1;
    const padL = 50, padR = 12, padT = 12, padB = 30;
    const cw = w - padL - padR, ch = h - padT - padB;
    const barW = cw / buckets.length;

    for (let i = 0; i <= 4; i++) {
      const y = padT + ch * (1 - i / 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#626472';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(fmtTokens(max * i / 4), padL - 8, y + 3);
    }

    const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
    grad.addColorStop(0, 'rgba(167,139,250,0.85)');
    grad.addColorStop(1, 'rgba(108,92,231,0.6)');

    buckets.forEach((b, i) => {
      const bh = (b.tokens / max) * ch;
      const x = padL + i * barW + 1.5;
      const bw = Math.max(barW - 3, 2);
      const r = Math.min(3, bw / 2);
      const y = padT + ch - bh;

      const glow = ctx.createLinearGradient(0, y, 0, padT + ch);
      glow.addColorStop(0, 'rgba(108,92,231,0.06)');
      glow.addColorStop(1, 'rgba(108,92,231,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 1, y, bw + 2, bh);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + bw - r, y);
      ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
      ctx.lineTo(x + bw, padT + ch);
      ctx.lineTo(x, padT + ch);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.fill();
    });

    ctx.fillStyle = '#626472';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(buckets.length / 6));
    buckets.forEach((b, i) => {
      if (i % step !== 0 && i !== buckets.length - 1) return;
      const d = new Date(b.start);
      const label = range === '24h' ? d.getHours() + ':00' : (d.getMonth() + 1) + '/' + d.getDate();
      ctx.fillText(label, padL + i * barW + barW / 2, h - 8);
    });
  }, [buckets, range]);

  return <canvas ref={ref} className="w-full" />;
}
