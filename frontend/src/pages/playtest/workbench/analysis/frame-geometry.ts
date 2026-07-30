export const ALPHA_THRESHOLD = 24;
const MIN_COMPONENT_PIXELS = 4;
const RELATIVE_COMPONENT_RATIO = 0.002;

export interface FramePixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface FrameGeometry {
  width: number;
  height: number;
  bounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  centroid: { x: number; y: number };
  footY: number;
  subjectHeight: number;
  opaquePixels: number;
  coverageRatio: number;
  /** Compact 8×8 alpha/luminance signature used for adjacent-frame similarity checks. */
  fingerprint?: readonly number[];
}

function createFingerprint(
  data: Uint8ClampedArray,
  width: number,
  subjectPixels: readonly number[],
  bounds: { left: number; top: number; width: number; height: number },
): readonly number[] {
  const sums = new Float64Array(64);
  const cellPixels = new Uint32Array(64);

  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const cellX = Math.min(7, Math.floor((x * 8) / bounds.width));
      const cellY = Math.min(7, Math.floor((y * 8) / bounds.height));
      cellPixels[cellY * 8 + cellX] += 1;
    }
  }

  for (const index of subjectPixels) {
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 4;
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    const alpha = (data[offset + 3] ?? 0) / 255;
    const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
    const cellX = Math.min(7, Math.floor(((x - bounds.left) * 8) / bounds.width));
    const cellY = Math.min(7, Math.floor(((y - bounds.top) * 8) / bounds.height));
    sums[cellY * 8 + cellX] += alpha * (0.25 + luminance * 0.75);
  }

  return Array.from(sums, (sum, index) => {
    const count = cellPixels[index] ?? 0;
    return count === 0 ? 0 : Number((sum / count).toFixed(4));
  });
}

function visibleComponents(data: Uint8ClampedArray, width: number, height: number): number[][] {
  const visible = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const components: number[][] = [];

  for (let index = 0; index < visible.length; index += 1) {
    const alpha = data[index * 4 + 3];
    if (alpha !== undefined && alpha > ALPHA_THRESHOLD) visible[index] = 1;
  }

  for (let start = 0; start < visible.length; start += 1) {
    if (visible[start] === 0 || visited[start] === 1) continue;

    const component: number[] = [];
    const queue = [start];
    visited[start] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      if (index === undefined) continue;
      component.push(index);

      const x = index % width;
      const y = Math.floor(index / width);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;

          const next = nextY * width + nextX;
          if (visible[next] === 0 || visited[next] === 1) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    components.push(component);
  }

  return components;
}

export function measureFrameGeometry(pixels: FramePixelData): FrameGeometry | null {
  const { data, width, height } = pixels;

  if (data.length !== width * height * 4) {
    throw new RangeError("RGBA 像素长度与画布尺寸不一致");
  }

  const components = visibleComponents(data, width, height);
  if (components.length === 0) return null;

  const largestSize = Math.max(...components.map((component) => component.length));
  const minimumSize = Math.min(
    largestSize,
    Math.max(MIN_COMPONENT_PIXELS, Math.ceil(largestSize * RELATIVE_COMPONENT_RATIO)),
  );
  const subjectPixels = components.flatMap((component) =>
    component.length === largestSize || component.length >= minimumSize ? component : [],
  );

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let opaquePixels = 0;
  let sumX = 0;
  let sumY = 0;

  for (const index of subjectPixels) {
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
    opaquePixels += 1;
    sumX += x;
    sumY += y;
  }

  const subjectWidth = right - left + 1;
  const subjectHeight = bottom - top + 1;

  return {
    width,
    height,
    bounds: {
      left,
      top,
      right,
      bottom,
      width: subjectWidth,
      height: subjectHeight,
    },
    centroid: { x: sumX / opaquePixels, y: sumY / opaquePixels },
    footY: bottom,
    subjectHeight,
    opaquePixels,
    coverageRatio: opaquePixels / (width * height),
    fingerprint: createFingerprint(data, width, subjectPixels, {
      left,
      top,
      width: subjectWidth,
      height: subjectHeight,
    }),
  };
}
