export function makeWorkerClient({ CF_WORKER_BASE_URL }) {
  async function fetchIndex(limit) {
    const url = new URL(`${CF_WORKER_BASE_URL}/my-channel/videos`);
    if (limit) url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Worker error ${res.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text);
  }

  function normalize(v) {
    return {
      videoId: String(v.videoId || ""),
      title: String(v.title || ""),
      url: String(v.url || `https://www.youtube.com/watch?v=${v.videoId || ""}`),
      publishedAt: v.publishedAt ? String(v.publishedAt) : ""
    };
  }

  return { fetchIndex, normalize };
}
