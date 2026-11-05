import { maxHeightFor } from '../core/settings';
import type { StreamJobOptions } from '../core/stream-jobs';
import { loadSettings } from '../shared/storage';

export async function streamJobOptions(audioOnly: boolean): Promise<StreamJobOptions> {
  const settings = await loadSettings();
  return {
    audioOnly,
    maxHeight: maxHeightFor(settings.streamQuality),
    saveSubtitles: settings.saveSubtitles && !audioOnly,
  };
}
