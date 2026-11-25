export function normalizeAssetBase(value = "") {
  if (!value) return "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "ASSET_BASE_URL must be an HTTPS directory URL without credentials, query or fragment.",
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function assetCsp(baseURL = "") {
  const base = normalizeAssetBase(baseURL);
  const external = base ? ` ${new URL(base).origin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self'${external}`,
    `style-src 'self' 'unsafe-inline'${external}`,
    `img-src 'self' data: blob:${external}`,
    `media-src 'self' blob:${external}`,
    `font-src 'self'${external}`,
    `connect-src 'self'${external}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
