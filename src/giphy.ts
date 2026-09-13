/** One Giphy result, trimmed to what the panel and the feed need. */
export interface Gif {
  id: string;
  title: string;
  preview: string;
  url: string;
}

/**
 * One page of Giphy results. An empty query is the trending list.
 *
 * `downsized` is capped at 2MB, which is what a phone on cellular wants to be
 * handed; an original can run to tens of megabytes.
 */
export async function searchGifs(key: string, q: string, offset = 0, limit = 24): Promise<Gif[]> {
  const upstream = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`);
  upstream.searchParams.set('api_key', key);
  upstream.searchParams.set('limit', String(limit));
  upstream.searchParams.set('offset', String(offset));
  upstream.searchParams.set('rating', 'pg-13');
  if (q) upstream.searchParams.set('q', q);

  const response = await fetch(upstream);
  if (!response.ok) throw new Error(`Giphy said ${response.status}`);
  const { data } = (await response.json()) as { data: any[] };
  return data.map((gif) => ({
    id: gif.id,
    title: String(gif.title || 'gif'),
    preview: gif.images.fixed_width_small.url,
    url: gif.images.downsized?.url || gif.images.original.url,
  }));
}
