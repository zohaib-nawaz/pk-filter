import { describe, expect, it } from 'vitest';
import { parseXml, planFromDash, REST_OF_FILE } from '../src/core/dash';

const BASE = 'https://cdn.example.com/show/manifest.mpd';

const mpd = (body: string, attrs = 'type="static" mediaPresentationDuration="PT634.566S"') =>
  `<?xml version="1.0"?><!-- packager --><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" ${attrs}><BaseURL>./</BaseURL><Period>${body}</Period></MPD>`;

const numbered = mpd(`
  <AdaptationSet mimeType="video/mp4" contentType="video">
    <SegmentTemplate duration="120" timescale="30" media="$RepresentationID$/seg_$Number%05d$.m4v" startNumber="1" initialization="$RepresentationID$/init.m4v"/>
    <Representation id="v720" codecs="avc1.64001f" bandwidth="4952892" width="1280" height="720"/>
    <Representation id="v1080" codecs="avc1.640028" bandwidth="9914554" width="1920" height="1080"/>
  </AdaptationSet>
  <AdaptationSet mimeType="audio/mp4" contentType="audio">
    <SegmentTemplate duration="192512" timescale="48000" media="$RepresentationID$/seg_$Number$.m4a" startNumber="1" initialization="$RepresentationID$/init.m4a"/>
    <Representation id="a128" codecs="mp4a.40.2" bandwidth="128000"/>
  </AdaptationSet>`);

describe('parseXml', () => {
  it('reads tags, attributes, namespaces and text', () => {
    const root = parseXml('<?xml version="1.0"?><MPD a="1"><cenc:pssh>abc</cenc:pssh><BaseURL> media/ </BaseURL></MPD>');
    expect(root.name).toBe('mpd');
    expect(root.attrs.a).toBe('1');
    expect(root.children.map((child) => child.name)).toEqual(['pssh', 'baseurl']);
    expect(root.children[1]?.text).toBe('media/');
  });

  it('does not hang on cut-off XML', () => {
    expect(() => planFromDash('<MPD type="static"><Period><AdaptationSet', BASE)).toThrow();
  });
});

describe('planFromDash', () => {
  it('expands numbered templates, picks the best video and keeps audio separate', () => {
    const plan = planFromDash(numbered, BASE);
    expect(plan.resolution).toBe('1920x1080');
    expect(plan.tracks.map((track) => [track.kind, track.extension])).toEqual([['video', 'mp4'], ['audio', 'm4a']]);
    const [video, audio] = plan.tracks;
    expect(video?.init?.url).toBe('https://cdn.example.com/show/v1080/init.m4v');
    expect(video?.segments).toHaveLength(Math.ceil((634.566 * 30) / 120));
    expect(video?.segments[0]?.url).toBe('https://cdn.example.com/show/v1080/seg_00001.m4v');
    expect(video?.segments.at(-1)?.url).toBe('https://cdn.example.com/show/v1080/seg_00159.m4v');
    expect(audio?.segments[1]?.url).toBe('https://cdn.example.com/show/a128/seg_2.m4a');
    expect(plan.combine).toBe(true);
    expect(plan.estimatedBytes).toBe(Math.round(((9914554 + 128000) * 634.566) / 8));
  });

  it('follows segment timelines with repeats and $Time$', () => {
    const plan = planFromDash(
      mpd(
        `<AdaptationSet contentType="video" mimeType="video/mp4">
          <Representation id="v" bandwidth="1000" codecs="avc1,mp4a.40.2">
            <SegmentTemplate timescale="1000" media="v/$Time$.m4s" initialization="v/init.mp4">
              <SegmentTimeline><S t="0" d="4000" r="2"/><S d="2000"/></SegmentTimeline>
            </SegmentTemplate>
          </Representation>
        </AdaptationSet>`,
        'type="static" mediaPresentationDuration="PT14S"',
      ),
      BASE,
    );
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]?.segments.map((segment) => segment.url.split('/').pop())).toEqual(['0.m4s', '4000.m4s', '8000.m4s', '12000.m4s']);
  });

  it('reads segment lists with byte ranges', () => {
    const plan = planFromDash(
      mpd(`<AdaptationSet contentType="video" mimeType="video/mp4"><Representation id="v" bandwidth="1" codecs="avc1,mp4a">
        <BaseURL>video.mp4</BaseURL>
        <SegmentList><Initialization sourceURL="video.mp4" range="0-99"/><SegmentURL media="video.mp4" mediaRange="100-199"/><SegmentURL media="video.mp4" mediaRange="200-299"/></SegmentList>
      </Representation></AdaptationSet>`),
      BASE,
    );
    const track = plan.tracks[0];
    expect(track?.init).toEqual({ url: 'https://cdn.example.com/show/video.mp4', range: { start: 0, end: 99 } });
    expect(track?.segments.map((segment) => segment.range)).toEqual([{ start: 100, end: 199 }, { start: 200, end: 299 }]);
  });

  it('marks single-file representations so the file is not downloaded twice', () => {
    const plan = planFromDash(
      mpd(`<AdaptationSet contentType="video" mimeType="video/mp4"><Representation id="v" bandwidth="5" width="640" height="360" codecs="avc1">
          <BaseURL>v.mp4</BaseURL><SegmentBase indexRange="727-950"><Initialization range="0-726"/></SegmentBase></Representation></AdaptationSet>
        <AdaptationSet contentType="audio" mimeType="audio/mp4"><Representation id="a" bandwidth="1" codecs="mp4a.40.2"><BaseURL>a.mp4</BaseURL></Representation></AdaptationSet>`),
      BASE,
    );
    const [video, audio] = plan.tracks;
    expect(video?.init).toEqual({ url: 'https://cdn.example.com/show/v.mp4', range: { start: 0, end: 726 } });
    expect(video?.segments).toEqual([{ url: 'https://cdn.example.com/show/v.mp4', range: { start: 727, end: REST_OF_FILE }, index: { start: 727, end: 950 } }]);
    expect(audio?.init).toBeNull();
    expect(audio?.segments).toEqual([{ url: 'https://cdn.example.com/show/a.mp4', range: { start: 0, end: REST_OF_FILE } }]);
    expect(plan.combine).toBe(false);
  });

  it('does not try to combine WebM tracks', () => {
    const plan = planFromDash(
      mpd(`<AdaptationSet contentType="video" mimeType="video/webm"><SegmentTemplate duration="5" media="v$Number$.webm" initialization="vinit.webm"/><Representation id="v" bandwidth="9" codecs="vp9"/></AdaptationSet>
        <AdaptationSet contentType="audio" mimeType="audio/webm"><SegmentTemplate duration="5" media="a$Number$.webm" initialization="ainit.webm"/><Representation id="a" bandwidth="1" codecs="opus"/></AdaptationSet>`, 'type="static" mediaPresentationDuration="PT10S"'),
      BASE,
    );
    expect(plan.tracks.map((track) => track.extension)).toEqual(['webm', 'webm']);
    expect(plan.combine).toBe(false);
  });

  it('refuses live, encrypted, multi-part and non-DASH documents', () => {
    expect(() => planFromDash(numbered.replace('type="static"', 'type="dynamic"'), BASE)).toThrow('Live streams');
    expect(() => planFromDash(numbered.replace('<Representation id="v720"', '<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"/><Representation id="v720"'), BASE)).toThrow('encrypted');
    expect(() => planFromDash(numbered.replace('</Period>', '</Period><Period></Period>'), BASE)).toThrow('several parts');
    expect(() => planFromDash('<html><body>nope</body></html>', BASE)).toThrow('not a DASH stream');
  });

  it('decodes escaped characters in signed segment urls', () => {
    const plan = planFromDash(
      mpd(`<AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate duration="5" media="v$Number$.m4s?token=a&amp;exp=1" initialization="init.mp4?t=&quot;x&quot;"/><Representation id="v" bandwidth="9"/></AdaptationSet>`, 'type="static" mediaPresentationDuration="PT10S"'),
      BASE,
    );
    expect(plan.tracks[0]?.segments[0]?.url).toBe('https://cdn.example.com/show/v1.m4s?token=a&exp=1');
    expect(parseXml('<a b="x>y"><c>1 &lt; 2</c></a>').children[0]?.text).toBe('1 < 2');
    expect(parseXml('<a b="x>y"/>').attrs.b).toBe('x>y');
  });

  it('reads full ISO durations', () => {
    const body = `<AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate duration="10" media="v$Number$.m4s"/><Representation id="v" bandwidth="9"/></AdaptationSet>`;
    expect(planFromDash(mpd(body, 'type="static" mediaPresentationDuration="P0Y0M0DT0H3M30.000S"'), BASE).durationSeconds).toBe(210);
    expect(planFromDash(mpd(body, 'type="static" mediaPresentationDuration="PT1.5H"'), BASE).tracks[0]?.segments).toHaveLength(540);
  });

  it('refuses a template without a usable duration instead of saving the manifest', () => {
    const body = `<AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate duration="10" media="v$Number$.m4s"/><Representation id="v" bandwidth="9"/></AdaptationSet>`;
    expect(() => planFromDash(mpd(body, 'type="static"'), BASE)).toThrow('no video segments');
  });

  it('counts open-ended timelines from the presentation time offset', () => {
    const plan = planFromDash(
      mpd(`<AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate timescale="10" presentationTimeOffset="100000" media="v$Time$.m4s"><SegmentTimeline><S t="100000" d="20" r="-1"/></SegmentTimeline></SegmentTemplate><Representation id="v" bandwidth="9"/></AdaptationSet>`, 'type="static" mediaPresentationDuration="PT10S"'),
      BASE,
    );
    expect(plan.tracks[0]?.segments).toHaveLength(5);
  });
});
