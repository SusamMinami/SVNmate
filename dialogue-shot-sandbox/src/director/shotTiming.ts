const MINIMUM_LINE_DURATION_SECONDS = 1.4;
const MAXIMUM_LINE_DURATION_SECONDS = 12;

export const MINIMUM_SHOT_DURATION_SECONDS = 4;
export const PREFERRED_MAXIMUM_SHOT_DURATION_SECONDS = 8;
export const MINIMUM_DIALOGUE_LINES_PER_SHOT = 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function matchCount(content: string, pattern: RegExp): number {
  return content.match(pattern)?.length ?? 0;
}

export function estimateDialogueDuration(content: string): number {
  const spokenUnits = content.replace(
    /[\s，。！？!?；;：:、,.…—\-"'“”‘’（）()]/g,
    "",
  ).length;
  const commaPauses = matchCount(content, /[，,、；;：:]/g) * 0.18;
  const sentencePauses = matchCount(content, /[。.!！?？]/g) * 0.32;
  const ellipsisPauses = matchCount(content, /(?:…{2,}|\.{3,})/g) * 0.75;
  const emphasisPauses = matchCount(content, /[！!？?]/g) * 0.12;
  const seconds =
    0.55 +
    spokenUnits / 4.5 +
    commaPauses +
    sentencePauses +
    ellipsisPauses +
    emphasisPauses;

  return Number(
    clamp(
      seconds,
      MINIMUM_LINE_DURATION_SECONDS,
      MAXIMUM_LINE_DURATION_SECONDS,
    ).toFixed(1),
  );
}

export function estimateShotDuration(contents: string[]): number {
  return Number(
    contents
      .reduce(
        (duration, content) => duration + estimateDialogueDuration(content),
        0,
      )
      .toFixed(1),
  );
}
