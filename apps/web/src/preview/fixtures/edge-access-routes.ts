/**
 * The traffic mix the edge access-log preview is generated from.
 *
 * Split from the generator purely for size. What matters here is the SHAPE of
 * the mix: mostly 2xx GETs, a steady trickle of 4xx from scanners hitting paths
 * that do not exist, and a couple of 5xx routes that are genuinely slow.
 */

export interface Route {
  method: string;
  path: string;
  host: string;
  /** Typical latency, ms. The generator spreads around it, with a slow tail. */
  latency: number;
  status: number;
  weight: number;
  upstream?: string;
  cache?: string;
}

export const ROUTES: Route[] = [
  {
    method: "GET",
    path: "/",
    host: "otterdeploy.com",
    latency: 42,
    status: 200,
    weight: 22,
    cache: "HIT",
  },
  {
    method: "GET",
    path: "/pricing",
    host: "otterdeploy.com",
    latency: 38,
    status: 200,
    weight: 9,
    cache: "HIT",
  },
  {
    method: "GET",
    path: "/docs/getting-started",
    host: "otterdeploy.com",
    latency: 55,
    status: 200,
    weight: 8,
    cache: "HIT",
  },
  {
    method: "GET",
    path: "/assets/app-4f2b9c.js",
    host: "app.otterdeploy.com",
    latency: 12,
    status: 200,
    weight: 18,
    cache: "HIT",
  },
  {
    method: "GET",
    path: "/api/v1/projects",
    host: "api.otterdeploy.com",
    latency: 180,
    status: 200,
    weight: 14,
    upstream: "10.0.3.14:3000",
    cache: "BYPASS",
  },
  {
    method: "GET",
    path: "/api/v1/deployments?limit=50",
    host: "api.otterdeploy.com",
    latency: 320,
    status: 200,
    weight: 7,
    upstream: "10.0.3.14:3000",
    cache: "BYPASS",
  },
  {
    method: "POST",
    path: "/api/v1/deployments",
    host: "api.otterdeploy.com",
    latency: 640,
    status: 201,
    weight: 5,
    upstream: "10.0.3.14:3000",
    cache: "BYPASS",
  },
  {
    method: "POST",
    path: "/api/auth/sign-in/email",
    host: "app.otterdeploy.com",
    latency: 210,
    status: 200,
    weight: 4,
    upstream: "10.0.3.14:3000",
    cache: "BYPASS",
  },
  {
    method: "POST",
    path: "/api/auth/sign-in/email",
    host: "app.otterdeploy.com",
    latency: 195,
    status: 401,
    weight: 3,
    upstream: "10.0.3.14:3000",
    cache: "BYPASS",
  },
  {
    method: "PATCH",
    path: "/api/v1/projects/prj_mx6sb7m0/env",
    host: "api.otterdeploy.com",
    latency: 275,
    status: 200,
    weight: 3,
    upstream: "10.0.3.14:3000",
    cache: "BYPASS",
  },
  {
    method: "PUT",
    path: "/api/v1/services/svc_9k2/scale",
    host: "api.otterdeploy.com",
    latency: 410,
    status: 200,
    weight: 2,
    upstream: "10.0.3.14:3000",
    cache: "BYPASS",
  },
  {
    method: "DELETE",
    path: "/api/v1/services/svc_9k2",
    host: "api.otterdeploy.com",
    latency: 380,
    status: 204,
    weight: 2,
    upstream: "10.0.3.14:3000",
    cache: "BYPASS",
  },
  {
    method: "GET",
    path: "/wp-login.php",
    host: "otterdeploy.com",
    latency: 8,
    status: 404,
    weight: 6,
  },
  { method: "GET", path: "/.env", host: "otterdeploy.com", latency: 6, status: 404, weight: 5 },
  {
    method: "GET",
    path: "/.git/config",
    host: "store.dealort.com",
    latency: 7,
    status: 404,
    weight: 4,
  },
  {
    method: "POST",
    path: "/xmlrpc.php",
    host: "store.dealort.com",
    latency: 9,
    status: 403,
    weight: 3,
  },
  {
    method: "GET",
    path: "/api/v1/projects/prj_missing",
    host: "api.otterdeploy.com",
    latency: 95,
    status: 404,
    weight: 3,
    upstream: "10.0.3.14:3000",
  },
  {
    method: "GET",
    path: "/api/v1/metrics",
    host: "api.otterdeploy.com",
    latency: 1850,
    status: 504,
    weight: 2,
    upstream: "10.0.3.22:8080",
    cache: "BYPASS",
  },
  {
    method: "POST",
    path: "/api/v1/builds",
    host: "api.otterdeploy.com",
    latency: 920,
    status: 500,
    weight: 2,
    upstream: "10.0.3.22:8080",
    cache: "BYPASS",
  },
  {
    method: "GET",
    path: "/checkout",
    host: "store.dealort.com",
    latency: 260,
    status: 200,
    weight: 6,
    upstream: "10.0.4.7:3000",
    cache: "MISS",
  },
];

export const AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Version/18.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "curl/8.7.1",
  "python-requests/2.32.3",
  "Googlebot/2.1 (+http://www.google.com/bot.html)",
];

export const CLIENTS = [
  { ip: "203.0.113.42", country: "GB" },
  { ip: "198.51.100.17", country: "US" },
  { ip: "192.0.2.88", country: "DE" },
  { ip: "203.0.113.201", country: "NL" },
  { ip: "198.51.100.244", country: "SG" },
  { ip: "45.155.205.233", country: "RU" },
  { ip: "185.220.101.7", country: "FR" },
];
