const GITHUB_AGENTS_MD_URL =
  "https://raw.githubusercontent.com/seichris/jumpwalls/main/AGENTS.md";

export const revalidate = 60;

export async function GET(): Promise<Response> {
  const upstream = await fetch(GITHUB_AGENTS_MD_URL, {
    next: { revalidate },
  });

  if (!upstream.ok) {
    return new Response("Failed to load AGENTS.md from GitHub.", {
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const markdown = await upstream.text();

  return new Response(markdown, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
