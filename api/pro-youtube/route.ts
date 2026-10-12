import { NextRequest, NextResponse } from 'next/server';

interface VideoResult {
  title: string;
  videoId: string;
}

function extractVideoIdFromUrlOrText(input: string): { videoId: string | null; isShortUrl: boolean } {
  const trimmed = input.trim();
  // Standard 11-char ID directly (e.g. dQw4w9WgXcQ)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { videoId: trimmed, isShortUrl: false };
  }
  // Shorts URL specifically
  const shortsMatch = trimmed.match(/(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i);
  if (shortsMatch && shortsMatch[1]) {
    return { videoId: shortsMatch[1], isShortUrl: true };
  }
  // Regular YouTube URLs
  const urlPattern =
    /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?.*?v=|embed\/|v\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
  const match = trimmed.match(urlPattern);
  return { videoId: match ? match[1] : null, isShortUrl: false };
}

/**
 * Strict English filter:
 * 1. Blocks any non-Latin scripts (Bengali, Arabic, Hindi, Cyrillic, Chinese, Thai, etc.)
 * 2. Blocks Romanized Bengali/South-Asian keywords (Bangla, BD, Samzone, Sohag360, etc.)
 * 3. Enforces valid English/Latin text
 */
function isStrictEnglish(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // 1. Rejects any non-Latin unicode blocks (Bengali [\u0980-\u09FF], Arabic, Cyrillic, CJK, Devanagari, Thai, etc.)
  const nonLatinRegex =
    /[\u0400-\u04FF\u0600-\u06FF\u0750-\u077F\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0E00-\u0E7F\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/;
  if (nonLatinRegex.test(trimmed)) {
    return false;
  }

  // 2. Rejects Romanized Bengali or South-Asian keywords
  const regionalKeywords =
    /\b(bangla|bangladeshi|bangladesh|bd|bengali|kolkata|dhaka|samzone|sohag360|atc|kemon|dam|koto|taka|hindi|urdu|deshi|desi)\b/i;
  if (regionalKeywords.test(trimmed)) {
    return false;
  }

  // 3. Ensure sufficient Latin alphabetical content
  const latinMatches = trimmed.match(/[a-zA-Z]/g);
  const latinCount = latinMatches ? latinMatches.length : 0;
  return latinCount / trimmed.length >= 0.25;
}

function isShortsItem(vr: any, inShortsShelf = false): boolean {
  if (inShortsShelf) return true;
  if (!vr) return false;

  // Title hashtags or brackets e.g. #shorts, #short, [shorts], (shorts)
  const title = (
    vr.title?.runs?.map((r: any) => r.text || '').join('') ||
    vr.title?.simpleText ||
    vr.title?.accessibility?.accessibilityData?.label ||
    ''
  ).toLowerCase();

  if (/#shorts?\b/.test(title) || /\[shorts?\]/.test(title) || /\(shorts?\)/.test(title)) {
    return true;
  }

  // Navigation endpoint indicates reel or shorts
  if (vr.navigationEndpoint?.reelWatchEndpoint) {
    return true;
  }
  const endpointUrl =
    vr.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
  if (endpointUrl.includes('/shorts/')) {
    return true;
  }

  // Thumbnail overlay time status indicating SHORTS badge
  const overlaysStr = JSON.stringify(vr.thumbnailOverlays || []);
  if (
    overlaysStr.includes('"SHORTS"') ||
    overlaysStr.includes('/shorts/') ||
    overlaysStr.includes('reelWatchEndpoint')
  ) {
    return true;
  }

  // Duration: YouTube Shorts are 60 seconds or less (0:xx)
  const durationStr = vr.lengthText?.simpleText?.trim();
  if (durationStr && /^[0]:[0-5][0-9]$/.test(durationStr)) {
    return true;
  }

  return false;
}

function extractInitialData(html: string): any | null {
  const regexPatterns = [
    /ytInitialData\s*=\s*({.+?});<\/script>/,
    /var ytInitialData\s*=\s*({.+?});/,
    /window\["ytInitialData"\]\s*=\s*({.+?});/,
  ];

  for (const regex of regexPatterns) {
    const match = html.match(regex);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // Fall back to balanced braces if regex caught too much
      }
    }
  }

  // Balanced brace parser fallback
  const startIdx = html.indexOf('ytInitialData');
  if (startIdx !== -1) {
    const braceIdx = html.indexOf('{', startIdx);
    if (braceIdx !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = braceIdx; i < html.length; i++) {
        const char = html[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === '{') depth++;
          else if (char === '}') {
            depth--;
            if (depth === 0) {
              try {
                return JSON.parse(html.slice(braceIdx, i + 1));
              } catch {
                break;
              }
            }
          }
        }
      }
    }
  }
  return null;
}

function traverseForVideosAndContinuation(
  node: any,
  seenIds: Set<string>,
  videos: VideoResult[],
  excludeShorts: boolean = true,
  englishOnly: boolean = true,
  inShortsShelf: boolean = false,
  onTokenFound?: (token: string) => void
) {
  if (!node || typeof node !== 'object') return;

  const isShelf = Boolean(
    node.reelShelfRenderer ||
    node.shortsLockupViewModel ||
    node.reelItemRenderer ||
    node.richShelfRenderer?.title?.runs?.some((r: any) =>
      (r.text || '').toLowerCase().includes('short')
    )
  );

  const currentShelfState = inShortsShelf || isShelf;

  if (node.videoRenderer) {
    const vr = node.videoRenderer;
    const isShort = isShortsItem(vr, currentShelfState);

    if (!excludeShorts || !isShort) {
      const videoId = vr.videoId;
      let title = '';
      if (vr.title?.runs && Array.isArray(vr.title.runs)) {
        title = vr.title.runs.map((r: any) => r.text || '').join('');
      } else if (vr.title?.simpleText) {
        title = vr.title.simpleText;
      } else if (vr.title?.accessibility?.accessibilityData?.label) {
        title = vr.title.accessibility.accessibilityData.label;
      }

      if (videoId && typeof videoId === 'string' && title && !seenIds.has(videoId)) {
        const cleanTitle = title.trim();
        // Strictly filter for English content if enabled
        if (!englishOnly || isStrictEnglish(cleanTitle)) {
          seenIds.add(videoId);
          videos.push({
            title: cleanTitle,
            videoId: videoId.trim(),
          });
        }
      }
    }
  }

  if (node.continuationItemRenderer && onTokenFound) {
    const endpoint = node.continuationItemRenderer?.continuationEndpoint;
    const token = endpoint?.continuationCommand?.token;
    if (token && typeof token === 'string') {
      onTokenFound(token);
    }
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      traverseForVideosAndContinuation(item, seenIds, videos, excludeShorts, englishOnly, currentShelfState, onTokenFound);
    }
  } else {
    for (const key of Object.keys(node)) {
      traverseForVideosAndContinuation(node[key], seenIds, videos, excludeShorts, englishOnly, currentShelfState, onTokenFound);
    }
  }
}

/**
 * Fetch a single page from youtubei endpoint with continuation token
 */
async function fetchYoutubeiContinuation(continuationToken: string): Promise<any | null> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'PREF=f1=50000000&hl=en&gl=US;',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'en',
            gl: 'US',
          },
        },
        continuation: continuationToken,
      }),
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Perform initial search HTML request
 */
async function fetchInitialSearchHtml(query: string): Promise<any | null> {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
      query
    )}&hl=en&gl=US`;

    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'PREF=f1=50000000&hl=en&gl=US;',
      },
    });

    if (!res.ok) return null;
    const html = await res.text();
    return extractInitialData(html);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() || '';
  const continuation = searchParams.get('continuation')?.trim() || null;
  const excludeShorts = searchParams.get('excludeShorts') !== 'false';
  const englishOnly = searchParams.get('englishOnly') !== 'false';
  // Target limit: default 300 at a time as requested by user, clamped to max 500
  const targetLimit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '300', 10)));

  if (!q && !continuation) {
    return NextResponse.json(
      { error: 'Please enter video keywords to search.' },
      { status: 400 }
    );
  }

  // 1. Direct Video ID or URL lookup
  if (q) {
    const { videoId: directVideoId, isShortUrl } = extractVideoIdFromUrlOrText(q);
    const isUrlLike = /^(https?:\/\/|www\.|youtube\.com|youtu\.be)/i.test(q);

    if (isUrlLike || (/^[a-zA-Z0-9_-]{11}$/.test(q) && !q.includes(' '))) {
      if (directVideoId) {
        if (isShortUrl && excludeShorts) {
          return NextResponse.json(
            {
              error: 'The entered URL is a YouTube Short. Shorts are excluded.',
              isShortBlocked: true,
            },
            { status: 400 }
          );
        }

        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${directVideoId}&format=json`;
          const oembedRes = await fetch(oembedUrl);
          if (oembedRes.ok) {
            const oembedData = await oembedRes.json();
            const title = oembedData.title || `YouTube Video (${directVideoId})`;
            return NextResponse.json({
              results: [{ title, videoId: directVideoId }],
              nextContinuation: null,
              isDirectLookup: true,
              total: 1,
            });
          }
        } catch {
          // Fall through
        }
      }
    }
  }

  const videos: VideoResult[] = [];
  const seenIds = new Set<string>();
  let latestContinuationToken: string | null = null;

  // 2. If client supplied a continuation token directly:
  if (continuation) {
    let currentToken: string | null = continuation;
    let pagesFetched = 0;

    while (currentToken && videos.length < targetLimit && pagesFetched < 15) {
      pagesFetched++;
      const data = await fetchYoutubeiContinuation(currentToken);
      if (!data) break;

      let nextFoundToken: string | null = null;
      traverseForVideosAndContinuation(
        data,
        seenIds,
        videos,
        excludeShorts,
        englishOnly,
        false,
        (token) => {
          nextFoundToken = token;
        }
      );

      currentToken = nextFoundToken;
      latestContinuationToken = nextFoundToken;
    }

    return NextResponse.json({
      results: videos.slice(0, targetLimit),
      nextContinuation: latestContinuationToken,
      total: videos.length,
      englishOnly,
    });
  }

  // 3. Search query: Collect up to targetLimit (300) English videos
  try {
    // English query variations to ensure we reliably reach 300 data even if single query pagination stops early
    const queryVariations = [
      q,
      `${q} review`,
      `${q} unboxing`,
      `${q} hands on`,
      `${q} features`,
      `${q} test`,
      `${q} official`,
      `${q} comparison`,
      `${q} guide`,
    ];

    for (const queryVariant of queryVariations) {
      if (videos.length >= targetLimit) break;

      const initialData = await fetchInitialSearchHtml(queryVariant);
      if (!initialData) continue;

      let tokenForThisVariant: string | null = null;
      traverseForVideosAndContinuation(
        initialData,
        seenIds,
        videos,
        excludeShorts,
        englishOnly,
        false,
        (token) => {
          tokenForThisVariant = token;
        }
      );

      latestContinuationToken = tokenForThisVariant;

      // Follow continuations for this variant
      let variantPage = 0;
      while (tokenForThisVariant && videos.length < targetLimit && variantPage < 8) {
        variantPage++;
        const contData = await fetchYoutubeiContinuation(tokenForThisVariant);
        if (!contData) break;

        let nextToken: string | null = null;
        traverseForVideosAndContinuation(
          contData,
          seenIds,
          videos,
          excludeShorts,
          englishOnly,
          false,
          (t) => {
            nextToken = t;
          }
        );

        tokenForThisVariant = nextToken;
        latestContinuationToken = nextToken;
      }
    }

    const finalResults = videos.slice(0, targetLimit);

    return NextResponse.json({
      results: finalResults,
      nextContinuation: latestContinuationToken,
      query: q,
      total: finalResults.length,
      targetLimit,
      excludeShorts,
      englishOnly,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'Network error while connecting to the search service.',
        details: error?.message || 'Unknown network error',
      },
      { status: 500 }
    );
  }
}
