import { canCombine, capByHeight, estimateBytes, shortSide, type StreamPlan, type StreamSegment, type StreamTrack } from './hls';
import { subtitleLanguage, type SubtitleTrack } from './subtitles';
import { safeHttpUrl } from './media';

const MAX_SEGMENTS = 20_000;
export const REST_OF_FILE = Number.MAX_SAFE_INTEGER;
const ATTR = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const DURATION = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;
const DURATION_UNITS = [365 * 86_400, 30 * 86_400, 86_400, 3_600, 60, 1];

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

interface DashRep {
  id: string;
  kind: StreamTrack['kind'];
  bandwidth: number;
  width: number;
  height: number;
  codecs: string;
  mime: string;
  init: StreamSegment | null;
  segments: StreamSegment[];
}

function localName(name: string): string {
  return name.replace(/^.*:/, '').toLowerCase();
}

function codePoint(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) {
    return '';
  }
  return String.fromCodePoint(value);
}

export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (_token, decimal?: string, hex?: string, named?: string) => {
    if (decimal) {
      return codePoint(Number(decimal));
    }
    if (hex) {
      return codePoint(parseInt(hex, 16));
    }
    return NAMED_ENTITIES[(named as string).toLowerCase()] as string;
  });
}

function attrValue(match: RegExpMatchArray): string {
  for (const group of [match[2], match[3], match[4]]) {
    if (group !== undefined) {
      return decodeEntities(group);
    }
  }
  return '';
}

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of text.matchAll(ATTR)) {
    attrs[localName(match[1] as string)] = attrValue(match);
  }
  return attrs;
}

function tagEnd(text: string, from: number): number {
  let quote: string | null = null;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>' || text.startsWith('/>', index)) {
      return index;
    }
  }
  return text.length;
}

function skipDeclaration(source: string): string {
  return source.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
}

function parseNode(text: string, start: number): { node: XmlNode; next: number } {
  if (text[start] !== '<') {
    throw new Error('This is not a DASH stream');
  }

  let index = start + 1;
  const nameStart = index;
  while (index < text.length && !/[\s/>]/.test(text[index] as string)) {
    index += 1;
  }
  const name = localName(text.slice(nameStart, index));
  const attrStart = index;
  index = tagEnd(text, index);
  const attrs = parseAttrs(text.slice(attrStart, index));
  if (text.slice(index, index + 2) === '/>') {
    return { node: { name, attrs, children: [], text: '' }, next: index + 2 };
  }

  index += 1;
  return parseChildren(text, index, name, attrs);
}

function parseChildren(text: string, from: number, name: string, attrs: Record<string, string>): { node: XmlNode; next: number } {
  const children: XmlNode[] = [];
  let body = '';
  let index = from;
  while (index < text.length) {
    if (text.slice(index, index + 2) === '</') {
      const close = text.indexOf('>', index);
      return { node: { name, attrs, children, text: decodeEntities(body.trim()) }, next: close + 1 };
    }
    if (text[index] === '<') {
      const parsed = parseNode(text, index);
      children.push(parsed.node);
      index = parsed.next;
      continue;
    }
    const nextTag = text.indexOf('<', index);
    if (nextTag < 0) {
      break;
    }
    body += text.slice(index, nextTag);
    index = nextTag;
  }
  throw new Error('This is not a DASH stream');
}

export function parseXml(source: string): XmlNode {
  return parseNode(skipDeclaration(source), 0).node;
}

function kids(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

function kid(node: XmlNode, name: string): XmlNode | undefined {
  return kids(node, name)[0];
}

function textOf(node: XmlNode, name: string): string | undefined {
  const value = kid(node, name)?.text.trim();
  if (!value) {
    return undefined;
  }
  return value;
}

function joinUrl(base: string, relative: string | undefined): string {
  if (!relative) {
    return base;
  }
  return safeHttpUrl(relative, base)?.toString() ?? base;
}

function parseDuration(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const match = DURATION.exec(value.trim());
  if (!match) {
    return 0;
  }
  return DURATION_UNITS.reduce((total, unit, index) => {
    const part = match[index + 1];
    if (!part) {
      return total;
    }
    return total + Number(part) * unit;
  }, 0);
}

function parseRange(value: string | undefined): StreamSegment['range'] {
  if (!value) {
    return null;
  }
  const [startText, endText] = value.split('-');
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return null;
  }
  return { start, end };
}

function hasProtection(node: XmlNode): boolean {
  return node.name === 'contentprotection' || node.children.some(hasProtection);
}

function expand(template: string, values: Record<string, string | number>): string {
  return template.replace(/\$([A-Za-z]+)(?:%(0\d+d))?\$/g, (token, name: string, format?: string) => {
    if (!(name in values)) {
      return token;
    }
    const value = values[name];
    if (format && typeof value === 'number') {
      return String(value).padStart(Number(format.slice(1, -1)), '0');
    }
    return String(value);
  });
}

function segmentUrl(base: string, template: string, values: Record<string, string | number>): StreamSegment | null {
  const url = safeHttpUrl(expand(template, values), base);
  if (!url) {
    return null;
  }
  return { url: url.toString(), range: null };
}

function numberedSegments(base: string, media: string, values: Record<string, string | number>, startNumber: number, count: number): StreamSegment[] {
  const segments: StreamSegment[] = [];
  for (let offset = 0; offset < count && segments.length < MAX_SEGMENTS; offset += 1) {
    const segment = segmentUrl(base, media, { ...values, Number: startNumber + offset });
    if (segment) {
      segments.push(segment);
    }
  }
  return segments;
}

function timelineSegments(template: XmlNode, base: string, media: string, values: Record<string, string | number>, startNumber: number, periodSeconds: number, timescale: number): StreamSegment[] {
  const segments: StreamSegment[] = [];
  let time = 0;
  let number = startNumber;
  const offset = Number(template.attrs.presentationtimeoffset) || 0;
  const periodEnd = periodSeconds * timescale + offset;
  for (const item of kids(kid(template, 'segmenttimeline') as XmlNode, 's')) {
    if (item.attrs.t) {
      time = Number(item.attrs.t);
    }
    const duration = Number(item.attrs.d);
    const repeat = Number(item.attrs.r ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      continue;
    }
    const count = repeat < 0 ? Math.max(1, Math.ceil((periodEnd - time) / duration)) : repeat + 1;
    for (let step = 0; step < count && segments.length < MAX_SEGMENTS; step += 1) {
      const segment = segmentUrl(base, media, { ...values, Number: number, Time: time });
      if (segment) {
        segments.push(segment);
      }
      number += 1;
      time += duration;
    }
  }
  return segments;
}

function templateSegments(template: XmlNode | undefined, base: string, values: Record<string, string | number>, periodSeconds: number): { init: StreamSegment | null; segments: StreamSegment[] } {
  if (!template) {
    return { init: null, segments: [] };
  }
  const timescale = Number(template.attrs.timescale ?? 1) || 1;
  const duration = Number(template.attrs.duration ?? 0);
  const startNumber = Number(template.attrs.startnumber ?? 1) || 1;
  const initialization = template.attrs.initialization;
  const media = template.attrs.media;
  const init = initialization ? segmentUrl(base, initialization, values) : null;
  if (!media) {
    return { init, segments: [] };
  }
  if (kid(template, 'segmenttimeline')) {
    return { init, segments: timelineSegments(template, base, media, values, startNumber, periodSeconds, timescale) };
  }
  if (duration <= 0 || periodSeconds <= 0) {
    return { init, segments: [] };
  }
  const count = Math.ceil((periodSeconds * timescale) / duration);
  return { init, segments: numberedSegments(base, media, values, startNumber, count) };
}

function listSegments(list: XmlNode | undefined, base: string): { init: StreamSegment | null; segments: StreamSegment[] } {
  if (!list) {
    return { init: null, segments: [] };
  }
  const initialization = kid(list, 'initialization');
  const initUrl = initialization ? joinUrl(base, initialization.attrs.sourceurl || textOf(list, 'initialization')) : '';
  const init = initialization && initUrl.startsWith('http') ? { url: initUrl, range: parseRange(initialization.attrs.range) } : null;
  const segments = kids(list, 'segmenturl')
    .map((item) => {
      const url = safeHttpUrl(item.attrs.media, base);
      if (!url) {
        return null;
      }
      return { url: url.toString(), range: parseRange(item.attrs.mediaRange || item.attrs.mediarange) };
    })
    .filter((item): item is StreamSegment => item !== null);
  return { init, segments };
}

function baseSegments(segmentBase: XmlNode | undefined, base: string): { init: StreamSegment | null; segments: StreamSegment[] } {
  const url = safeHttpUrl(base);
  if (!url) {
    return { init: null, segments: [] };
  }
  const initialization = segmentBase ? kid(segmentBase, 'initialization') : undefined;
  const initRange = parseRange(initialization?.attrs.range);
  const indexRange = parseRange(segmentBase?.attrs.indexrange);
  const href = url.toString();
  const rest = (start: number): StreamSegment =>
    indexRange ? { url: href, range: { start, end: REST_OF_FILE }, index: indexRange } : { url: href, range: { start, end: REST_OF_FILE } };
  if (!initRange) {
    return { init: null, segments: [rest(0)] };
  }
  return { init: { url: href, range: initRange }, segments: [rest(initRange.end + 1)] };
}

function mergeTemplate(parent: XmlNode | undefined, child: XmlNode | undefined): XmlNode | undefined {
  if (!parent) {
    return child;
  }
  if (!child) {
    return parent;
  }
  return { name: 'segmenttemplate', attrs: { ...parent.attrs, ...child.attrs }, children: child.children.length > 0 ? child.children : parent.children, text: '' };
}

function kindOf(adapt: XmlNode, mime: string): StreamTrack['kind'] | null {
  const content = (adapt.attrs.contenttype || '').toLowerCase();
  if (content.startsWith('video') || mime.startsWith('video/')) {
    return 'video';
  }
  if (content.startsWith('audio') || mime.startsWith('audio/')) {
    return 'audio';
  }
  return null;
}

function dashExtension(kind: StreamTrack['kind'], mime: string): string {
  if (mime.includes('webm')) {
    return 'webm';
  }
  if (kind === 'audio') {
    return 'm4a';
  }
  return 'mp4';
}

function representation(adapt: XmlNode, rep: XmlNode, base: string, periodSeconds: number): DashRep | null {
  const mime = (rep.attrs.mimetype || adapt.attrs.mimetype || '').toLowerCase();
  const kind = kindOf(adapt, mime);
  if (!kind) {
    return null;
  }
  const id = rep.attrs.id || '1';
  const bandwidth = Number(rep.attrs.bandwidth ?? 0);
  const href = joinUrl(joinUrl(base, textOf(adapt, 'baseurl')), textOf(rep, 'baseurl'));
  const template = mergeTemplate(kid(adapt, 'segmenttemplate'), kid(rep, 'segmenttemplate'));
  const values = { RepresentationID: id, Bandwidth: bandwidth, Number: 1, Time: 0 };
  let built = templateSegments(template, href, values, periodSeconds);
  if (built.segments.length === 0) {
    built = listSegments(kid(rep, 'segmentlist') ?? kid(adapt, 'segmentlist'), href);
  }
  const segmentBase = kid(rep, 'segmentbase') || kid(adapt, 'segmentbase');
  const ownFile = textOf(rep, 'baseurl') || textOf(adapt, 'baseurl');
  if (built.segments.length === 0 && !template && (segmentBase || ownFile)) {
    built = baseSegments(segmentBase, href);
  }
  if (built.segments.length === 0) {
    return null;
  }
  return {
    id,
    kind,
    bandwidth,
    width: Number(rep.attrs.width || adapt.attrs.width || 0),
    height: Number(rep.attrs.height || adapt.attrs.height || 0),
    codecs: rep.attrs.codecs || '',
    mime,
    init: built.init,
    segments: built.segments.slice(0, MAX_SEGMENTS),
  };
}

function best(reps: DashRep[], kind: StreamTrack['kind'], maxHeight = Number.POSITIVE_INFINITY): DashRep | undefined {
  const ofKind = reps.filter((item) => item.kind === kind);
  const allowed = kind === 'video' ? capByHeight(ofKind, maxHeight, (item) => shortSide(item.width, item.height)) : ofKind;
  return [...allowed].sort((a, b) => b.bandwidth - a.bandwidth)[0];
}

function isTextTrack(adapt: XmlNode): boolean {
  const content = (adapt.attrs.contenttype || '').toLowerCase();
  const mime = (adapt.attrs.mimetype || '').toLowerCase();
  return content === 'text' || mime === 'text/vtt';
}

function dashSubtitles(period: XmlNode, base: string): SubtitleTrack | null {
  for (const adapt of kids(period, 'adaptationset').filter(isTextTrack)) {
    const mime = (adapt.attrs.mimetype || '').toLowerCase();
    for (const rep of kids(adapt, 'representation')) {
      const repMime = (rep.attrs.mimetype || mime).toLowerCase();
      const file = textOf(rep, 'baseurl') || textOf(adapt, 'baseurl');
      const url = file ? safeHttpUrl(file, base) : null;
      if (url && (repMime === 'text/vtt' || url.pathname.toLowerCase().endsWith('.vtt'))) {
        return { language: subtitleLanguage(adapt.attrs.lang || rep.attrs.lang), segments: [url.toString()] };
      }
    }
  }
  return null;
}

function toTrack(rep: DashRep): StreamTrack {
  return { kind: rep.kind, extension: dashExtension(rep.kind, rep.mime), init: rep.init, segments: rep.segments };
}

function muxedAudio(rep: DashRep): boolean {
  return /mp4a|opus|vorbis/i.test(rep.codecs);
}

export interface DashRendition {
  index: number;
  id: string;
  kind: StreamTrack['kind'];
  bandwidth: number;
  width: number;
  height: number;
  codecs: string;
  mime: string;
  hasAudio: boolean;
  joinable: boolean;
}

interface DashDocument {
  period: XmlNode;
  base: string;
  durationSeconds: number;
  reps: DashRep[];
}

function readDash(xml: string, baseUrl: string): DashDocument {
  const root = parseXml(xml);
  if (root.name !== 'mpd') {
    throw new Error('This is not a DASH stream');
  }
  if ((root.attrs.type || 'static').toLowerCase() === 'dynamic') {
    throw new Error('Live streams cannot be downloaded');
  }
  if (hasProtection(root)) {
    throw new Error('This stream is encrypted and cannot be downloaded');
  }
  const periods = kids(root, 'period');
  if (periods.length > 1) {
    throw new Error('Streams with several parts (periods) are not supported yet');
  }
  const period = periods[0];
  if (!period) {
    throw new Error('This stream has no video segments');
  }
  const durationSeconds = parseDuration(period.attrs.duration) || parseDuration(root.attrs.mediapresentationduration);
  const base = joinUrl(joinUrl(baseUrl, textOf(root, 'baseurl')), textOf(period, 'baseurl'));
  const reps = kids(period, 'adaptationset').flatMap((adapt) => kids(adapt, 'representation').flatMap((rep) => {
    const parsed = representation(adapt, rep, base, durationSeconds);
    return parsed ? [parsed] : [];
  }));
  return { period, base, durationSeconds, reps };
}

function isJoinable(rep: DashRep): boolean {
  const [only] = rep.segments;
  const wholeFile = rep.segments.length === 1 && only !== undefined && only.range !== null && only.range.end === REST_OF_FILE;
  return rep.init !== null && (!wholeFile || only.index !== undefined);
}

export function dashRenditions(xml: string, baseUrl: string): { durationSeconds: number; renditions: DashRendition[] } {
  const { durationSeconds, reps } = readDash(xml, baseUrl);
  const renditions = reps.map((rep, index) => ({
    index,
    id: rep.id,
    kind: rep.kind,
    bandwidth: rep.bandwidth,
    width: rep.width,
    height: rep.height,
    codecs: rep.codecs,
    mime: rep.mime,
    hasAudio: rep.kind === 'audio' || muxedAudio(rep),
    joinable: isJoinable(rep),
  }));
  return { durationSeconds, renditions };
}

function chooseVideo(reps: DashRep[], maxHeight: number, videoIndex: number | undefined): DashRep | undefined {
  if (videoIndex !== undefined) {
    return reps[videoIndex];
  }
  return best(reps, 'video', maxHeight) ?? best(reps, 'audio');
}

export function planFromDash(xml: string, baseUrl: string, maxHeight = Number.POSITIVE_INFINITY, videoIndex?: number): StreamPlan {
  const { period, base, durationSeconds, reps } = readDash(xml, baseUrl);
  const video = chooseVideo(reps, maxHeight, videoIndex);
  if (!video) {
    throw new Error('This stream has no video segments');
  }
  if (video.segments.length > MAX_SEGMENTS) {
    throw new Error('This stream is too long to download');
  }
  const audio = video.kind === 'video' && !muxedAudio(video) ? best(reps, 'audio') : undefined;
  const tracks = audio ? [toTrack(video), toTrack(audio)] : [toTrack(video)];
  const resolution = video.width > 0 && video.height > 0 ? `${video.width}x${video.height}` : null;
  return {
    manifestUrl: baseUrl,
    tracks,
    combine: canCombine(tracks),
    durationSeconds,
    estimatedBytes: estimateBytes(video.bandwidth + (audio?.bandwidth ?? 0), durationSeconds),
    resolution,
    subtitles: dashSubtitles(period, base),
  };
}
