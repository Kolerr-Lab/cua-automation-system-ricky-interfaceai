/** Emit the JSON Schema for reviewers + calling agents (blueprint §6, §13). Run: npm run schema:export */
import { mkdir, writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Capability } from "./schema.js";

const jsonSchema = zodToJsonSchema(Capability, { name: "Capability", $refStrategy: "none" });

await mkdir("schema", { recursive: true });
await writeFile("schema/capability.schema.json", JSON.stringify(jsonSchema, null, 2) + "\n", "utf8");
console.log("wrote schema/capability.schema.json");
