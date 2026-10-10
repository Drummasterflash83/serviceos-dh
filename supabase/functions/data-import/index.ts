import { handleDataImport } from "./handler.ts";

Deno.serve((req: Request) => handleDataImport(req));
