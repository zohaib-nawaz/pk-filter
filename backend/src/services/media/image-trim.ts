import sharp from 'sharp';

export interface Box {
  width: number;
  height: number;
}

const BAR_COLOR = '#000000';
const BAR_THRESHOLD = 12;
const STANDARD_RATIOS = [16 / 9, 9 / 16, 4 / 3, 3 / 4, 1, 21 / 9, 2];
const SNAP_TOLERANCE = 0.06;
const JPEG_QUALITY = 95;

export function snapToRatio(box: Box): Box {
  const ratio = box.width / box.height;
  const nearest = STANDARD_RATIOS.reduce((best, candidate) => (Math.abs(candidate - ratio) < Math.abs(best - ratio) ? candidate : best));
  if (Math.abs(ratio - nearest) / nearest > SNAP_TOLERANCE) {
    return box;
  }
  if (ratio > nearest) {
    return { width: Math.round(box.height * nearest), height: box.height };
  }
  return { width: box.width, height: Math.round(box.width / nearest) };
}

export async function trimBars(image: Buffer): Promise<Buffer> {
  try {
    const original = await sharp(image).metadata();
    if (original.format !== 'jpeg') {
      return image;
    }
    const trimmed = await sharp(image).trim({ background: BAR_COLOR, threshold: BAR_THRESHOLD }).toBuffer({ resolveWithObject: true });
    if (trimmed.info.width === original.width && trimmed.info.height === original.height) {
      return image;
    }
    const box = snapToRatio({ width: trimmed.info.width, height: trimmed.info.height });
    const region = {
      left: Math.floor((trimmed.info.width - box.width) / 2),
      top: Math.floor((trimmed.info.height - box.height) / 2),
      width: box.width,
      height: box.height,
    };
    return await sharp(trimmed.data).extract(region).jpeg({ quality: JPEG_QUALITY }).toBuffer();
  } catch {
    return image;
  }
}
