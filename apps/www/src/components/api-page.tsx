import { createOpenAPIPage } from "fumadocs-openapi/ui";

// Keep the public reference descriptive rather than credential-bearing. The
// generated spec points at one self-hosted control plane, whose CORS policy is
// operator-controlled, and it does not currently declare an OpenAPI security
// scheme. A live browser form would therefore invite users to paste a bearer
// token into a UI that cannot reliably authenticate or send the request.
// Parameters, schemas, responses, and copyable request examples remain.
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: false },
});
