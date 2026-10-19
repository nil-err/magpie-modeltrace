// The gateway proxy: /gw/v1/* → the magpie gateway.
//
// Why this exists. The page is served from modeltrace.teyvat.org and the
// gateway lives on magpie.teyvat.org, which is behind Cloudflare Access. A
// browser cannot call it directly:
//
//   - Access answers an OPTIONS preflight with 403 whatever the caller's
//     credentials are, because a preflight never carries cookies
//     (developers.cloudflare.com/cloudflare-one/.../authorization-cookie/cors);
//   - magpie's own CORS guard, meanwhile, wants a gateway key on the preflight
//     too, and a preflight never carries the Authorization header either.
//
// Either way the browser never gets permission to send the real request. So the
// page calls its own origin instead — same-origin requests are not CORS at all —
// and this Worker forwards them, adding the Access service token on the way out
// so that token never has to live in a browser.
//
// It is not an open door to magpie: only /gw/v1/* is forwarded, and the gateway
// key still has to arrive from the page (magpie refuses a request from another
// machine without one). What the Access service token buys is the edge hop, not
// the gateway.

const GATEWAY_PATH = /^\/gw(\/v1\/.*)$/;

/**
 * Whether a path is one the proxy forwards, and where it goes.
 *
 * Exported so the routing rule can be tested without a Worker runtime: what it
 * must never do is forward something outside `/gw/v1/`.
 *
 * @returns {string} the upstream URL, or "" when this is not a gateway path
 */
export function proxyTarget(pathname, search, origin) {
  const match = GATEWAY_PATH.exec(pathname);
  if (!match) return "";
  return `${String(origin || "https://magpie.teyvat.org").replace(/\/+$/, "")}${match[1]}${search || ""}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = (env.MAGPIE_ORIGIN || "https://magpie.teyvat.org").replace(/\/+$/, "");
    const target = proxyTarget(url.pathname, url.search, origin);

    if (!target) return serveAsset(request, env, url);

    const headers = new Headers(request.headers);
    // The browser's view of this request is ours to describe, not magpie's:
    // drop the origin and the client's own address so magpie sees a plain
    // machine-to-machine call, and drop the cookie, which belongs to this
    // origin and means nothing to the gateway.
    headers.delete("origin");
    headers.delete("referer");
    headers.delete("cookie");
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("x-forwarded-for");

    if (env.CF_ACCESS_CLIENT_ID) headers.set("cf-access-client-id", env.CF_ACCESS_CLIENT_ID);
    if (env.CF_ACCESS_CLIENT_SECRET) headers.set("cf-access-client-secret", env.CF_ACCESS_CLIENT_SECRET);

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    const responseHeaders = new Headers(upstream.headers);
    // A Set-Cookie for magpie's domain has no meaning here, and a worker must
    // not attach one to a response from another origin.
    responseHeaders.delete("set-cookie");
    responseHeaders.append("x-modeltrace-proxy", "magpie");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};

/** Static files, with the one-page app's fallback for paths that are routes. */
async function serveAsset(request, env, url) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) return response;
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return response;
  return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
}
