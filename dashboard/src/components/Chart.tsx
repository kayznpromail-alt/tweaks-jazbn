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
    const w = rect.width - 4;
    const h = 200;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!buckets?.length) {
      ctx.fillStyle = '#6b6d7b';
      ctx.font = '13px Inter, sans-serif';
      ctx.fillText('No data', w / 2 - 20, h / 2);
      return;
    }

    const max = Math.max(...buckets.map(b => b.tokens)) || 1;
    const padL = 44, padR = 10, padT = 10, padB = 28;
    const cw = w - padL - padR, ch = h - padT - padB;
    const barW = cw / buckets.length;

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + ch * (1 - i / 4);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#6b6d7b';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(fmtTokens(max * i / 4), padL - 6, y + 3);
    }

    const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
    grad.addColorStop(0, '#8b5cf6');
    grad.addColorStop(1, '#6c5ce7');
    ctx.fillStyle = grad;

    buckets.forEach((b, i) => {
      const bh = (b.tokens / max) * ch;
      const x = padL + i * barW + 1;
      const bw = Math.max(barW - 2, 2);
      const r = Math.min(4, bw / 2);
      const y = padT + ch - bh;
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

    ctx.fillStyle = 'rgba(108,92,231,0.08)';
    buckets.forEach((b, i) => {
      const bh = (b.tokens / max) * ch;
      const x = padL + i * barW - 1;
      const bw = Math.max(barW + 2, 4);
      const y = padT + ch - bh - 4;
      ctx.fillRect(x, y, bw, bh + 4);
    });

    ctx.fillStyle = '#6b6d7b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(buckets.length / 6));
    buckets.forEach((b, i) => {
      if (i % step !== 0 && i !== buckets.length - 1) return;
      const d = new Date(b.start);
      const label = range === '24h' ? d.getHours() + ':00' : (d.getMonth() + 1) + '/' + d.getDate();
      ctx.fillText(label, padL + i * barW + barW / 2, h - 6);
    });
  }, [buckets, range]);

  return <canvas ref={ref} className="w-full rounded-lg" />;
}
