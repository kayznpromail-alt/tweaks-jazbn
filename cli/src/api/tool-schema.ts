import type { JsonPrimitive, JsonValue, ToolDefinition, ToolSchema } from "../types";
import { ApiError, isRecord, type ApiErrorCode } from "./errors";
import { API_LIMITS, EXECUTABLE_ARGUMENT_BYTES } from "./limits";
import { ToolArgumentError } from "./tool-validation";

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function denseArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  if (Object.getOwnPropertyNames(value).some((name) => name !== "length" && !/^(0|[1-9]\d*)$/.test(name))) return false;
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
}

export function toolName(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

export function plainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new ApiError("invalid_request");
}

function primitiveMatches(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

/** Clones only understood fields so caller mutation cannot change in-flight validation. */
export function validateTools(value: unknown): ToolDefinition[] {
  if (!denseArray(value, API_LIMITS.tools)) throw new ApiError("invalid_request");
  let nodes = 0;
  let bytes = 0;
  const account = (value: JsonPrimitive): void => {
    if (typeof value === "string" && byteLength(value) > API_LIMITS.toolDefinitionsBytes) throw new ApiError("invalid_request");
    bytes += byteLength(JSON.stringify(value));
    if (bytes > API_LIMITS.toolDefinitionsBytes) throw new ApiError("invalid_request");
  };
  const description = (value: Record<string, unknown>): { description?: string } => {
    if (value.description === undefined) return {};
    if (typeof value.description !== "string") throw new ApiError("invalid_request");
    account(value.description);
    return { description: value.description };
  };
  const schema = (input: unknown, depth: number): ToolSchema => {
    if (++nodes > API_LIMITS.schemaNodes || depth > API_LIMITS.schemaDepth || !plainRecord(input)) {
      throw new ApiError("invalid_request");
    }
    const bounds = input.type === "array" ? ["minItems","maxItems"] : input.type === "string" ? ["minLength","maxLength"] : ["number","integer"].includes(String(input.type)) ? ["minimum","maximum"] : [];
    const limits: Record<string,number> = {};
    for(const key of bounds) if(input[key]!==undefined){
      if(typeof input[key]!=="number" || !Number.isSafeInteger(input[key]) || (key!=="minimum" && key!=="maximum" && Number(input[key])<0))throw new ApiError("invalid_request");
      limits[key]=input[key] as number;
    }
    if(bounds.length && limits[bounds[0]!]!==undefined && limits[bounds[1]!]!==undefined && limits[bounds[0]!]!>limits[bounds[1]!]!)throw new ApiError("invalid_request");
    const info = {...description(input),...limits};
    if (input.type === "object") {
      keys(input, ["type", "description", "properties", "required", "additionalProperties"]);
      const result: ToolSchema & { type: "object" } = { type: "object", ...info };
      if (input.properties !== undefined) {
        if (!plainRecord(input.properties) || Object.keys(input.properties).length > API_LIMITS.schemaProperties) {
          throw new ApiError("invalid_request");
        }
        const properties: Record<string, ToolSchema> = Object.create(null);
        for (const [name, child] of Object.entries(input.properties)) {
          if (byteLength(name) > API_LIMITS.toolIdBytes) throw new ApiError("invalid_request");
          account(name);
          properties[name] = schema(child, depth + 1);
        }
        result.properties = properties;
      }
      if (input.required !== undefined) {
        if (!denseArray(input.required, API_LIMITS.schemaProperties)) throw new ApiError("invalid_request");
        const required: string[] = [];
        for (const name of input.required) {
          if (typeof name !== "string" || !Object.hasOwn(result.properties ?? {}, name) || required.includes(name)) {
            throw new ApiError("invalid_request");
          }
          required.push(name);
          account(name);
        }
        result.required = required;
      }
      if (input.additionalProperties !== undefined) {
        result.additionalProperties = typeof input.additionalProperties === "boolean"
          ? input.additionalProperties : schema(input.additionalProperties, depth + 1);
      }
      return result;
    }
    if (input.type === "array") {
      keys(input, ["type", "description", "items",...bounds]);
      return { type: "array", ...info, items: schema(input.items, depth + 1) };
    }
    if (typeof input.type !== "string" || !["string", "number", "integer", "boolean", "null"].includes(input.type)) {
      throw new ApiError("invalid_request");
    }
    keys(input, ["type", "description", "enum",...bounds]);
    const result: ToolSchema = { type: input.type as "string" | "number" | "integer" | "boolean" | "null", ...info };
    if (input.enum !== undefined) {
      if (!denseArray(input.enum, API_LIMITS.schemaEnumValues) || input.enum.length === 0) throw new ApiError("invalid_request");
      const seen = new Set<unknown>();
      result.enum = input.enum.map((item) => {
        if (!primitiveMatches(item, input.type as string) || seen.has(item)) throw new ApiError("invalid_request");
        seen.add(item);
        account(item as JsonPrimitive);
        return item as JsonPrimitive;
      });
    }
    return result;
  };
  const names = new Set<string>();
  const tools = value.map((input): ToolDefinition => {
    if (!plainRecord(input) || input.type !== "function" || !plainRecord(input.function)) throw new ApiError("invalid_request");
    keys(input, ["type", "function"]);
    keys(input.function, ["name", "description", "parameters"]);
    const name = input.function.name;
    if (!toolName(name) || names.has(name)) throw new ApiError("invalid_request");
    account(name);
    names.add(name);
    const parameters = schema(input.function.parameters, 0);
    if (parameters.type !== "object") throw new ApiError("invalid_request");
    return { type: "function", function: { name, ...description(input.function), parameters } };
  });
  if (byteLength(JSON.stringify(tools)) > API_LIMITS.toolDefinitionsBytes) throw new ApiError("invalid_request");
  return tools;
}

export function parseToolArguments(text: string, code: ApiErrorCode): { [key: string]: JsonValue } {
  if (byteLength(text) > EXECUTABLE_ARGUMENT_BYTES) throw new ApiError(code);
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    if(code === "invalid_tool_arguments") throw new ToolArgumentError({stage:"json",path:"$",code:"invalid_json",expected:"valid JSON object",receivedType:"invalid JSON"});
    throw new ApiError(code);
  }
  if (!isRecord(value)) {
    if(code === "invalid_tool_arguments") throw new ToolArgumentError({stage:"json",path:"$",code:"type",expected:"object",receivedType:value===null?"null":Array.isArray(value)?"array":typeof value});
    throw new ApiError(code);
  }
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > API_LIMITS.argumentNodes || depth > API_LIMITS.argumentDepth) throw new ApiError(code);
    if (typeof item === "number" && !Number.isFinite(item)) throw new ApiError(code);
    if (Array.isArray(item)) for (const child of item) visit(child, depth + 1);
    else if (isRecord(item)) for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(value, 0);
  return value as { [key: string]: JsonValue };
}

export function validateArguments(value: JsonValue, schema: ToolSchema, path = "$"): void {
  const receivedType = value===null?"null":Array.isArray(value)?"array":typeof value;
  const invalid = (code: "type" | "required" | "additional_property" | "enum" | "constraint", expected: string, location = path): never => {
    throw new ToolArgumentError({stage:"schema",path:location,code,expected,receivedType});
  };
  if (schema.type === "object") {
    if (!isRecord(value)) return invalid("type","object");
    for (const name of schema.required ?? []) if (!Object.hasOwn(value,name)) throw new ToolArgumentError({stage:"schema",path:path+"."+name,code:"required",expected:"required property",receivedType:"missing"});
    for (const [name, child] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, name)) validateArguments(child as JsonValue, schema.properties[name],path+"."+name);
      else if (schema.additionalProperties === false) return invalid("additional_property","declared properties only",path+".<unexpected>");
      else if (typeof schema.additionalProperties === "object") validateArguments(child as JsonValue, schema.additionalProperties,path+".*");
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return invalid("type","array");
    for (let i=0;i<value.length;i++) validateArguments(value[i]!,schema.items,path+"["+i+"]");
  } else {
    if (!primitiveMatches(value,schema.type)) return invalid("type",schema.type);
    if (schema.enum && !schema.enum.includes(value as JsonPrimitive)) return invalid("enum",schema.enum.map(v=>JSON.stringify(v)).join(" | "));
  }
  if(typeof value==="number" && ((schema.minimum!==undefined && value<schema.minimum)||(schema.maximum!==undefined && value>schema.maximum))) invalid("constraint",`number between ${schema.minimum??"-infinity"} and ${schema.maximum??"infinity"}`);
  if(typeof value==="string" && ((schema.minLength!==undefined && value.length<schema.minLength)||(schema.maxLength!==undefined && value.length>schema.maxLength))) invalid("constraint",`string length ${schema.minLength??0}..${schema.maxLength??"unbounded"}`);
  if(Array.isArray(value) && ((schema.minItems!==undefined && value.length<schema.minItems)||(schema.maxItems!==undefined && value.length>schema.maxItems))) invalid("constraint",`array length ${schema.minItems??0}..${schema.maxItems??"unbounded"}`);
}
