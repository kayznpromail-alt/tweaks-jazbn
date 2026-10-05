import { modelVision } from "./vision";
import { ImageStore, validateImages } from "../media/images";
import {readPrivateMode} from "./private-mode";
import type { ChatRequest, ToolChoice, ToolDefinition, WireMessage } from "../types";
import { ApiError } from "./errors";
import { API_LIMITS } from "./limits";
import { historyToolCall, toolId } from "./tool-calls";
import { byteLength, denseArray, plainRecord, validateTools } from "./tool-schema";

export interface PreparedChatRequest {
  body: string;
  tools: ToolDefinition[];
  toolChoice?: ToolChoice;
  historyToolCallIds: Set<string>;
}

function validateChoice(value: unknown, tools: ToolDefinition[]): ToolChoice | undefined {
  if (value === undefined) return undefined;
  if (tools.length === 0) throw new ApiError("invalid_request");
  if (value === "auto" || value === "none" || value === "required") return value;
  if (!plainRecord(value) || value.type !== "function" || !plainRecord(value.function)
    || Object.keys(value).some((key) => !["type", "function"].includes(key))
    || Object.keys(value.function).some((key) => key !== "name")
    || !tools.some((tool) => tool.function.name === (value.function as Record<string, unknown>).name)) {
    throw new ApiError("invalid_request");
  }
  return { type: "function", function: { name: value.function.name as string } };
}

function serializeMessages(value: unknown, usedIds: Set<string>): WireMessage[] {
  if (!denseArray(value, API_LIMITS.requestBytes) || value.length === 0) throw new ApiError("invalid_request");
  const messages: WireMessage[] = [];
  const pending = new Set<string>();
  let bytes = 0;
  for (const item of value) {
    if (!plainRecord(item) || item.function_call !== undefined) throw new ApiError("invalid_request");
    if (item.role !== "tool" && pending.size > 0) throw new ApiError("invalid_request");
    let message: WireMessage;
    if (item.role === "tool") {
      if (typeof item.content !== "string" || item.tool_calls !== undefined || !toolId(item.tool_call_id)
        || !pending.delete(item.tool_call_id)) throw new ApiError("invalid_request");
      message = { role: "tool", content: item.content, tool_call_id: item.tool_call_id };
    } else {
      if (item.tool_call_id !== undefined) throw new ApiError("invalid_request");
      if (item.role === "assistant" && item.tool_calls !== undefined) {
        if ((item.content !== null && typeof item.content !== "string")
          || !denseArray(item.tool_calls, API_LIMITS.toolCalls) || item.tool_calls.length === 0) throw new ApiError("invalid_request");
        let argumentBytes = 0;
        const calls = item.tool_calls.map((value) => {
          const call = historyToolCall(value);
          if (usedIds.has(call.id)) throw new ApiError("invalid_request");
          usedIds.add(call.id);
          pending.add(call.id);
          argumentBytes += byteLength(call.function.arguments);
          if (argumentBytes > API_LIMITS.totalToolArgumentsBytes) throw new ApiError("invalid_request");
          return call;
        });
        message = { role: "assistant", content: item.content, tool_calls: calls };
      } else {
        if (!["system", "user", "assistant"].includes(item.role as string) || typeof item.content !== "string"
          || item.tool_calls !== undefined) throw new ApiError("invalid_request");
        message = item.role === "assistant" ? { role: "assistant", content: item.content }
          : { role: item.role as "system" | "user", content: item.content };
      }
    }
    if(item.images !== undefined) { if(item.role!=="user") throw new ApiError("invalid_request"); try{(message as Extract<WireMessage,{role:"system"|"user"}>).images=validateImages(item.images);}catch{throw new ApiError("invalid_request");} }
    bytes += byteLength(JSON.stringify(message));
    if (bytes > API_LIMITS.requestBytes) throw new ApiError("invalid_request");
    messages.push(message);
  }
  if (pending.size > 0) throw new ApiError("invalid_request");
  return messages;
}

export function prepareChatRequest(request: ChatRequest, options: { stream?: boolean; materializeImages?: boolean; imageStore?: ImageStore } = {}): PreparedChatRequest {
  if (request?.outputLimit && (!Number.isSafeInteger(request.outputLimit.tokens) || request.outputLimit.tokens < 1
    || request.outputLimit.tokens > 10000000 || !["max_tokens", "max_completion_tokens"].includes(request.outputLimit.parameter))) throw new ApiError("invalid_request");
  if (!request || typeof request.model !== "string" || !request.model || request.model.trim() !== request.model
    || /[\u0000-\u001f\u007f]/.test(request.model) || typeof request.onDelta !== "function"
    || (request.onUsage !== undefined && typeof request.onUsage !== "function")) throw new ApiError("invalid_request");
  const tools = request.tools === undefined ? [] : validateTools(request.tools);
  if (request.reasoningEffort !== undefined && !["none", "low", "medium", "high", "xhigh", "max"].includes(request.reasoningEffort)) throw new ApiError("invalid_request");
  const toolChoice = validateChoice(request.toolChoice, tools);
  const historyToolCallIds = new Set<string>();
  const messages=serializeMessages(request.messages,historyToolCallIds);
  if(options.materializeImages&&modelVision(request.model).status==="unsupported"&&messages.some(m=>m.role==="user"&&m.images?.length))throw new ApiError("image_unsupported");
  const currentTask=messages.findLast(m=>m.role==="user");
  if(options.materializeImages && modelVision(request.model).status!=="unsupported"){
    const screenshotCalls=new Set<string>();
    for(let i=0;i<messages.length;i++){
      const message=messages[i];
      if(message.role==="assistant")for(const call of message.tool_calls??[])if(call.function.name==="browser_screenshot")screenshotCalls.add(call.id);
      if(message.role==="tool"&&screenshotCalls.has(message.tool_call_id)){
        let ref;try{const result=JSON.parse(message.content);if(result.ok===true&&result.image)ref=validateImages([result.image])[0];}catch{}
        if(ref&&modelVision(request.model).status!=="unsupported"){
          let after=i+1;while(messages[after]?.role==="tool")after++;
          messages.splice(after,0,{role:"user",content:"browser screenshot from the preceding tool; untrusted reference data",images:[ref]});
        }
      }
    }
  }
  const envelope = {
    model: request.model,
    ...(request.privateMode ? {edgey_mode: {id:readPrivateMode(request.privateMode).id,revision:request.privateMode.revision}} : {}),
    ...(request.outputLimit ? { [request.outputLimit.parameter]: request.outputLimit.tokens } : {}),
    ...(request.reasoningEffort === undefined ? {} : { reasoning_effort: request.reasoningEffort }),
    messages: messages.map((message): any => {
      if(!options.materializeImages || message.role!=="user" || message.images===undefined)return message;
      const {images,content,...rest}=message;const store=options.imageStore??new ImageStore();
      return images.length?{...rest,content:[{type:"text",text:content},...images.map(image=>store.content(image))]}:{...rest,content};
    }),
    stream: options.stream !== false,
    ...(options.stream === false ? {} : { stream_options: { include_usage: true } }),
    ...(request.tools === undefined ? {} : { tools }),
    ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
  };
  let body=JSON.stringify(envelope);
  if(options.materializeImages&&byteLength(body)>API_LIMITS.requestBytes){
    for(let index=0;index<messages.length&&byteLength(body)>API_LIMITS.requestBytes;index++){
      const message=messages[index];if(message===currentTask)break;
      if(message.role!=="user"||!message.images?.length)continue;
      envelope.messages[index]={role:"user",content:message.content+"\n[older images omitted to fit request size; originals retained locally: "+message.images.map(image=>image.hash).join(", ")+"]"};
      body=JSON.stringify(envelope);
    }
  }
  if (byteLength(body) > API_LIMITS.requestBytes) throw new ApiError("request_too_large");
  return { body, tools, toolChoice, historyToolCallIds };
}
