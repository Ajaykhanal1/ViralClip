export function extractYouTubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] || null;
  else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2] || null;
    else if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2] || null;
  }
  if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return null;
  return id;
}

export async function fetchYouTubeMetadata(
  videoId: string,
  apiKey: string,
): Promise<{ title: string; thumbnailUrl: string | null } | null> {
  if (!apiKey) return null;
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', apiKey);
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    items?: Array<{ snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> } }>;
  };
  const snippet = data.items?.[0]?.snippet;
  if (!snippet?.title) return null;
  const thumbs = snippet.thumbnails ?? {};
  const thumb = thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null;
  return { title: snippet.title, thumbnailUrl: thumb };
}
