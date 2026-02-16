export const route = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: `/${string}`) => ({
  method,
  path,
});
