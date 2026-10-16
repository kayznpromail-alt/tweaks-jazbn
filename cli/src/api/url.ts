import { ApiError } from "./errors";

const defaultBaseUrl = "https://api.edgey.shop/v1";

export function normalizeBaseUrl(value: string): string {
  if (typeof value !== "string") throw new ApiError("invalid_base_url");
  const input = value.trim();
  if (!input) return defaultBaseUrl;
  // sprawdzamy również puste query, fragment i credentials usuwane przez URL.
  if (!/^https?:\/\//i.test(input) || /[\s\u0000-\u001f\u007f\\?#]/u.test(input)
    || /^https?:\/\/[^/]*@/i.test(input)) {
    throw new ApiError("invalid_base_url");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError("invalid_base_url");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "localhost."
    || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    || url.username || url.password || url.search || url.hash) {
    throw new ApiError("invalid_base_url");
  }
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/(?:\/v1)+$/, "") + "/v1";
  return url.toString();
}
