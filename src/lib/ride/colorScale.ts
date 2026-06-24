import type { ColorScale } from './types';
import type { Chunk } from './types';

interface ChunkMetric {
  metric: number;
  diverging: boolean;
}

const lerp = (start: number, end: number, t: number) => start + (end - start) * t;

const componentToHex = (component: number) => {
  const clamped = Math.max(0, Math.min(255, Math.round(component)));
  return clamped.toString(16).padStart(2, '0');
};

const rgb = (r: number, g: number, b: number) => `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;

function speedColor(t: number): string {
  if (t < 0.5) {
    const local = t / 0.5;
    return rgb(lerp(200, 235, local), lerp(70, 195, local), 60);
  }
  const local = (t - 0.5) / 0.5;
  return rgb(lerp(235, 30, local), lerp(195, 160, local), lerp(60, 90, local));
}

const AEROBAR_ON_COLOR = rgb(30, 160, 90);
const CURVY_ON_COLOR = rgb(217, 119, 6);
const INACTIVE_COLOR = rgb(154, 163, 178);

function gradeColor(t: number): string {
  if (t < 0.5) {
    const local = t / 0.5;
    return rgb(lerp(60, 140, local), lerp(110, 145, local), lerp(210, 150, local));
  }
  const local = (t - 0.5) / 0.5;
  return rgb(lerp(140, 200, local), lerp(145, 70, local), lerp(150, 60, local));
}

function metricFor(chunk: Chunk, scale: ColorScale): ChunkMetric {
  if (scale === 'speed') return { metric: chunk.effectiveVelocityKph, diverging: false };
  return { metric: chunk.effectiveGradePct, diverging: true };
}

export function chunkColors(chunks: Chunk[], scale: ColorScale): string[] {
  if (chunks.length === 0) return [];

  if (scale === 'aerobar') {
    return chunks.map((chunk) =>
      chunk.effectivePosition === 'aerobar' ? AEROBAR_ON_COLOR : INACTIVE_COLOR,
    );
  }

  if (scale === 'curvy') {
    return chunks.map((chunk) => (chunk.curvy ? CURVY_ON_COLOR : INACTIVE_COLOR));
  }

  const metrics = chunks.map((chunk) => metricFor(chunk, scale));

  if (metrics[0].diverging) {
    const absMax = Math.max(...metrics.map((entry) => Math.abs(entry.metric)), 1);
    return metrics.map((entry) => gradeColor((entry.metric / absMax + 1) / 2));
  }

  const values = metrics.map((entry) => entry.metric);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return metrics.map((entry) => speedColor((entry.metric - min) / range));
}
