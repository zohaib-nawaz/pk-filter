import { describe, expect, it } from 'vitest';
import { planFromDash } from '../src/core/dash';
import { audioOnlyPlan, capByHeight, heightOf, parsePlaylist, pickSubtitles, pickVariant, type HlsMaster, type StreamPlan } from '../src/core/hls';
import { accessFailure, describeFailure } from '../src/core/net-errors';
import { formatHour, inNightWindow, nextNightStart } from '../src/core/night';
import { maxHeightFor, sanitizeSettings } from '../src/core/settings';
import { parseSiteReport, siteReportQuery } from '../src/core/site-report';
import { mergeVtt, subtitleLanguage } from '../src/core/subtitles';

const BASE = 'https://cdn.example.com/show/master.m3u8';

const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="subs/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Urdu",LANGUAGE="ur",URI="subs/ur.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,SUBTITLES="subs"
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,SUBTITLES="subs"
mid/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,SUBTITLES="subs"
hd/index.m3u8`;

const cue = (start: string, end: string, text: string) => `${start} --> ${end}\n${text}`;

describe('night window', () => {
  it('handles windows inside one day and across midnight', () => {
    const at = (hour: number) => new Date(2026, 10, 5, hour, 30);
    expect(inNightWindow(at(2), 1, 9)).toBe(true);
    expect(inNightWindow(at(9), 1, 9)).toBe(false);
    expect(inNightWindow(at(23), 22, 6)).toBe(true);
    expect(inNightWindow(at(3), 22, 6)).toBe(true);
    expect(inNightWindow(at(12), 22, 6)).toBe(false);
  });

  it('finds the next start time and formats hours', () => {
    expect(nextNightStart(new Date(2026, 10, 5, 0, 30), 1).getDate()).toBe(5);
    expect(nextNightStart(new Date(2026, 10, 5, 1, 0), 1).getDate()).toBe(6);
    expect(formatHour(0)).toBe('12:00 AM');
    expect(formatHour(13)).toBe('1:00 PM');
  });
});

describe('settings for new features', () => {
  it('fills defaults and rejects bad values', () => {
    expect(sanitizeSettings({})).toMatchObject({ explainFailures: false, streamQuality: 'best', saveSubtitles: true, nightStartHour: 1, nightEndHour: 9 });
    expect(sanitizeSettings({ streamQuality: '4k', nightStartHour: 30 })).toMatchObject({ streamQuality: 'best', nightStartHour: 1 });
    expect(sanitizeSettings({ nightStartHour: 5, nightEndHour: 5 })).toMatchObject({ nightStartHour: 1, nightEndHour: 9 });
    expect(maxHeightFor('720')).toBe(720);
    expect(maxHeightFor('best')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('failure detection', () => {
  it('recognises blocking-like errors from Chrome and Firefox only', () => {
    expect(accessFailure('net::ERR_CONNECTION_RESET')).toBe('CONNECTION_RESET');
    expect(accessFailure('net::ERR_ABORTED')).toBeNull();
    expect(accessFailure('net::ERR_INTERNET_DISCONNECTED')).toBeNull();
    expect(accessFailure('Error code 2152398868')).toBe('RESET');
    expect(describeFailure('CONNECTION_RESET')).toContain('cut off');
    expect(describeFailure('NAME_NOT_RESOLVED')).toContain('could not be found');
  });

  it('round-trips report parameters and refuses unsafe retry links', () => {
    const query = siteReportQuery({ domain: 'example.com', mode: 'failed', url: 'https://example.com/a?b=1', error: 'CONNECTION_RESET' });
    expect(parseSiteReport(query.split('?')[1] as string)).toEqual({ domain: 'example.com', mode: 'failed', url: 'https://example.com/a?b=1', error: 'CONNECTION_RESET' });
    expect(parseSiteReport('domain=x.com&mode=failed&url=javascript:alert(1)')?.url).toBeNull();
    expect(parseSiteReport('mode=check')).toBeNull();
  });
});

describe('stream quality and subtitles', () => {
  it('caps HLS quality and finds the default subtitles', () => {
    const parsed = parsePlaylist(master, BASE) as HlsMaster;
    expect(pickVariant(parsed)?.resolution).toBe('1920x1080');
    expect(pickVariant(parsed, 720)?.resolution).toBe('1280x720');
    expect(pickVariant(parsed, 240)?.resolution).toBe('640x360');
    const variant = pickVariant(parsed) as NonNullable<ReturnType<typeof pickVariant>>;
    expect(pickSubtitles(parsed, variant)).toMatchObject({ language: 'en', uri: 'https://cdn.example.com/show/subs/en.m3u8' });
  });

  it('caps DASH quality and finds a WebVTT track', () => {
    const xml = `<MPD type="static" mediaPresentationDuration="PT10S"><Period>
      <AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate duration="5" media="$RepresentationID$/$Number$.m4s"/>
        <Representation id="v1080" bandwidth="9000" width="1920" height="1080"/><Representation id="v480" bandwidth="2000" width="854" height="480"/></AdaptationSet>
      <AdaptationSet contentType="text" mimeType="text/vtt" lang="ur"><Representation id="t"><BaseURL>subs/ur.vtt</BaseURL></Representation></AdaptationSet>
    </Period></MPD>`;
    expect(planFromDash(xml, 'https://cdn.example.com/a.mpd').resolution).toBe('1920x1080');
    const capped = planFromDash(xml, 'https://cdn.example.com/a.mpd', 480);
    expect(capped.resolution).toBe('854x480');
    expect(capped.subtitles).toEqual({ language: 'ur', segments: ['https://cdn.example.com/subs/ur.vtt'] });
  });

  it('caps by the short side and ignores sizes it does not know', () => {
    expect(heightOf('1080x1920')).toBe(1080);
    expect(heightOf(null)).toBe(0);
    const items = [{ size: 0 }, { size: 1080 }, { size: 360 }];
    expect(capByHeight(items, 480, (item) => item.size)).toEqual([{ size: 360 }]);
    expect(capByHeight([{ size: 0 }], 480, (item) => item.size)).toEqual([{ size: 0 }]);
    expect(capByHeight([{ size: 720 }, { size: 1080 }], 360, (item) => item.size)).toEqual([{ size: 720 }]);
  });

  it('builds an audio-only plan only when audio is separate', () => {
    const track = (kind: 'video' | 'audio') => ({ kind, extension: kind === 'audio' ? 'm4a' : 'mp4', init: null, segments: [{ url: `https://x/${kind}`, range: null }] });
    const plan: StreamPlan = { manifestUrl: 'https://x/m', tracks: [track('video'), track('audio')], combine: true, durationSeconds: 1, estimatedBytes: 1, resolution: '1x1' };
    expect(audioOnlyPlan(plan)?.tracks.map((item) => item.kind)).toEqual(['audio']);
    expect(audioOnlyPlan({ ...plan, tracks: [track('video')] })).toBeNull();
  });

  it('merges segmented WebVTT into one file', () => {
    const header = 'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n';
    const merged = mergeVtt([header + cue('00:00.000', '00:01.000', 'Hello'), header + cue('00:01.000', '00:02.000', 'World')]);
    expect(merged.match(/WEBVTT/g)).toHaveLength(1);
    expect(merged).toContain('Hello');
    expect(merged).toContain('World');
    expect(subtitleLanguage('EN-us!')).toBe('en-us');
    expect(subtitleLanguage(undefined)).toBe('subtitles');
  });
});
