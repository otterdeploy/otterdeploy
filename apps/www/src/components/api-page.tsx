import { createOpenAPIPage } from "fumadocs-openapi/ui";

// The interactive reference renderer. fumadocs-openapi ships its own browser
// "Send Request" playground (no Scalar/Stoplight dep), so each operation page
// renders params, schemas, code samples, and a live request form.
export const OpenAPIPage = createOpenAPIPage();
