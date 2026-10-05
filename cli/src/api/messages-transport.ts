import { ApiError, checkResponseError, isRecord } from './errors';
import type { PreparedChatRequest } from './chat-request';
import { API_LIMITS } from './limits';

/** Convert validated, materialized chat history without changing durable records.
 * The selected Opus route supports native Messages tools, but its Chat bridge
 * rejects tool requests. Select the protocol before sending; never replay a call.
 */
export function prepareMessagesRequest(prepared: PreparedChatRequest): string {
  const chat = JSON.parse(prepared.body);
  const system: object[] = [], messages: {role: string; content: any[]}[] = [];
  for (const message of chat.messages) {
    if (message.role === 'system') { system.push({type: 'text', text: message.content}); continue; }
    const role = message.role === 'tool' ? 'user' : message.role;
    const blocks: any[] = [];
    if (message.role === 'tool') blocks.push({type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content});
    else {
      if (typeof message.content === 'string' && message.content.length) blocks.push({type: 'text', text: message.content});
      else if (Array.isArray(message.content)) for (const part of message.content) {
        if (part.type === 'text') blocks.push({type: 'text', text: part.text});
        else if (part.type === 'image_url') {
          const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url?.url ?? '');
          if (!match) throw new ApiError('invalid_request');
          blocks.push({type:'image',source:{type:'base64',media_type:match[1],data:match[2]}});
        } else throw new ApiError('invalid_request');
      }
      for (const call of message.tool_calls ?? []) blocks.push({type:'tool_use',id:call.id,name:call.function.name,input:JSON.parse(call.function.arguments)});
    }
    if (!blocks.length) throw new ApiError('invalid_request');
    if (messages.at(-1)?.role === role) messages.at(-1)!.content.push(...blocks);
    else messages.push({role,content:blocks});
  }
  // This route drops a trailing user turn containing only tool_result blocks.
  // An explicit continuation text keeps the original task and all results in
  // context. It is transport-only, never a replay of a completed tool effect.
  const last = messages.at(-1);
  if (last?.role === 'user' && last.content.length && last.content.every(block => block.type === 'tool_result')) {
    last.content.push({type:'text',text:'Continue the original task using the preceding tool results.'});
  }
  const choice = chat.tool_choice;
  return JSON.stringify({model:chat.model,stream:true,max_tokens:chat.max_tokens ?? chat.max_completion_tokens ?? 8192,
    ...(system.length ? {system} : {}),messages,
    ...(chat.edgey_mode ? {edgey_mode:chat.edgey_mode} : {}),
    ...(chat.reasoning_effort !== undefined ? {reasoning_effort:chat.reasoning_effort} : {}),
    tools:prepared.tools.map(({function:f})=>({name:f.name,...(f.description ? {description:f.description}:{}),input_schema:f.parameters})),
    ...(choice === undefined ? {} : {tool_choice:typeof choice === 'object' ? {type:'tool',name:choice.function.name} : {type:choice==='required'?'any':choice}}),
  });
}

/** Assemble native SSE before admitting any tool to the executable validator.
 * EOF, a stop reason, or a complete JSON argument never substitutes for message_stop.
 * readSse bounds the whole body and each event, including ignored metadata.
 */
export class MessagesStream {
  private message: Record<string, any> | undefined;
  private active: {block: Record<string, any>; json: string; bytes: number} | undefined;
  private stopped = false;
  private done = false;

  accept(event: string, value: unknown): boolean {
    if (this.done) throw new ApiError('invalid_response');
    if (!isRecord(value) || typeof value.type !== 'string' || (event !== 'message' && event !== value.type)) throw new ApiError('invalid_response');
    checkResponseError(value);
    if (value.type === 'ping') return false;
    if (value.type === 'message_start') {
      if (this.message || !isRecord(value.message) || value.message.type !== 'message' || value.message.role !== 'assistant'
        || !Array.isArray(value.message.content) || value.message.content.length || !isRecord(value.message.usage)) throw new ApiError('invalid_response');
      this.message = {...value.message, content: [], usage: {...value.message.usage}};
      return false;
    }
    const message = this.message;
    if (!message) throw new ApiError('invalid_response');
    if (value.type === 'content_block_start') {
      if (this.active || this.stopped || value.index !== message.content.length || !isRecord(value.content_block)) throw new ApiError('invalid_response');
      const block = {...value.content_block};
      if (block.type === 'text' ? typeof block.text !== 'string'
        : block.type === 'tool_use' ? !isRecord(block.input) || Object.keys(block.input).length !== 0
        : true) throw new ApiError('invalid_response');
      this.active = {block, json: '', bytes: 0};
      return false;
    }
    if (value.type === 'content_block_delta') {
      if (!this.active || this.stopped || value.index !== message.content.length || !isRecord(value.delta)) throw new ApiError('invalid_response');
      const {block} = this.active, delta = value.delta;
      if (block.type === 'text' && delta.type === 'text_delta' && typeof delta.text === 'string') block.text += delta.text;
      else if (block.type === 'tool_use' && delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        this.active.bytes += Buffer.byteLength(delta.partial_json);
        if (this.active.bytes > API_LIMITS.toolArgumentsBytes) throw new ApiError('response_too_large');
        this.active.json += delta.partial_json;
      } else throw new ApiError('invalid_response');
      return false;
    }
    if (value.type === 'content_block_stop') {
      if (!this.active || value.index !== message.content.length) throw new ApiError('invalid_response');
      const {block,json} = this.active;
      if (block.type === 'tool_use' && json) {
        try { block.input = JSON.parse(json); } catch { throw new ApiError('invalid_tool_call'); }
        if (!isRecord(block.input)) throw new ApiError('invalid_tool_call');
      }
      message.content.push(block);
      this.active = undefined;
      return false;
    }
    if (value.type === 'message_delta') {
      if (this.active || this.stopped || !isRecord(value.delta) || typeof value.delta.stop_reason !== 'string' || !isRecord(value.usage)) throw new ApiError('invalid_response');
      message.stop_reason = value.delta.stop_reason;
      message.usage = {...message.usage, ...value.usage};
      this.stopped = true;
      return false;
    }
    if (value.type === 'message_stop') {
      if (this.active || !this.stopped) throw new ApiError('invalid_response');
      this.done = true;
      return true;
    }
    // Unknown structural events could conceal content or tool arguments.
    throw new ApiError('invalid_response');
  }

  completion(): Record<string, unknown> {
    if (!this.done || this.active) throw new ApiError('truncated_stream');
    return messagesCompletion(this.message);
  }
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ApiError('invalid_response');
  return value as number;
}

/** Translate a complete native response into the existing strict tool validator.
 * Cache creation/read are separate native input counters, never output tokens.
 */
export function messagesCompletion(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ApiError('invalid_response');
  checkResponseError(value);
  if (value.type !== 'message' || value.role !== 'assistant' || !Array.isArray(value.content)
    || !isRecord(value.usage)) throw new ApiError('invalid_response');
  const finish = ({end_turn:'stop',stop_sequence:'stop',tool_use:'tool_calls',max_tokens:'length'} as Record<string,string>)[String(value.stop_reason)];
  if (!finish) throw new ApiError('invalid_response');
  let text = ''; const calls: object[] = [];
  for (const block of value.content) {
    if (!isRecord(block)) throw new ApiError('invalid_response');
    if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    else if (block.type === 'tool_use' && isRecord(block.input)) calls.push({id:block.id,type:'function',function:{name:block.name,arguments:JSON.stringify(block.input)}});
    else throw new ApiError('invalid_response');
  }
  const cache = count(value.usage.cache_read_input_tokens ?? 0);
  const input = count(count(value.usage.input_tokens) + count(value.usage.cache_creation_input_tokens ?? 0) + cache);
  const output = count(value.usage.output_tokens);
  count(input+output);
  return {model:value.model,usage:{prompt_tokens:input,completion_tokens:output,prompt_tokens_details:{cached_tokens:cache}},
    choices:[{index:0,message:{role:'assistant',content:text,...(calls.length?{tool_calls:calls}:{})},finish_reason:finish}]};
}
