export const EDGEY_MAX_WIDTH = 240;
export const EDGEY_MAX_HEIGHT = 96;
export const EDGEY_WORD = "EDGEY";

type Primitive = (x: number, y: number, s: number) => number;
type Glyph = { advance: number; primitives: Primitive[] };
type Layout = {
  k: number; s: number; gap: number; wordWidth: number; extentX: number; extentY: number;
  originX: number; originY: number; step: number; columns: number; rows: number;
  distance: Float32Array; normals: Float32Array;
};

const tau = Math.PI * 2;
// extrusion depth in cap heights; the pointer range never exposes the rear.
const depth = 0.75;
export function logoPointerAngles(x: number, y: number, width: number, height: number): { yaw: number; pitch: number } {
  const axis = (value: number, size: number) => Number.isFinite(value) && size > 1
    ? Math.max(-1, Math.min(1, value / (size - 1) * 2 - 1)) : 0;
  const vertical = axis(y, height);
  return { yaw: axis(x, width) * 0.78, pitch: vertical === 0 ? 0 : -vertical * 0.65 };
}
const maxYaw = 1.2, maxPitch = 0.9;
const light = normalize(-0.45, -0.7, 0.6);
const half = normalize(light[0], light[1], light[2] + 1);

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function angle(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  let wrapped = value % tau;
  if (wrapped > Math.PI) wrapped -= tau;
  if (wrapped < -Math.PI) wrapped += tau;
  return Math.max(-limit, Math.min(limit, wrapped));
}

// rounded strokes: every primitive is a distance to a centerline minus the stroke radius,
// so ends, joints and corners are naturally round and the whole word is at least 2s thick.
function capsule(ax: number, ay: number, bx: number, by: number): Primitive {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  return (x, y, s) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
    return Math.hypot(ax + t * dx - x, ay + t * dy - y) - s;
  };
}

function ring(cx: number, cy: number, radius: number, squeeze: number): Primitive {
  return (x, y, s) => Math.abs(Math.hypot((x - cx) / squeeze, y - cy) - radius) - s;
}

// the d bowl is the outline of a box whose right corners are as round as the box allows.
function bowl(cx: number, cy: number, halfWidth: number, halfHeight: number, leftRadius: number): Primitive {
  return (x, y, s) => {
    const px = x - cx, py = y - cy;
    const radius = px > 0 ? Math.min(halfWidth - s, halfHeight - s) : leftRadius;
    const qx = Math.abs(px) - (halfWidth - s) + radius, qy = Math.abs(py) - (halfHeight - s) + radius;
    const outline = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
    return Math.abs(outline) - s;
  };
}

// cap height is 1, y grows downward. strokes are inset by the radius so the word
// starts at x = 0 and y = 0.
const glyphs: { advance: number; strokes: ((s: number) => Primitive)[] }[] = [
{ advance: 0.80, strokes: [s=>capsule(s,s,s,1-s),s=>capsule(s,s,.80-s,s),s=>capsule(s,.5,.68-s,.5),s=>capsule(s,1-s,.80-s,1-s)] },
{ advance: 0.80, strokes: [()=>bowl(.40,.5,.40,.5,.04)] },
{ advance: 0.92, strokes: [s=>(x,y,r)=>x>.49&&y<.53 ? Infinity : ring(.46,.5,.5-s,.92)(x,y,r),s=>capsule(.48,.53,.92-s,.53),s=>capsule(.92-s,.53,.92-s,.78)] },
{ advance: 0.80, strokes: [s=>capsule(s,s,s,1-s),s=>capsule(s,s,.80-s,s),s=>capsule(s,.5,.68-s,.5),s=>capsule(s,1-s,.80-s,1-s)] },
{ advance: 0.90, strokes: [s=>capsule(s,s,.45,.52),s=>capsule(.90-s,s,.45,.52),s=>capsule(.45,.52,.45,1-s)] },
];
const tailX = 0.94, tailY = 1.04;

function buildWord(s: number, letters: typeof glyphs): Glyph[] {
  return letters.map((glyph) => ({ advance: glyph.advance, primitives: glyph.strokes.map((stroke) => stroke(s)) }));
}

function distanceToWord(word: Glyph[], x: number, y: number, s: number, gap: number): number {
  let best = Infinity, offset = 0;
  for (const glyph of word) {
    if (x >= offset - 0.4 && x <= offset + glyph.advance + 0.4) {
      for (const primitive of glyph.primitives) {
        const d = primitive(x - offset, y, s);
        if (d < best) best = d;
      }
    }
    offset += glyph.advance + gap;
  }
  return best;
}

function fit(width: number, height: number, name = EDGEY_WORD): { k: number; s: number; gap: number; wordWidth: number } {
  // rows are two world units tall. the horizontal budget keeps room for the
  // extrusion at the extreme pointer yaw; the vertical one for the baseline and pitch.
  const letters = glyphs;
  const advance = letters.reduce((sum, glyph) => sum + glyph.advance, 0), gaps = letters.length - 1;
  const extrusionX = depth * Math.sin(0.78) + 0.1, extrusionY = depth * Math.sin(0.65);
  // letters stay at least two and a half columns apart so anti-aliased edges never bridge them.
  let gap = 0.18, s = 0.15;
  let k = Math.min((width - 2) / (advance + gaps * gap + extrusionX), (2 * height - 2) / (tailY + s + extrusionY));
  gap = Math.max(0.18, 2.6 / k);
  s = Math.max(0.15, 1.5 / k);
  k = Math.min((width - 2) / (advance + gaps * gap + extrusionX), (2 * height - 2) / (tailY + s + extrusionY));
  return { k, s, gap, wordWidth: advance + gaps * gap };
}

// a bounded cache holds the distance field and pillow normals per canvas size.
// frames only sample it, so pointer motion never re-evaluates the glyph primitives.
const layouts = new Map<string, Layout>();
function layout(width: number, height: number, name = EDGEY_WORD): Layout {
  const key = `${name},${width},${height}`;
  const cached = layouts.get(key);
  if (cached) return cached;
  const letters = glyphs;
  const { k, s, gap, wordWidth } = fit(width, height, name);
  const extentX = wordWidth - letters[letters.length - 1].advance + tailX + s + 0.02;
  const extentY = tailY + s;
  const step = 0.5 / k, pad = 0.2;
  const originX = -pad, originY = -pad;
  const columns = Math.ceil((extentX + 2 * pad) / step) + 1;
  const rows = Math.ceil((extentY + 2 * pad) / step) + 1;
  const distance = new Float32Array(columns * rows);
  const normals = new Float32Array(columns * rows * 3);
  const word = buildWord(s, letters);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      distance[row * columns + column] = distanceToWord(word, originX + column * step, originY + row * step, s, gap);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column, d = distance[index];
      if (d >= 0) { normals[index * 3 + 2] = 1; continue; }
      const left = distance[index - (column > 0 ? 1 : 0)], right = distance[index + (column < columns - 1 ? 1 : 0)];
      const up = distance[index - (row > 0 ? columns : 0)], down = distance[index + (row < rows - 1 ? columns : 0)];
      const dx = (right - left) / (2 * step), dy = (down - up) / (2 * step);
      // a quarter-circle profile: flat along the stroke centre, vertical at its edge.
      const u = Math.max(0, Math.min(1, 1 + d / s));
      const slope = u / Math.sqrt(Math.max(1e-6, 1 - u * u));
      const [nx, ny, nz] = normalize(dx * slope, dy * slope, 1);
      normals[index * 3] = nx; normals[index * 3 + 1] = ny; normals[index * 3 + 2] = nz;
    }
  }
  const result = { k, s, gap, wordWidth, extentX, extentY, originX, originY, step, columns, rows, distance, normals };
  if (layouts.size >= 8) layouts.delete(layouts.keys().next().value!);
  layouts.set(key, result);
  return result;
}

function fallback(width: number, height: number, name = EDGEY_WORD): string {
  const word = name.slice(0, width), left = Math.floor((width - word.length) / 2);
  const rows = Array.from({ length: height }, () => " ".repeat(width));
  rows[Math.floor(height / 2)] = " ".repeat(left) + word + " ".repeat(width - left - word.length);
  return rows.join("\n");
}

function usable(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 1 && height >= 1 &&
    width <= EDGEY_MAX_WIDTH && height <= EDGEY_MAX_HEIGHT;
}

/** rows the word needs at this width, capped by the available height; below five rows the plain word is used. */
export function measureEdgey(width: number, maxHeight: number): number {
  if (!usable(width, Math.max(1, Math.min(EDGEY_MAX_HEIGHT, maxHeight)))) return 0;
  const limit = Math.min(maxHeight, EDGEY_MAX_HEIGHT);
  if (width < 30) return Math.min(limit, 1);
  const { k, s } = fit(width, EDGEY_MAX_HEIGHT);
  const needed = Math.ceil((k * (tailY + s + depth * Math.sin(0.65)) + 2) / 2);
  return Math.max(1, Math.min(limit, Math.max(5, needed)));
}

/** an extruded, rounded "EDGEY" wordmark. characters encode tone: `@` highlight, `0` lit face,
 * `o` shaded face, `#` near wall, `%` far wall. yaw and pitch are radians; the frontal pose is (0, 0). */
export function renderEdgey(width: number, height: number, yaw = 0, pitch = 0, name = EDGEY_WORD): string {
  if (!usable(width, height)) return "";
  if (height < 5 || width < 30) return fallback(width, height, name);
  const field = layout(width, height, name);
  const { k, step, columns, rows, distance, normals, originX, originY } = field;
  const y = angle(yaw, maxYaw), p = angle(pitch, maxPitch);
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  // orthographic pitch then yaw: the face foreshortens, the rear plate shifts by the depth.
  const ex = -depth * sy, ey = depth * sp;
  const faceWidth = field.extentX * k * cy, faceHeight = field.extentY * k * cp;
  const x0 = width / 2 - faceWidth / 2 - ex * k / 2, y0 = height - faceHeight / 2 - ey * k / 2;
  const layers = Math.max(1, Math.ceil(k * Math.hypot(ex, ey) / 0.5));
  const lastColumn = columns - 1, lastRow = rows - 1;
  const sample = (gx: number, gy: number): number => {
    const u = (gx - originX) / step, v = (gy - originY) / step;
    if (u < 0 || v < 0 || u >= lastColumn || v >= lastRow) return 1;
    const column = Math.floor(u), row = Math.floor(v), fu = u - column, fv = v - row;
    const index = row * columns + column;
    return (distance[index] * (1 - fu) + distance[index + 1] * fu) * (1 - fv) +
      (distance[index + columns] * (1 - fu) + distance[index + columns + 1] * fu) * fv;
  };
  const normalAt = (gx: number, gy: number): number => {
    const column = Math.round((gx - originX) / step), row = Math.round((gy - originY) / step);
    return (Math.max(0, Math.min(lastRow, row)) * columns + Math.max(0, Math.min(lastColumn, column))) * 3;
  };
  // the light follows the turn halfway, so the highlight drifts while the face never goes dark.
  const hcy = Math.cos(y / 2), hsy = Math.sin(y / 2), hcp = Math.cos(p / 2), hsp = Math.sin(p / 2);
  const tone = (gx: number, gy: number): number => {
    const index = normalAt(gx, gy);
    const nx = normals[index], ny = normals[index + 1], nz = normals[index + 2];
    const ny1 = ny * hcp - nz * hsp, nz1 = ny * hsp + nz * hcp;
    const nx2 = nx * hcy + nz1 * hsy, nz2 = -nx * hsy + nz1 * hcy;
    const diffuse = Math.max(0, nx2 * light[0] + ny1 * light[1] + nz2 * light[2]);
    const specular = Math.max(0, nx2 * half[0] + ny1 * half[1] + nz2 * half[2]) ** 24;
    return 0.15 + 0.7 * diffuse + 0.6 * specular;
  };
  // the first layer hit along the sweep lies on the outline, so its outward
  // pillow normal doubles as the wall normal for the lit / shadow split.
  const wallLit = (gx: number, gy: number): boolean => {
    const index = normalAt(gx, gy);
    return normals[index] * light[0] + normals[index + 1] * light[1] > 0.08;
  };
  const lines: string[] = [];
  for (let row = 0; row < height; row++) {
    let line = "";
    for (let column = 0; column < width; column++) {
      let faces = 0, shade = 0, walls = 0, lit = 0;
      for (let sub = 0; sub < 4; sub++) {
        const wx = column + 0.25 + 0.5 * (sub & 1), wy = 2 * row + 0.5 + (sub >> 1);
        const gx = (wx - x0) / (k * cy), gy = (wy - y0) / (k * cp);
        if (sample(gx, gy) < 0) { faces++; shade += tone(gx, gy); continue; }
        for (let layer = 1; layer <= layers; layer++) {
          const f = layer / layers, sx = gx - ex * f / cy, sy2 = gy - ey * f / cp;
          if (sample(sx, sy2) < 0) { walls++; if (wallLit(sx, sy2)) lit++; break; }
        }
      }
      if (faces >= 2) { const value = shade / faces; line += value >= 0.8 ? "@" : value >= 0.45 ? "0" : "o"; }
      else if (faces + walls >= 3) line += lit * 2 >= walls ? "#" : "%";
      else line += " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
