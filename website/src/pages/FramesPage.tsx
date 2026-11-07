import { formatBytes } from '@shared/download-errors';
import { FRAME_LIMITS, FRAME_SUPPORT } from '../core/content';
import { appendToken, clampStart, DIGIT_CHOICES, NAME_PRESETS, NAME_TOKENS, nameFrames, presetFor, previewNames, type NameSettings } from '../core/frame-names';
import {
  activePreset,
  applyPreset,
  describeOutput,
  describePlan,
  describeSize,
  formatClock,
  FRAME_FORMATS,
  FRAME_HEIGHTS,
  FRAME_PRESETS,
  FRAME_RATES,
  MAX_FRAMES,
  outputSize,
  parseClock,
  planFrames,
  type FrameSettings,
} from '../core/frames';
import { useFrameExtractor, type Frame, type FrameState, type FrameVideo } from '../hooks/useFrameExtractor';
import { FrameGallery } from '../ui/frames/FrameGallery';
import { FrameNaming, type NamingChoices, type NamingRules } from '../ui/frames/FrameNaming';
import { FramePlayer } from '../ui/frames/FramePlayer';
import { FrameProgress } from '../ui/frames/FrameProgress';
import { FrameSettingsPanel, type ClockFormat, type FrameChoices } from '../ui/frames/FrameSettingsPanel';
import { FrameSourcePicker } from '../ui/frames/FrameSourcePicker';
import { ErrorNote, LoadingNote } from '../ui/Notice';
import { PageIntro } from '../ui/PageIntro';
import { PAGE } from '../ui/styles';
import { SupportLists } from '../ui/SupportLists';

type Extractor = ReturnType<typeof useFrameExtractor>;

const FRAME_CHOICES: FrameChoices = { presets: FRAME_PRESETS, rates: FRAME_RATES, formats: FRAME_FORMATS, heights: FRAME_HEIGHTS };
const CLOCK: ClockFormat = { format: formatClock, parse: parseClock };
const NAMING_CHOICES: NamingChoices = { presets: NAME_PRESETS, tokens: NAME_TOKENS, digits: DIGIT_CHOICES };
const NAMING_RULES: NamingRules = { presetFor, appendToken, clampStart };

function videoDetail(video: FrameVideo): string {
  return `${formatClock(video.duration)} long · ${video.width} × ${video.height}`;
}

function galleryNote(state: Extract<FrameState, { phase: 'done' }>): string | null {
  if (state.cancelled) {
    return 'Stopped early. These are the frames saved before you pressed Stop.';
  }
  if (state.capped) {
    return `Only the first ${MAX_FRAMES} frames were saved. Pick a shorter part or fewer frames per second for the rest.`;
  }
  return null;
}

function gallerySummary(frames: Frame[]): string {
  const bytes = frames.reduce((total, frame) => total + frame.blob.size, 0);
  return `${frames.length} ${frames.length === 1 ? 'frame' : 'frames'} · ${formatBytes(bytes)} in total`;
}

function plannedNames(naming: NameSettings, times: number[], video: FrameVideo, settings: FrameSettings): string[] {
  const frames = times.map((time, index) => ({ index, time, type: settings.format }));
  const size = outputSize(video.width, video.height, settings.maxHeight);
  const fps = settings.spacing === 'rate' ? settings.fps : null;
  return nameFrames(frames, naming, { title: video.title, ...size, fps, date: new Date() });
}

function renderNaming(extractor: Extractor, names: string[]) {
  return <FrameNaming naming={extractor.naming} choices={NAMING_CHOICES} rules={NAMING_RULES} preview={previewNames(names)} onChange={extractor.setNaming} />;
}

function renderSettings(extractor: Extractor, video: FrameVideo, settings: FrameSettings) {
  const plan = planFrames(settings, video.duration);
  const warning = plan.capped ? `This range needs ${plan.wanted} frames. Only the first ${MAX_FRAMES} will be saved.` : null;
  const change = (next: FrameSettings) => extractor.setSettings(next);
  return (
    <FrameSettingsPanel
      settings={settings}
      choices={FRAME_CHOICES}
      clock={CLOCK}
      activePreset={activePreset(settings)}
      summary={describePlan(plan)}
      output={describeOutput(video.width, video.height, settings)}
      size={describeSize(extractor.bytesPerFrame, plan.times.length)}
      warning={warning}
      onChange={change}
      onPreset={(preset) => change(applyPreset(settings, preset))}
      onExtract={() => void extractor.extract()}
    >
      {renderNaming(extractor, plannedNames(extractor.naming, plan.times, video, settings))}
    </FrameSettingsPanel>
  );
}

function renderWork(extractor: Extractor, video: FrameVideo) {
  const { state, settings } = extractor;
  if (state.phase === 'extracting') {
    return <FrameProgress done={state.done} total={state.total} onCancel={extractor.cancel} />;
  }
  if (state.phase === 'done') {
    return (
      <FrameGallery
        frames={state.frames.map((frame, index) => ({ name: extractor.names[index] as string, url: frame.url, time: formatClock(frame.time) }))}
        summary={gallerySummary(state.frames)}
        note={extractor.zipError || galleryNote(state)}
        zipping={extractor.zipping}
        onDownloadAll={() => void extractor.downloadAll()}
        onBack={extractor.backToSettings}
      >
        {renderNaming(extractor, extractor.names)}
      </FrameGallery>
    );
  }
  if (!settings) {
    return null;
  }
  return renderSettings(extractor, video, settings);
}

function renderVideo(extractor: Extractor, video: FrameVideo, error: string | null) {
  const { settings } = extractor;
  const pick = (edge: 'start' | 'end', time: number) => {
    if (settings) {
      extractor.setSettings({ ...settings, [edge]: time });
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <button type="button" onClick={extractor.reset} className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
          Open another video
        </button>
      </div>
      <FramePlayer src={video.src} crossOrigin={video.crossOrigin} title={video.title} detail={videoDetail(video)} onPick={pick} />
      {renderError(error)}
      {renderWork(extractor, video)}
    </div>
  );
}

function renderError(message: string | null) {
  if (!message) {
    return null;
  }
  return <ErrorNote message={message} />;
}

function renderState(extractor: Extractor) {
  const { state } = extractor;
  if (state.phase === 'loading') {
    return <LoadingNote text={state.message} />;
  }
  if (state.phase === 'error' && state.video) {
    return renderVideo(extractor, state.video, state.message);
  }
  if (state.phase === 'empty' || state.phase === 'error') {
    const message = state.phase === 'error' ? state.message : null;
    return (
      <div className="flex flex-col gap-4">
        <FrameSourcePicker onFile={extractor.openFile} onLink={extractor.openLink} />
        {renderError(message)}
      </div>
    );
  }
  return renderVideo(extractor, state.video, null);
}

export function FramesPage() {
  const extractor = useFrameExtractor();

  return (
    <main className={PAGE}>
      <PageIntro
        eyebrow="Frame extractor"
        title="Save any frame of a video, in the quality you need."
        text="Pick the part of the video, how many frames per second, and the quality: lossless, HD, or small compressed images. Everything runs in your browser."
      />
      <div className="mt-8" aria-live="polite">
        {renderState(extractor)}
      </div>
      <SupportLists works={FRAME_SUPPORT} limits={FRAME_LIMITS} />
    </main>
  );
}
