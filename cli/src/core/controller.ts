import { McpManager } from '../mcp/manager';
import { serverConfig } from '../mcp/config';
import { BrowserManager } from "../browser/manager";
import { prepareChatRequest } from "../api/chat-request";
import { modelVision } from "../api/vision";
import { ImageStore, validateImages, type ImageRef } from "../media/images";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync, statSync, writeFileSync } from "node:fs";
import { CLI_VERSION } from "../version";
import { findGit } from "../tools/git";
import { isDeepStrictEqual } from "node:util";
import { AgentSanitizer, boundedText } from "../agent/data";
import { compactRequestContext, DEFAULT_CONTEXT_BUDGET_BYTES, MAX_ORIGINAL_CONTEXT_BYTES } from "../agent/context-budget";
import { modelContextBudget, parseModelMetadata } from "../api/model-metadata";
import { AgentError, safeAgentError } from "../agent/errors";
import { contextLimit, contextPercent, measuredContext, NEW_CONTEXT_HINT, readContextUsage } from "../agent/context-usage";
import type { AgentEvent } from "../agent/events";
import type { FileApprovalRequest } from "../tools/files";
import { WorkspaceError } from "../workspace";
import { defaultArtifactDirectory } from "../workspace/artifacts";
import type { FileRead } from "../workspace/workspace";
import { ApiError, GatewayClient, normalizeBaseUrl } from "../api";
import { apiErrorHint, apiDiagnosticHint } from "../api/errors";
import {withPrivateMode,readPrivateMode,privateModeId,privateModels} from "../api/private-mode";
import {readInstruction,discoverSkills,composeInstructions,discoverPersonalInstructions,readPersonalInstruction,isPersonalInstruction,type InstructionSelection} from "../instructions/selection";
import {getDataDirectory,getInstructionsDirectory,getCommandsDirectory} from "../storage/paths";
import {discoverUserCommands,expandUserCommand} from "../instructions/commands";
import {join} from "node:path";
import { selectProfile } from "../profiles";
import { normalizeApiKey } from "../storage/credentials";
import { StorageError } from "../storage/store";
import type { AgentDetailsView, AgentMode, AgentState, AppState, Credentials, DurableStore, Gateway, JsonObject, Message, PrivateMode, Profile, Run, Session, Settings, Store, Usage, WireMessage } from "../types";
import { ControllerAgentService, durableStore, latestRun, liveRun, toolProjection, type AgentResolutions, type InstructionTrust, type ControllerAgentOptions } from "./agent-service";
import { buildContext } from "./context";
import { onlyUnknownBrowserActions, parkedBrowserRun, browserUncertaintyNotice } from '../agent/browser-recovery';
import { CoreError, safeError } from "./errors";
import { type EffortCatalog } from "../api/effort";
import { transcriptPage, type TranscriptFilter } from "./transcript";
import type { ReasoningEffort } from "../types";

export type { AppState } from "../types";

export interface ChatControllerOptions {
  instructionsHome?: string;
  effortCatalog?: EffortCatalog;
  store: Store;
  credentials: Credentials;
  profiles: Profile[];
  gatewayFactory?: (baseUrl: string, key: string) => Gateway;
  project?: string;
  checkpointMs?: number;
  agent?: ControllerAgentOptions;
}

interface Turn {
  session: Session;
  assistant: Message;
  abort: AbortController;
  done: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  dirty: boolean;
  writeError: string | null;
  persisted?: boolean;
}

class ControllerNotice extends Error {}

function projectDirectory(path: string): string {
  try {
    if (typeof path !== "string" || !path.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(path)) throw new Error();
    const project = realpathSync(path);
    if (!statSync(project).isDirectory()) throw new Error();
    return project;
  } catch { throw new CoreError("project"); }
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    if (Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * kontrakt ui:
 * - constructor i mutacje synchroniczne rzucają wyłącznie bezpieczne błędy;
 *   mutacje ustawiają również state.error.
 * - initialize/connect/send/retry raportują błąd przez state.error i rozwiązują promise.
 * - cancel anuluje stream lub uwierzytelnianie i czeka na zakończenie operacji.
 *   rozpoczęty zapis klucza może się dokończyć, ale nie przywróci połączenia.
 *   disconnect/dispose mogą odrzucić promise bezpiecznym błędem (ui powinno użyć
 *   .catch). dispose zgłasza też niezapisane dane, po close.
 * - podczas streamingu/łączenia mutacje są blokowane. disconnect/dispose najpierw
 *   anulują i czekają; dispose nie usuwa systemowego klucza.
 * - remember=false nie odczytuje/usuwa starego systemowego klucza; używa nowego tylko
 *   w bieżącym procesie. usunięcie poświadczenia wymaga jawnego disconnect.
 * - po błędzie zapisu zachowujemy tekst w snapshotcie, blokujemy dalsze zmiany rozmowy.
 *   jawne resumeSession wczytuje wersję z dysku (odrzucając niezapisany tekst).
 * - retry zachowuje poprzednie próby w historii, dodaje tylko assistant; kontekst
 *   regeneracji kończy się ostatnim user. nie ma automatycznych ponowień.
 * - sesja jest źródłem aktualnego modelu. jeśli po jej zapisie zawiedzie zapis
 *   settings, snapshot pokazuje już utrwalony model i błąd ustawień; ponów wybór.
 * - wznowienie projektu wybiera sesję o najnowszym updatedAt (porządek Store).
 *   błąd initialize kończy inicjalizację; można jawnie otworzyć projekt/nową sesję.
 *   niedostępny zapamiętany projekt zastępujemy zwalidowanym cwd z komunikatem.
 *   checkpoint ma interwał 1–250 ms; wymaga działającej pętli zdarzeń.
 */
export class ChatController {
  #answerQuestion?: (answer: string) => void;
  answerAgentQuestion(answer: string): void {
    if (!this.#answerQuestion || !answer.trim() || answer.length > 16000) throw new Error("no pending question or invalid answer");
    this.#answerQuestion(this.safeText(answer));
  }
  private askAgentQuestion(question: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.reject(new AgentError("aborted"));
    this.#state.userQuestion = this.safeText(question); this.publish();
    return new Promise((resolve, reject) => {
      const clear = () => { signal.removeEventListener("abort", cancel); this.#answerQuestion = undefined; delete this.#state.userQuestion; this.publish(); };
      const cancel = () => { clear(); reject(new AgentError("aborted")); };
      this.#answerQuestion = (answer) => { clear(); resolve(answer); };
      signal.addEventListener("abort", cancel, { once: true });
    });
  }
  readonly #store: Store;
  readonly #credentials: Credentials;
  readonly #profiles: Profile[];
  readonly #instructionsHome: string;
  readonly #commandsHome: string;
  readonly #personalInstructionsDirectory: string;
  readonly #factory: (baseUrl: string, key: string) => Gateway;
  readonly #checkpointMs: number;
  readonly #listeners = new Set<() => void>();
  // Project navigation can return to this window's chat, never another window's latest chat.
  readonly #projectSessions = new Map<string, string>();
  #state: AppState;
  #snapshot: AppState;
  #gateway: Gateway | null = null;
  #operation: Promise<void> | null = null;
  #authAbort: AbortController | null = null;
  #turn: Turn | null = null;
  #unsaved = false;
  #disconnectTask: Promise<void> | null = null;
  #disposeTask: Promise<void> | null = null;
  #closing = false;
  #closed = false;
  readonly #agentOptions?: ControllerAgentOptions;
  readonly #journal?: DurableStore;
  #key: string | null = null;
  #agentService?: ControllerAgentService;
  #attachments: FileRead[] = [];
  #approval?: { toolId: string; settle: (allow: boolean) => void };
  #manualAbort?: AbortController;
  #cleanup: Promise<void> = Promise.resolve();
  #cancelTask: Promise<void> | null = null;
  #forceCloseTask: Promise<void> | null = null;
  readonly #instructionTrust = new Map<string, InstructionTrust[]>();
  #subagentModel?: string;

  getSubagentModel(): string | undefined { return this.#subagentModel ?? this.#state.settings.model ?? undefined; }
  setSubagentModel(model?: string): void {
    this.mutate(() => {
      if (model !== undefined && !this.#state.models.some((item) => item.id === model)) throw new CoreError("model");
      this.#subagentModel = model;
    });
  }

  constructor(options: ChatControllerOptions) {
    this.#store = options.store;
    this.#credentials = options.credentials;
    this.#factory = options.gatewayFactory ?? ((baseUrl, key) => new GatewayClient(baseUrl, key, options.effortCatalog, new ImageStore(options.agent?.dataDirectory)));
    this.#checkpointMs = Number.isFinite(options.checkpointMs)
      ? Math.max(1, Math.min(250, options.checkpointMs!)) : 250;
    try {
      this.#agentOptions = options.agent ? structuredClone(options.agent) : undefined;
      if (this.#agentOptions) {
        this.#journal = durableStore(options.store);
        if (this.#agentOptions.mode && !["plan", "review", "trusted", "auto", "bypass"].includes(this.#agentOptions.mode)) throw new AgentError("invalid_input");
      }
      this.#instructionsHome = options.instructionsHome ?? getDataDirectory();
      this.#commandsHome = options.instructionsHome ? join(options.instructionsHome,"commands") : getCommandsDirectory();
      this.#personalInstructionsDirectory = options.instructionsHome ? join(options.instructionsHome,"instructions") : getInstructionsDirectory();
      this.#profiles = structuredClone(options.profiles);
      // waliduje także konflikty przed pierwszym połączeniem.
      selectProfile(this.#profiles, "validation");
      const saved = this.#store.getSettings();
      let project: string;
      let notice: string | null = null;
      if (options.project !== undefined) project = projectDirectory(options.project);
      else if (saved.lastProject !== undefined) {
        try { project = projectDirectory(saved.lastProject); }
        catch {
          project = projectDirectory(process.cwd());
          notice = "the previous project directory is unavailable. opened the current directory.";
        }
      } else project = projectDirectory(process.cwd());
      const settings: Settings = {
        ...saved, baseUrl: normalizeBaseUrl(saved.baseUrl), lastProject: project,
        model: saved.model ? canonicalModel(saved.model) : saved.model,
        favorites: [...new Set(saved.favorites.map(canonicalModel))], recentModels: [...new Set((saved.recentModels ?? []).map(canonicalModel))].slice(0, 20),
      };
      this.#store.saveSettings(settings);
      this.#state = {
        initialized: false, connection: "disconnected", credentialMode: "none", busy: false,
        models: [], settings, project, session: null, sessions: [],
        profile: settings.model ? selectProfile(this.#profiles, settings.model) : null,
        error: null, notice,
        ...(this.#agentOptions ? { agent: { enabled: true, mode: this.#agentOptions.mode ?? "review", phase: "idle",
          runId: null, events: [], approval: null, tools: [], tasks: [], jobs: [], attachments: [] } } : {}),
      };
      this.#snapshot = freeze(structuredClone(this.#state));
    } catch (error) { throw new Error(safeError(error)); }
  }

  getSnapshot = (): AppState => this.#snapshot;

  #efforts = new Map<string, ReasoningEffort>();
  getReasoningEfforts(): ReasoningEffort[] {
    return [...(this.#state.models.find((model) => model.id === this.#state.settings.model)?.reasoningEfforts ?? [])];
  }
  getReasoningEffort(): ReasoningEffort | undefined {
    const value = this.#efforts.get(JSON.stringify([this.#state.settings.baseUrl, this.#state.settings.model]));
    return value && this.getReasoningEfforts().includes(value) ? value : undefined;
  }
  setReasoningEffort(value: ReasoningEffort | undefined): void {
    this.mutate(() => {
      if (value !== undefined && !this.getReasoningEfforts().includes(value)) throw new ControllerNotice("this model has no declaration for that effort level.");
      const id = JSON.stringify([this.#state.settings.baseUrl, this.#state.settings.model]);
      if (value === undefined) this.#efforts.delete(id); else this.#efforts.set(id, value);
      this.#state.notice = `effort: ${value ?? "default"} for new tasks. /continue retains the original run effort.`;
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  private publish(): void {
    if (isDeepStrictEqual(this.#state, this.#snapshot)) return;
    const { agent, ...state } = this.#state;
    // Agent projections are immutable and bounded; never clone durable tool logs on a delta.
    this.#snapshot = freeze({ ...structuredClone(state), ...(agent ? { agent: freeze(agent) } : {}) });
    // wyjątek renderera nie może przerwać zapisu/obsługi strumienia.
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* odbiorca odpowiada za swoje błędy */ }
    }
  }

  private fail(error: unknown): void {
    this.#state.error = this.agentError(error);
    this.publish();
  }

  private assertIdle(allowUnsaved = false, allowUninitialized = false): void {
    if (this.#closing || this.#closed) throw new CoreError("closed");
    if (this.#turn || this.#operation || this.#disconnectTask || this.#cancelTask) throw new CoreError("busy");
    if (!allowUninitialized && !this.#state.initialized) throw new CoreError("uninitialized");
    if (!allowUnsaved && this.#unsaved) throw new CoreError("unsaved");
  }

  private mutate(action: () => void, allowUnsaved = false): void {
    try {
      this.assertIdle(allowUnsaved);
      action();
      this.#state.error = null;
      this.publish();
    } catch (error) {
      this.fail(error);
      throw new Error(safeError(error));
    }
  }

  private settingsForModel(model: string): Settings {
    return { ...this.#state.settings, model, recentModels: [model, ...(this.#state.settings.recentModels ?? [])
      .filter((id) => id !== model)].slice(0, 20) };
  }

  private summarize(session: Session): void {
    const { id, title, model, updatedAt } = session;
    this.#state.sessions = [{ id, title, model, updatedAt }, ...this.#state.sessions.filter((item) => item.id !== id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  private readSession(id: string, project: string): { session: Session; recovered: boolean; live?: boolean } {
    const session = this.#store.loadSession(id);
    if (!session || session.project !== project) throw new CoreError("session");
    // Normalize only routing identity; historical request/output records are retained.
    session.model = canonicalModel(session.model);
    // Expiry is not cleanup proof. Even a stale owner keeps streaming placeholders read-only.
    const owned = this.#journal?.listRuns(id).some((run) => run.ownerId);
    let recovered = false;
    for (const message of session.messages) {
      if (!owned && message.status === "streaming") { message.status = "interrupted"; recovered = true; }
    }
    if (this.#journal) {
      const run = latestRun(this.#journal, id), last = session.messages.at(-1);
      if (run && last?.role === "assistant" && ["streaming", "interrupted", "error"].includes(last.status)) {
        const output = this.#journal.listRequestAttempts(run.id).at(-1)?.output?.content;
        const index = session.messages.findIndex((message) => message.id === run.id);
        if (typeof output === "string" && index > session.messages.findLastIndex((message) => message.role === "user") && last.content !== output) {
          last.content = this.safeText(output); recovered = true;
        }
      }
    }
    if (owned) return { session, recovered: false, live: true };
    if (recovered) this.#store.saveSession(session);
    return { session, recovered };
  }

  private restoreProject(project: string, notice: string | null = null, restoreWindowSession = true): void {
    const sessions = this.#store.listSessions(project).map(row => ({...row, model:canonicalModel(row.model)}));
    const remembered = restoreWindowSession ? this.#projectSessions.get(project) : undefined;
    const restored = remembered && sessions.some(session => session.id === remembered) ? this.readSession(remembered, project) : null;
    const settings = { ...(restored ? this.settingsForModel(restored.session.model) : this.#state.settings), lastProject: project };
    this.#store.saveSettings(settings);
    Object.assign(this.#state, {
      project, settings, sessions, session: restored?.session ?? null,
      profile: settings.model ? this.effectiveProfile(settings.model, restored?.session ?? null) : null,
      notice: [notice, restored?.live ? "this session has a live agent owner. wait for it to finish, then resume the session."
        : restored?.recovered ? "the previous response was interrupted. you can retry it manually." : null]
        .filter(Boolean).join(" ") || null,
    });
    if (restored) this.summarize(restored.session);
    this.restoreAgentState();
  }

  initialize(): Promise<void> {
    if (this.#closing || this.#closed) { this.fail(new CoreError("closed")); return Promise.resolve(); }
    if (this.#operation) return this.#operation;
    if (this.#state.initialized) return Promise.resolve();
    try { this.assertIdle(false, true); }
    catch (error) { this.fail(error); return Promise.resolve(); }
    return this.authenticate(async (signal) => {
      this.restoreProject(this.#state.project, this.#state.notice, false);
      this.#state.initialized = true;
      this.publish();
      if (signal.aborted) return;
      let key: string | null;
      try { key = await this.#credentials.get(this.#state.settings.baseUrl); }
      catch { throw new CoreError("credential_read"); }
      if (key !== null && !signal.aborted) await this.validateConnection(key, true, false, signal);
    });
  }

  connect(key: string, remember: boolean): Promise<void> {
    try { this.assertIdle(); }
    catch (error) { this.fail(error); return Promise.resolve(); }
    return this.authenticate((signal) => this.validateConnection(key, remember, remember, signal));
  }

  private authenticate(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const abort = new AbortController();
    this.#authAbort = abort;
    this.#gateway = null;
    this.retireAgentService();
    this.#key = null;
    Object.assign(this.#state, { connection: "connecting", credentialMode: "none", models: [], error: null });
    const task = Promise.resolve().then(() => {
      if (!abort.signal.aborted) return action(abort.signal);
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) this.#state.error = safeError(error);
    }).finally(() => {
      // także błąd restore lub anulowanie initialize musi odblokować mutacje ui.
      this.#state.initialized = true;
      if (!this.#gateway) this.#state.connection = "disconnected";
      this.#operation = null;
      this.#authAbort = null;
      this.publish();
    });
    this.#operation = task;
    this.publish();
    return task;
  }

  private async validateConnection(key: string, system: boolean, save: boolean, signal: AbortSignal): Promise<void> {
    let normalized: string;
    try { normalized = normalizeApiKey(key); } catch { throw new CoreError("key"); }
    const gateway = this.#factory(this.#state.settings.baseUrl, normalized);
    // Authenticate with the standard models endpoint.
    const authSignal = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    let models: import("../types").Model[] = [];
    models = await gateway.listModels(authSignal);

    if (signal.aborted) return;
    if (save) {
      try { await this.#credentials.set(this.#state.settings.baseUrl, normalized); }
      catch { throw new CoreError("credential_write"); }
    }
    if (signal.aborted) return;
    this.#gateway = gateway;
    this.#key = normalized;
    Object.assign(this.#state, { models, connection: "connected", credentialMode: system ? "system" : "memory" });
  }

  refreshModels(): Promise<void> {
    this.assertIdle();
    if (!this.#gateway) return Promise.resolve();
    const gateway = this.#gateway;
    const abort = new AbortController(); this.#authAbort = abort;
    const task = gateway.listModels(AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]))
      .then(models => { if (!abort.signal.aborted && gateway === this.#gateway) { this.#state.models = models; this.#state.notice = null; this.#state.error = null; } })
      .catch(error => { if (!abort.signal.aborted) this.#state.error = safeError(error); })
      .finally(() => { this.#operation = null; this.#authAbort = null; this.publish(); });
    this.#operation = task; this.publish(); return task;
  }

  selectModel(id: string): void | Promise<void> {
    const mode=this.#state.session?.privateMode;
    if(mode && id!==privateModels[mode.id]) return this.switchPrivateModel(id);
    this.commitModel(id);
  }

  private async switchPrivateModel(id: string): Promise<void> {
    try {
      this.assertIdle(); this.assertSessionAvailable();
      if(!this.#state.models.some(model=>model.id===id))throw new CoreError("model");
      const modeId=privateModeId(id);
      if(!modeId)throw new ApiError("jailbreak_model_mismatch");
      const session=this.#state.session,gateway=this.#gateway;
      if(!gateway)throw new CoreError("disconnected");
      const capability=(await gateway.privateCapabilities?.())?.find(mode=>mode.id===modeId);
      this.assertIdle();
      if(this.#state.session!==session || this.#gateway!==gateway)throw new ControllerNotice("session changed while loading instructions; try again.");
      if(!capability)throw new ApiError("jailbreak_not_allowed");
      this.commitModel(id,readPrivateMode(capability));
    } catch(error) {
      this.fail(error);
      throw new Error(safeError(error));
    }
  }

  private commitModel(id: string, mode?: PrivateMode): void {
    this.mutate(() => {
      this.assertSessionAvailable();
      if (!this.#state.models.some((model) => model.id === id)) throw new CoreError("model");
      const profile = this.effectiveProfile(id);
      const settings = this.settingsForModel(id);
      if (this.#state.session) {
        const session = structuredClone(this.#state.session);
        session.model = id;
        if(mode)session.privateMode=mode;
        this.#store.saveSession(session);
        this.#state.session = session;
        this.summarize(session);
        this.#state.profile = profile;
        if (this.#state.agent?.context?.model !== id) this.patchAgent({ context: undefined });
        // sesja została utrwalona; błąd osobnego zapisu settings nie może pokazać
        // sprzecznych modeli w pasku ui i następnej wysyłanej wiadomości.
        this.#state.settings = settings;
      }
      this.#store.saveSettings(settings);
      this.#state.settings = settings;
      this.#state.profile = profile;
    });
  }

  toggleFavorite(id: string): void {
    this.mutate(() => {
      const favorites = this.#state.settings.favorites;
      if (!favorites.includes(id) && !this.#state.models.some((model) => model.id === id)) throw new CoreError("model");
      const settings = { ...this.#state.settings, favorites: favorites.includes(id)
        ? favorites.filter((model) => model !== id) : [...favorites, id] };
      this.#store.saveSettings(settings);
      this.#state.settings = settings;
    });
  }

  openProject(path: string): void {
    this.mutate(() => {
      const project = projectDirectory(path);
      if (this.#state.session) this.#projectSessions.set(this.#state.project, this.#state.session.id);
      else this.#projectSessions.delete(this.#state.project);
      this.retireAgentService();
      this.#attachments = [];
      this.restoreProject(project);
    });
  }

  private effectiveProfile(model: string, session = this.#state.session): Profile | null {
    return selectProfile(this.#profiles, canonicalModel(model));
  }

  async toggleJailbreak(): Promise<void> {
    try {
      this.assertIdle(); this.assertSessionAvailable();
      const original = this.#state.session, model = original?.model ?? this.#state.settings.model;
      if (!model) throw new CoreError("model");
      if (!original?.privateMode && !privateModeId(model)) throw new ControllerNotice("jailbreak is only available for astra 6 and opus 5.");
      if (!original?.privateMode && !this.#gateway) throw new CoreError("disconnected");
      const sourceGateway=this.#gateway;
      const capability = original?.privateMode ? undefined : (await sourceGateway?.privateCapabilities?.())?.find(mode=>mode.id===privateModeId(model));
      if (!original?.privateMode && !capability) throw new ControllerNotice("private mode is unavailable for this api/key. ask the operator to enable it.");
      const modeSnapshot = capability ? readPrivateMode(capability) : undefined;
      this.assertIdle();
      if (this.#gateway !== sourceGateway || this.#state.session !== original || this.#state.settings.model !== model) throw new ControllerNotice("session changed while loading instructions; try again.");
      const session = original ? structuredClone(original) : this.#store.createSession(this.#state.project, model);
      if(modeSnapshot)session.privateMode=modeSnapshot;else delete session.privateMode;
      this.#store.saveSession(session);
      this.#state.session = session;
      this.#state.profile = this.effectiveProfile(model);
      this.#state.notice = modeSnapshot ? "jailbreak ON" : "jailbreak off";
      this.summarize(session); this.publish();
    } catch (error) { this.fail(error instanceof Error && !(error instanceof CoreError) && !(error instanceof StorageError) ? new ControllerNotice(error.message) : error); }
  }

  listSkills():InstructionSelection[]{return discoverSkills(this.#state.project,join(this.#instructionsHome,"skills"));}
  listUserCommands(){return discoverUserCommands(this.#state.project,this.#commandsHome);}
  sendUserCommand(text:string,images:ImageRef[]=[],imagePositions?:number[]):Promise<void>{
    try{this.assertIdle();this.assertSessionAvailable();return this.send(expandUserCommand(text,this.listUserCommands()),images,imagePositions);}
    catch(error){this.fail(new ControllerNotice(error instanceof Error?error.message:"could not load command."));return Promise.resolve();}
  }
  getPersonalInstructionsDirectory():string {return this.#personalInstructionsDirectory;}
  listPersonalInstructions():ReturnType<typeof discoverPersonalInstructions> {return discoverPersonalInstructions(this.#personalInstructionsDirectory);}
  previewPersonalInstruction(name:string):InstructionSelection {return readPersonalInstruction(this.#personalInstructionsDirectory,name);}
  selectPersonalInstruction(name:string,expectedHash:string):void {
    this.updateSources(sources=>{
      const source=this.previewPersonalInstruction(name);
      if(source.hash!==expectedHash)throw new ControllerNotice("the instruction file changed. refresh and review it before applying.");
      return [...sources.filter(s=>s.kind!=="markdown"),source];
    });
  }
  clearMarkdownInstructions():void {this.updateSources(sources=>sources.filter(s=>s.kind!=="markdown"));}
  selectMarkdown(path:string):void {this.updateSources(sources=>[...sources.filter(s=>s.kind!=="markdown"),readInstruction(this.#state.project,path)]);}
  toggleSkill(id:string):void {this.updateSources(sources=>{if(sources.some(s=>s.id===id&&s.kind==="skill"))return sources.filter(s=>s.id!==id);const source=this.listSkills().find(s=>s.id===id);if(!source)throw new Error("skill not found.");return [...sources,source];});}
  removeInstruction(id:string):void {this.updateSources(sources=>sources.filter(s=>s.id!==id));}
  private updateSources(update:(sources:InstructionSelection[])=>InstructionSelection[]):void {
    this.mutate(()=>{const model=this.#state.settings.model;if(!model)throw new CoreError("model");
      const session=this.#state.session?structuredClone(this.#state.session):this.#store.createSession(this.#state.project,model);
      const sources=update(session.instructionSources??[]);composeInstructions(sources);session.instructionSources=sources;
      this.#store.saveSession(session);this.#state.session=session;this.summarize(session);
    });
  }

  forceClose(): Promise<void> {
    if(this.#forceCloseTask)return this.#forceCloseTask;
    const previous=this.#state.session?structuredClone(this.#state.session):null;
    const task=(async()=>{
      try{await this.cancel();}catch(error){
        if(this.#turn)throw error;
        // The old session retains uncertain outcomes; new work has independent ownership.
        this.#cleanup=Promise.resolve();
      }
      this.mutate(()=>{
        const model=previous?.model??this.#state.settings.model;
        if(!model)throw new CoreError("model");
        const session=this.#store.createSession(this.#state.project,model);
        if(previous?.privateMode)session.privateMode=structuredClone(previous.privateMode);
        if(previous?.instructionSources)session.instructionSources=structuredClone(previous.instructionSources);
        this.#store.saveSession(session);
        this.#state.session=session;
        this.#state.profile=this.effectiveProfile(model,session);
        this.#attachments=[];
        this.summarize(session);this.restoreAgentState();
        this.#state.notice="new session ready in the same folder. previous work remains in /sessions.";
      });
    })().finally(()=>{this.#forceCloseTask=null;});
    this.#forceCloseTask=task;return task;
  }

  newSession(): void {
    this.mutate(() => {
      const model = this.#state.settings.model;
      if (!model) throw new CoreError("model");
      const inherited = this.#state.session?.instructionSources?.filter(isPersonalInstruction);
      const session = this.#store.createSession(this.#state.project, model);
      if (inherited?.length) {
        session.instructionSources = structuredClone(inherited);
        this.#store.saveSession(session);
      }
      this.#state.session = session;
      this.#state.profile = selectProfile(this.#profiles, model);
      this.#state.notice = null;
      this.summarize(session);
      this.#attachments = [];
      this.restoreAgentState();
    });
  }

  resumeSession(id: string): void {
    this.mutate(() => {
      const { session, recovered, live } = this.readSession(id, this.#state.project);
      const sessions = this.#store.listSessions(this.#state.project).map(row => ({...row, model:canonicalModel(row.model)}));
      const settings = this.settingsForModel(session.model);
      this.#store.saveSettings(settings);
      this.#state.session = session;
      this.#state.settings = settings;
      this.#state.profile = this.effectiveProfile(session.model);
      this.#state.notice = live ? "this session has a live agent owner. wait for it to finish, then resume the session."
        : this.#unsaved ? "loaded the saved version; unsaved text was discarded."
        : recovered ? "the previous response was interrupted. you can retry it manually." : null;
      this.#unsaved = false;
      this.#state.sessions = sessions;
      this.summarize(session);
      this.#attachments = [];
      this.restoreAgentState();
    }, true);
  }

  deleteSession(id: string): void {
    // deleting is allowed with unsaved text: removing another session loses nothing,
    // and removing the open one is the user's explicit choice to drop it.
    this.mutate(() => {
      if (!this.#state.sessions.some((session) => session.id === id)) throw new CoreError("session");
      this.recoverInactiveSession(id);
      if (!this.#store.deleteSession(id)) throw new CoreError("session");
      this.#state.sessions = this.#state.sessions.filter((session) => session.id !== id);
      if (this.#state.session?.id === id) {
        this.#state.session = null;
        this.#unsaved = false;
        this.#state.notice = "the open conversation was deleted. the next message starts a new one.";
        this.#attachments = [];
        this.restoreAgentState();
      }
    }, true);
  }

  #browser?:BrowserManager;
  browser():BrowserManager {return this.#browser??=new BrowserManager(this.#agentOptions?.dataDirectory);}
  browserSession():string {this.assertIdle();if(!this.#state.session){const model=this.#state.settings.model;if(!model)throw new CoreError("model");this.#state.session=this.#store.createSession(this.#state.project,model);this.#store.saveSession(this.#state.session);this.summarize(this.#state.session);this.publish();}return this.#state.session.id;}
  imageStore(): ImageStore { return new ImageStore(this.#agentOptions?.dataDirectory); }

  send(text: string, images: ImageRef[] = [], imagePositions?:number[]): Promise<void> {
    return this.startTurn(text, false, images, imagePositions);
  }

  retry(): Promise<void> {
    try { if (this.#state.agent?.enabled && this.currentAgentRun()) return this.continueAgent(); }
    catch (error) { this.fail(error); return Promise.resolve(); }
    return this.startTurn(undefined, true);
  }

  private startTurn(text: string | undefined, retry: boolean, images: ImageRef[] = [], imagePositions?:number[]): Promise<void> {
    try {
      this.assertIdle();
      this.assertSessionAvailable();
      const context = readContextUsage(this.#state.agent?.context ?? this.#state.session?.messages.at(-1)?.context);
      if (context?.full && context.model === this.#state.session?.model) throw new AgentError("model_context_exceeded");
      if (!this.#gateway) throw new CoreError("disconnected");
      const pending = this.currentAgentRun();
      const parkBrowser=!!pending&&!retry&&pending.status==='recovery_required'&&onlyUnknownBrowserActions(this.#journal!.listToolExecutions(pending.id));
      if (pending && !parkBrowser&&!parkedBrowserRun(pending)&&(["running", "awaiting_approval", "recovery_required"].includes(pending.status)
        || this.#journal!.listToolExecutions(pending.id).some((tool) => !["succeeded", "failed", "denied", "cancelled"].includes(tool.status)))) {
        throw new ControllerNotice("the previous run has unresolved effects. use /recover before sending a new task.");
      }
      const model = this.#state.session?.model ?? this.#state.settings.model;
      if (!model || !this.#state.models.some((item) => item.id === model)) throw new CoreError("model");
      if(images.length&&modelVision(model).status==="unsupported")throw new ControllerNotice("this model does not support images; choose a vision model with /models. your draft is retained.");
      images=validateImages(images);
      for(const image of images)this.imageStore().read(image);
      if (!retry && (typeof text !== "string" || (!text.trim() && !images.length))) throw new CoreError("text");
      if(parkBrowser)this.service().parkBrowserRecovery(pending!.id);
      const last = this.#state.session?.messages.at(-1);
      if (retry && (!last || last.role !== "assistant" || !["interrupted", "error"].includes(last.status)
        || !this.#state.session!.messages.some((message) => message.role === "user"))) throw new CoreError("retry");
      const session = this.#state.session ? structuredClone(this.#state.session)
        : this.#store.createSession(this.#state.project, model);
      const profile = this.effectiveProfile(model, session);
      if (retry && (last?.profile?.id === "private-profile" || profile?.id === "private-profile") && (last?.profile?.id !== profile?.id || last?.profile?.version !== profile?.version)) throw new ControllerNotice("restore the original profile and jailbreak mode before retrying.");
      const instructionVersion=createHash("sha256").update(JSON.stringify((session.instructionSources??[]).map(s=>[s.id,s.hash]))).digest("hex");
      if(retry && ((last?.requestedMode?.revision !== (privateModeId(model)?session.privateMode?.revision:undefined)) || (last?.instructionVersion && last.instructionVersion!==instructionVersion)))throw new ControllerNotice("restore the original mode revision and selected instruction sources before retrying, or start a new request.");
      const createdAt = new Date().toISOString();
      if (!retry) {
        if (this.#agentOptions) text = this.safeText(text!);
        if (!session.messages.length) session.title = text!.trim().replace(/\s+/g, " ").slice(0, 80);
        session.messages.push({ id: randomUUID(), role: "user", content: text!, ...(images.length ? {images, ...(imagePositions ? {imagePositions} : {})} : {}), status: "complete", createdAt });
      }
      const messages = buildContext(session.messages, profile, retry);
      const selected=composeInstructions(session.instructionSources??[]);if(selected)messages.splice(profile?1:0,0,{role:"system",content:selected});
      if(messages.some(m=>m.role==="user"&&m.images?.length))prepareChatRequest({model,messages,onDelta(){}},{materializeImages:true,imageStore:this.imageStore()});
      const assistant: Message = {
        id: randomUUID(), role: "assistant", content: "", status: "streaming", createdAt, model, instructionVersion,
        ...(privateModeId(model) && session.privateMode ? {requestedMode:{...session.privateMode}} : {}),
        ...(profile ? { profile: { id: profile.id, version: profile.version } } : {}),
      };
      session.messages.push(assistant);
      this.#state.error = null;
      this.#state.notice = null;
      if (!this.#state.agent?.enabled) {
        this.#state.session = session;
        this.#state.profile = profile;
        try { this.#store.saveSession(session); }
        catch (error) {
          assistant.status = "interrupted";
          this.recordWriteFailure(error);
          this.publish();
          return Promise.resolve();
        }
        this.summarize(session);
      }
      const turn: Turn = { session, assistant, abort: new AbortController(), done: Promise.resolve(), dirty: false, writeError: null };
      this.#turn = turn;
      this.#state.busy = true;
      const gateway = withPrivateMode(this.#gateway, session.privateMode, applied=>{if(assistant.model && privateModeId(assistant.model))assistant.privateMode={...applied};if(session.privateMode?.id===applied.id&&session.privateMode.revision===applied.revision)session.privateMode={...applied};});
      turn.done = Promise.resolve().then(() => this.#state.agent?.enabled
        ? this.runAgentTurn(turn, gateway, messages) : this.runTurn(turn, gateway, messages));
      this.publish();
      return turn.done;
    } catch (error) { this.fail(error); return Promise.resolve(); }
  }

  private recordWriteFailure(error: unknown): string {
    this.#unsaved = true;
    const detail = error instanceof StorageError && error.code === "session_conflict"
      ? "the session was changed by another process; its changes were preserved."
      : "could not save the conversation.";
    const message = `${detail} ${safeError(new CoreError("unsaved"))}`;
    this.#state.error = message;
    this.#state.notice = safeError(new CoreError("unsaved"));
    return message;
  }

  private checkpoint(turn: Turn): void {
    turn.timer = undefined;
    if (!turn.dirty || turn.writeError) return;
    try {
      this.#store.saveSession(turn.session);
      turn.dirty = false;
      this.summarize(turn.session);
    } catch (error) {
      turn.writeError = this.recordWriteFailure(error);
      turn.abort.abort();
    }
    this.publish();
  }

  private sanitizer(): AgentSanitizer { return new AgentSanitizer(this.#key ? [this.#key] : []); }
  private safeText(text: string): string { return this.sanitizer().text(text); }
  private agentError(error: unknown): string {
    return this.safeText(error instanceof ControllerNotice ? error.message : error instanceof AgentError ? safeAgentError(error.code).message
      : error instanceof WorkspaceError ? new WorkspaceError(error.code).message : safeError(error));
  }
  private patchAgent(patch: Partial<AgentState>): void {
    if (this.#state.agent) this.#state.agent = { ...this.#state.agent, ...patch };
  }
  #mcp?: McpManager;
  mcp(): McpManager { return this.#mcp ??= new McpManager(this.#agentOptions?.dataDirectory ?? getDataDirectory()); }
  mcpCommand(text: string): Promise<void> {
    this.assertIdle();
    const task=Promise.resolve().then(()=>this.runMcpCommand(text)).finally(async()=>{this.retireAgentService();await this.#cleanup;this.#operation=null;this.publish();});
    this.#operation=task;this.publish();return task;
  }
  private async runMcpCommand(text: string): Promise<void> {
    const [command,id,...rest]=text.trim().split(/\s+/), project=this.#state.project, manager=this.mcp();
    if(command==='add') {
      let value:unknown;try{value=JSON.parse(text.slice(4));}catch{throw new Error('invalid mcp configuration json');}
      manager.config.add(serverConfig(value));
    }
    else if(command==='trust') manager.config.trust(project,id!,rest[0]!);
    else if(command==='connect') {
      const base=this.service().registry.definitions().filter(d=>(!d.function.name.startsWith('mcp_')||['mcp_connect','mcp_list_tools','mcp_call'].includes(d.function.name)));
      await manager.connect(project,id!);
      try { manager.select(project,id!,manager.status(project).find(r=>r.config.id===id)!.selected,base); }
      catch(error){await manager.disconnect(id!);throw error;}
    }
    else if(command==='disable') await manager.disconnect(id!);
    else if(command==='remove') await manager.remove(id!,project);
    else if(command==='pair') await manager.pair(id!,project);
    else if(command==='token') await manager.token(id!,rest[0]!,project);
    else if(command==='select') { const base=this.service().registry.definitions().filter(d=>(!d.function.name.startsWith('mcp_')||['mcp_connect','mcp_list_tools','mcp_call'].includes(d.function.name))); manager.select(project,id!,rest[0]==='none'?[]:(rest[0]??'').split(','),base); }
    else if(command!=='refresh') throw new Error('unknown mcp command');
  }
  private service(): ControllerAgentService {
    if (!this.#agentOptions || !this.#journal) throw new AgentError("invalid_input");
    const options = this.#agentOptions.dataDirectory ? { ...this.#agentOptions,
      artifactDir: defaultArtifactDirectory(this.#agentOptions.dataDirectory, this.#state.project) } : this.#agentOptions;
    return this.#agentService ??= new ControllerAgentService({...options,browser:this.browser(),mcpManager:this.mcp(),mcpTools:this.#mcp?.tools(this.#state.project)}, this.#state.project, this.#journal, this.#key ? [this.#key] : []);
  }
  private retireAgentService(): void {
    const service = this.#agentService;
    this.#agentService = undefined;
    if (service) this.#cleanup = Promise.all([this.#cleanup, service.dispose()]).then(() => {});
  }
  private assertSessionAvailable(): void {
    if (this.#state.session) this.recoverInactiveSession(this.#state.session.id);
    if (this.#journal && this.#state.session && liveRun(this.#journal, this.#state.session.id)) throw new AgentError("lease_conflict");
  }
  private recoverInactiveSession(sessionId: string): void {
    if (!this.#journal || !this.#agentOptions) return;
    const session = this.#store.loadSession(sessionId);
    if (!session || session.project !== this.#state.project) return;
    for (const run of this.#journal.listRuns(sessionId)) {
      if ((!run.ownerId && ["completed", "failed", "interrupted"].includes(run.status))
        || (run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now())) continue;
      if (this.service().recoverInactive(run.id)) this.#state.notice = "recovered an inactive task. history and completed tools were preserved.";
    }
  }
  private currentAgentRun(): Run | undefined {
    if (!this.#journal || !this.#state.session) return;
    const run = latestRun(this.#journal, this.#state.session.id);
    const associatedIndex = this.#state.session.messages.findIndex((message) => message.id === run?.id);
    const userIndex = this.#state.session.messages.findLastIndex((message) => message.role === "user");
    if (associatedIndex >= 0) return associatedIndex > userIndex ? run : undefined;
    const lastUser = this.#state.session.messages.findLast((message) => message.role === "user");
    // A later ordinary-chat turn must never resume an earlier agent run.
    return run && (!lastUser || run.createdAt >= lastUser.createdAt) ? run : undefined;
  }
  private restoreAgentState(): void {
    if (!this.#state.agent || !this.#journal) return;
    this.retireAgentService();
    const run = this.currentAgentRun();
    let context = readContextUsage(this.#state.session?.messages.at(-1)?.context);
    if (context?.model && context.model !== this.#state.session?.model) context = undefined;
    this.patchAgent({ phase: run?.status ?? "idle", runId: run?.id ?? null, events: [], approval: null, tasks: [], jobs: [],
      failureCode: run?.status === "failed" ? this.#journal.listRequestAttempts(run.id).at(-1)?.error : undefined,
      context,
      tools: run ? this.#journal.listToolExecutions(run.id).slice(-64).map((tool) => toolProjection(tool, (text) => this.safeText(text))) : [],
      attachments: this.#attachments.map(({ path, hash, content }) => ({ path, hash, content })) });
    if (run) this.restoreWorkProjection(run.id);
  }

  private restoreWorkProjection(runId: string): void {
    const tools = this.#journal!.listToolExecutions(runId);
    const update = tools.findLast((tool) => tool.name === "update_tasks" && tool.status === "succeeded");
    const result = update?.result;
    if (result && typeof result === "object" && !Array.isArray(result) && Array.isArray(result.tasks)) {
      this.patchAgent({ tasks: result.tasks.flatMap((task) => task && typeof task === "object" && !Array.isArray(task)
        && typeof task.id === "string" && typeof task.title === "string" && typeof task.status === "string"
        ? [{ id: task.id, title: this.safeText(task.title), status: task.status }] : []).slice(0, 64) });
    }
    if (tools.some((tool) => tool.name === "delegate_tasks")) {
      const events = this.service().delegatedRequests(runId).slice(-6).map(({ usage: _usage, ...agent }) => ({
        ...agent, type: "subagent" as const, text: boundedText(agent.text, 32 * 1024),
        ...(agent.evidence ? { evidence: agent.evidence.map(({ result: _result, ...item }) => ({ ...item, args: { preview: boundedText(JSON.stringify(item.args), 512) } })) } : {}),
        status: agent.status === "running" ? "interrupted" as const : agent.status,
      }));
      this.patchAgent({ events: [...(this.#state.agent?.events ?? []).filter((event) => event.type !== "subagent"), ...events].slice(-64) });
    }
  }

  setAgentMode(mode: AgentMode): void {
    this.mutate(() => {
      if (!this.#agentOptions || !["chat", "plan", "review", "trusted", "auto", "bypass"].includes(mode)) throw new AgentError("invalid_input");
      this.assertSessionAvailable();
      this.patchAgent({ mode, enabled: mode !== "chat", approval: null });
    });
  }

  resolveApproval(toolId: string, allow: boolean): void {
    if (this.#approval?.toolId === toolId && typeof allow === "boolean") this.#approval.settle(allow);
  }

  private approval(request: FileApprovalRequest, signal: AbortSignal): Promise<"allow" | "deny"> {
    if (signal.aborted) return Promise.resolve("deny");
    this.sanitizer().exact(request.args, 64 * 1024);
    return new Promise((resolve) => {
      const abort = () => settle(false);
      const settle = (allow: boolean) => {
        signal.removeEventListener("abort", abort);
        if (this.#approval?.toolId !== request.toolId) return;
        this.#approval = undefined;
        this.patchAgent({ approval: null });
        this.publish();
        resolve(allow && !signal.aborted ? "allow" : "deny");
      };
      this.#approval = { toolId: request.toolId, settle };
      const diff = request.preview ? this.safeText(request.preview.diff) : null;
      const preview = diff === null ? null : Buffer.byteLength(diff) > 64 * 1024
        ? `${boundedText(diff, 64 * 1024 - 100)}\n[preview truncated; this approval covers the complete prepared change]` : diff;
      this.patchAgent({ phase: "awaiting_approval", approval: { toolId: request.toolId, name: request.binding.name,
        args: structuredClone(request.args), scope: request.approvalScope,
        preview } });
      signal.addEventListener("abort", abort, { once: true });
      this.publish();
      if (signal.aborted) settle(false);
    });
  }

  attachFile(path: string, startLine?: number, limit?: number): void {
    this.mutate(() => {
      const file = this.service().workspace.read(path, { startLine, limit, maxBytes: 16 * 1024 });
      const files = [...this.#attachments.filter((item) => item.path !== file.path), file];
      if (files.length > 16 || files.reduce((size, item) => size + Buffer.byteLength(item.content), 0) > 64 * 1024) throw new AgentError("context_limit");
      this.#attachments = files;
      this.patchAgent({ attachments: files.map(({ path, hash, content }) => ({ path, hash, content })) });
    });
  }

  clearAttachments(): void {
    this.mutate(() => { this.#attachments = []; this.patchAgent({ attachments: [] }); });
  }

  private instructionTrust(): InstructionTrust[] { return this.#instructionTrust.get(this.#state.project) ?? []; }

  getInstructionSources(): { path: string; hash: string; scope: string; decision: "include" | "ignore" | "pending"; explicit: boolean }[] {
    if (this.#closed || this.#closing || !this.#agentOptions) return [];
    const sources = this.service().instructionSources(this.#attachments, this.instructionTrust());
    const trust = [...this.instructionTrust()];
    for (const source of sources) if (source.decision === "include" && !trust.some((item) => item.path === source.path)) {
      trust.push({ path: source.path, hash: source.hash, decision: "include", implicit: true });
    }
    this.#instructionTrust.set(this.#state.project, trust);
    return sources.map(({ content, ...source }) => source);
  }

  readInstructionSource(path: string, hash: string): string {
    try {
      if (this.#closed || this.#closing) throw new CoreError("closed");
      const source = this.service().instructionSources(this.#attachments, this.instructionTrust()).find((item) => item.path === path && item.hash === hash);
      if (!source) throw new ControllerNotice("instruction source changed. refresh its hash before review.");
      return this.safeText(source.content);
    } catch (error) { return this.agentError(error); }
  }

  setInstructionTrust(path: string, hash: string, decision: "include" | "ignore"): void {
    this.mutate(() => {
      if (!["include", "ignore"].includes(decision) || !this.getInstructionSources().some((source) => source.path === path && source.hash === hash)) {
        throw new ControllerNotice("instruction source changed. review the current hash before choosing include or ignore.");
      }
      this.#instructionTrust.set(this.#state.project, [...this.instructionTrust().filter((source) => source.path !== path), { path, hash, decision }]);
      this.#state.notice = "instruction choice saved for this project and source hash; applies to new tasks. continuation retains its original context.";
    });
  }

  private priorAgentContext(session: Session, fallback: WireMessage[]): WireMessage[] {
    const run = this.#journal!.listRuns(session.id).findLast((item) => ["completed", "interrupted", "failed"].includes(item.status) && session.messages.some((message) => message.id === item.id));
    if (!run || session.messages.find(message=>message.id===run.id)?.profile?.id==="private-profile") return fallback;
    const attempt = this.#journal!.listRequestAttempts(run.id).at(-1);
    if (!Array.isArray(attempt?.context)) return fallback;
    const index = session.messages.findIndex((message) => message.id === run.id);
    const nextUser = session.messages.findIndex((message, i) => i > index && message.role === "user");
    if (nextUser < 0) return fallback;
    const prior = (structuredClone(attempt.context) as unknown as WireMessage[]).filter((message) => message.role !== "system"
      && !(message.role === "user" && (message.content.startsWith("untrusted project instruction sources (reference data;")
        || message.content.startsWith("attached file snapshots (reference data):"))));
    if (attempt.output?.toolCalls) {
      const tools = this.#journal!.listToolExecutions(run.id);
      const results = attempt.output.toolCalls.map((call) => tools.find((tool) => tool.callId === call.id));
      if (results.some((tool) => !tool || (!['succeeded','failed','denied','cancelled'].includes(tool.status)
        && !(parkedBrowserRun(run)&&tool.status==='outcome_unknown')))) throw new AgentError("recovery_required");
      prior.push({ role: "assistant", content: attempt.output.content, tool_calls: attempt.output.toolCalls });
      results.forEach((tool, index) => prior.push({ role: "tool", tool_call_id: attempt.output!.toolCalls![index].id,
        content: JSON.stringify(tool!.status==='outcome_unknown'?{ok:false,status:'outcome_unknown',originalOutputUnavailable:true,message:browserUncertaintyNotice}:tool!.result ?? { ok: false, status: tool!.status }) }));
    } else if (attempt.output?.content) prior.push({ role: "assistant", content: attempt.output.content });
    const next = [...fallback.filter((message) => message.role === "system"), ...prior,
      ...buildContext(session.messages.slice(nextUser).filter((message) => message.status !== "streaming"), null, false)];
    if (Buffer.byteLength(JSON.stringify(next)) > MAX_ORIGINAL_CONTEXT_BYTES) throw new ControllerNotice("original context exceeds the retention limit. open a new session for the next task.");
    return next;
  }

  /** UTF-16 character offsets; id is a durable request id or tool id in the current session. */
  readAgentOutput(id: string, offset = 0, limit = 8192): { content: string; offset: number; nextOffset: number | null; total: number; truncated: boolean } {
    if (this.#closed || this.#closing || !this.#journal || !this.#state.session || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 16384) throw new Error("invalid output page.");
    const request = this.#journal.loadRequestAttempt(id), tool = request ? null : this.#journal.loadToolExecution(id);
    const run = this.#journal.loadRun(request?.runId ?? tool?.runId ?? "");
    if (!run || run.sessionId !== this.#state.session.id) throw new Error("output not found in the current session.");
    const text = this.safeText(request ? request.output?.content ?? "" : JSON.stringify(tool?.name === "delegate_tasks"
      ? { result: tool.result ?? null, requests: this.service().delegatedOutput(tool.id) } : tool?.result ?? null, null, 2));
    const end = Math.min(text.length, offset + limit);
    return { content: text.slice(offset, end), offset, nextOffset: end < text.length ? end : null, total: text.length, truncated: offset > 0 || end < text.length };
  }

  getAgentOutputEntries(): { id: string; label: string }[] {
    if (this.#closed || this.#closing || !this.#journal || !this.#state.session) return [];
    return this.#journal.listRuns(this.#state.session.id).flatMap((run) => [
      ...this.#journal!.listRequestAttempts(run.id).map((request) => ({ id: request.id, label: `request ${request.sequence + 1} · ${request.status}` })),
      ...this.#journal!.listToolExecutions(run.id).map((tool) => ({ id: tool.id, label: `${tool.name} · ${tool.status}` })),
    ]).slice(-256);
  }

  getToolCapability(model:string):string {
    const metadata=this.#state.models.find(item=>item.id===model)?.capabilities;
    return metadata?metadata.tools?"declared by api":"unsupported by api":"not verified";
  }
  async getAccount(signal?:AbortSignal) {
    const gateway=this.#gateway;
    if(!gateway?.account)throw new ApiError('unavailable');
    const account=await gateway.account(signal);
    if(this.#gateway!==gateway||this.#closed)throw new ApiError('aborted');
    return account;
  }
  getDiagnostics(systemClipboard:boolean) {
    const lastTool=this.#state.agent?.tools.at(-1);
    return {application:"edgey",version:CLI_VERSION,platform:process.platform,arch:process.arch,runtime:Bun.version,
      executable:process.execPath,launcher:{version:/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(process.env.EDGEY_LAUNCHER_VERSION??'')?process.env.EDGEY_LAUNCHER_VERSION:'legacy or direct',channel:process.env.EDGEY_RELEASE_CHANNEL==='pilot'?'pilot':'stable',update:['offline','checked','updated','failed','cancelled'].includes(process.env.EDGEY_UPDATE_STATUS??'')?process.env.EDGEY_UPDATE_STATUS:'not reported'},
      lastRequest:this.#gateway?.diagnostics?.()??null,
      terminal:{kind:process.env.WT_SESSION?"windows terminal":process.env.TERM_PROGRAM==="vscode"?"vscode":"terminal host",tty:!!process.stdout.isTTY},
      clipboard:{system:systemClipboard?"available; not accessed":"unavailable",terminal:"osc52 fallback; confirmation unavailable"},
      git:{available:!!findGit()},shell:{name:process.platform==="win32"?"powershell":"sh",available:!!Bun.which(process.platform==="win32"?"powershell.exe":"sh")},
      connection:this.#state.connection,credentialMode:this.#state.credentialMode,
      session:{messages:this.#state.session?.messages.length??0},agent:{phase:this.#state.agent?.phase??"disabled",tools:this.#state.agent?.tools.length??0,
        failureCode:this.#state.agent?.failureCode??null,
        lastTool:lastTool?{name:lastTool.name,status:lastTool.status,error:lastTool.error??null}:null,
        storage:this.#state.agent?.events.findLast(event=>event.type==="finished")?.error?.storage??null},
      lastApiError:this.#state.error?apiErrorHint(this.#state.error)??(this.#gateway?.diagnostics?.()?.status===200?"no classified api error":apiDiagnosticHint(this.#gateway?.diagnostics?.())||"no classified api error"):"none",credentials:"not accessed",provider:"not probed",content:"excluded"};
  }
  exportDiagnostics(destination:string,report:ReturnType<ChatController["getDiagnostics"]>) {
    writeFileSync(destination,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  }
  getTranscriptPage(offset?:number,filter:TranscriptFilter="all",anchor?:string) {
    try { return transcriptPage(this.#state.session??undefined,this.#closed||this.#closing?undefined:this.#journal,
      text=>this.safeText(text),offset,filter,24,anchor); }
    catch(error){return {entries:[{id:"transcript-error",kind:"validation" as const,title:"transcript unavailable",content:this.agentError(error)}],total:1,start:0,end:1,pageSize:24};}
  }

  getAttachmentCandidates(query: string): { path: string }[] {
    if (this.#closed || this.#closing || !this.#agentOptions || typeof query !== "string" || query.length > 512
      || /[\u0000-\u001f]|(^|[\\/])\.\.([\\/]|$)|^[\\/]|:/.test(query)) return [];
    const needle = query.replace(/\\/g, "/").toLowerCase();
    try {
      return this.service().workspace.glob({ pattern: "**", limit: 500 }).paths
        .filter((path) => path.toLowerCase().includes(needle)).slice(0, 100).map((path) => ({ path }));
    } catch { return []; }
  }

  async stopAgentJob(jobId: string): Promise<void> {
    try {
      if (this.#closed || this.#closing || !this.#state.agent?.enabled || !this.#agentService || !this.#state.agent.runId) {
        throw new AgentError("permission_denied");
      }
      const runId = this.#state.agent.runId;
      const service = this.#agentService;
      await service.stopJob(jobId, runId);
      if (this.#state.agent?.runId === runId) this.patchAgent({ jobs: service.jobs(runId) });
      this.publish();
    } catch (error) { this.fail(error); }
  }

  getAgentJobDetail(jobId: string) {
    if (this.#closed || this.#closing || !this.#state.agent?.runId) throw new AgentError("invalid_input");
    return this.service().jobDetail(jobId, this.#state.agent.runId);
  }

  readAgentJobOutput(jobId: string, stream: "stdout" | "stderr", offset = 0, limit = 8192) {
    if (this.#closed || this.#closing || !this.#state.agent?.runId) throw new AgentError("invalid_input");
    return this.service().jobOutput(jobId, this.#state.agent.runId, stream, offset, limit);
  }

  async sendAgentJobInput(jobId: string, text: string, eof = false): Promise<void> {
    if (this.#closed || this.#closing || !this.#turn || !this.#state.agent?.runId || !this.#agentService
      || this.#state.agent.approval) throw new AgentError("permission_denied");
    this.sanitizer().exact(text, 32768);
    await this.#agentService.jobInput(jobId, this.#state.agent.runId, text, eof, this.#turn.abort.signal);
  }

  continueAgent(): Promise<void> { return this.resumeAgent(false); }

  recoverAgent(confirm: boolean, resolutions?: AgentResolutions): Promise<void> {
    if (!confirm) { this.#state.notice = "recovery cancelled. no execution resumed."; this.publish(); return Promise.resolve(); }
    try {
      this.assertIdle(); this.assertSessionAvailable();
      const run = this.currentAgentRun();
      if (!run) throw new AgentError("invalid_input");
      this.service().resolveRecovery(run.id, resolutions);
      this.#state.error = null;
      this.#state.notice = "local recovery complete. no model request sent. send a new task; /retry is available only for a compatible registry.";
      this.restoreAgentState(); this.publish();
    } catch (error) { this.fail(error); }
    return Promise.resolve();
  }

  getAgentRecoveryDetails(): string {
    try {
      if (this.#closed || this.#closing) throw new CoreError("closed");
      const run = this.currentAgentRun();
      if (!run) return "no agent run to recover.";
      const lock = this.service().inspectRecovery(run.id);
      const unknown = this.#journal!.listToolExecutions(run.id).filter((tool) => ["executing", "outcome_unknown"].includes(tool.status));
      return boundedText(this.safeText(`run ${run.id} · ${run.status}\nmodel: ${run.model}\nlease: ${run.leaseExpiresAt ?? "none"}\nworkspace owner: ${lock ? `pid ${lock.pid}; run ${lock.runId}` : "none"}\nconfirm only after the previous executor AND all descendants have stopped. an expired lease is not proof of cleanup. live workspace pids cannot be recovered.\nunknown outcomes (provide explicit observed results; operations are never replayed):\n${unknown.map((tool) => `${tool.id} · call ${tool.callId} · ${tool.name} · ${tool.status}\n${JSON.stringify(tool.args)}`).join("\n") || "none"}`), 64 * 1024);
    } catch (error) { return this.agentError(error); }
  }

  getAgentRecoverySummary(){
    if(this.#closed||this.#closing)throw new CoreError("closed");
    const run=this.currentAgentRun();if(!run)return null;
    const lock=this.service().inspectRecovery(run.id);
    const tools=this.#journal!.listToolExecutions(run.id).filter(tool=>["executing","outcome_unknown"].includes(tool.status));
    let blocked:string|null=null;
    if(lock){
      try{process.kill(lock.pid,0);blocked="close the previous CLI window, then reopen this conversation to resume. you can also start a new conversation below.";}
      catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")blocked="the previous task may still be running. close its CLI window and try again.";}
    }
    if(!blocked&&run.leaseExpiresAt&&Date.parse(run.leaseExpiresAt)>Date.now())blocked="the previous task has not released this conversation yet. wait briefly, then try again.";
    return {runId:run.id,status:run.status,blocked,canContinueWithPrompt:onlyUnknownBrowserActions(this.#journal!.listToolExecutions(run.id)),
      fingerprint:createHash("sha256").update(JSON.stringify([run.id,run.revision,lock?.token,tools.map(tool=>[tool.id,tool.revision])])).digest("hex"),
      tools:tools.map(tool=>({id:tool.id,name:tool.name,target:this.safeText(String(tool.args.url??tool.args.path??tool.args.command??"" )).slice(0,300)}))};
  }

  async recoverObservedAndContinue(runId:string,fingerprint:string,observations:readonly {toolId:string;status:"succeeded"|"failed"}[]):Promise<void>{
    try{
      this.assertIdle();this.assertSessionAvailable();
      const current=this.getAgentRecoverySummary();
      if(!current||current.runId!==runId||current.fingerprint!==fingerprint)throw new ControllerNotice("the task changed. reopen recovery and check it again.");
      if(current.blocked)throw new ControllerNotice(current.blocked);
      if(observations.length!==current.tools.length||new Set(observations.map(item=>item.toolId)).size!==observations.length
        ||observations.some(item=>!current.tools.some(tool=>tool.id===item.toolId)||!["succeeded","failed"].includes(item.status)))throw new ControllerNotice("check each uncertain action before resuming.");
      const resolutions=observations.map(item=>({toolId:item.toolId,status:item.status,result:{ok:item.status==="succeeded",recovered:true,observedByUser:true,originalOutputUnavailable:true,
        observation:item.status==="succeeded"?"the user checked the effect and confirmed the action completed":"the user checked the effect and confirmed the action did not complete",
        guidance:"this is a user observation, not the original tool output. do not repeat a confirmed completed action. inspect current state with a read-only tool before taking further action."}}));
      await this.recoverAgent(true,resolutions);
      if(this.#state.error)return;
      await this.continueAgent();
    }catch(error){this.fail(error);}
  }

  private resumeAgent(recovery: boolean, resolutions?: AgentResolutions): Promise<void> {
    try {
      this.assertIdle();
      this.assertSessionAvailable();
      if (!recovery && this.#state.agent?.context?.full) throw new AgentError("model_context_exceeded");
      if (!this.#gateway) throw new CoreError("disconnected");
      const run = this.currentAgentRun(), previous = this.#state.session?.messages.at(-1);
      if (!this.#state.agent?.enabled || !run || !previous || previous.role !== "assistant" ||
        !["interrupted", "error", "streaming"].includes(previous.status)) throw new CoreError("retry");
      if (!this.#state.models.some((model) => model.id === canonicalModel(run.model)) || this.#state.session!.model !== canonicalModel(run.model)) {
        throw new ControllerNotice(`select original model ${run.model} from the available catalog before continuing this run.`);
      }
      const metadata = run.metadata as JsonObject | undefined;
      const effective = this.effectiveProfile(run.model);
      if (previous.profile?.id === "private-profile" || (!!metadata?.privateMode !== !!this.#state.session?.privateMode && !!privateModeId(run.model))) throw new ControllerNotice("restore the original profile and jailbreak mode before continuing.");
      if (typeof metadata?.subagentModel === "string" && !this.#state.models.some((model) => model.id === canonicalModel(metadata.subagentModel as string))) {
        throw new ControllerNotice("the original subagent model is absent from the current key's catalog. start a new task with an available model.");
      }
      const preflight = this.service().preflight(this.#gateway, run.id);
      if (!preflight.canContinue && !(recovery && preflight.error?.code === "recovery_required")) throw new AgentError(preflight.error?.code ?? "recovery_required");
      if (recovery) {
        const unknown = this.#journal!.listToolExecutions(run.id).filter((tool) => ["executing", "outcome_unknown"].includes(tool.status));
        if (unknown.length !== (resolutions?.length ?? 0) || new Set(resolutions?.map((item) => item.toolId)).size !== unknown.length
          || (resolutions ?? []).some((item) => !unknown.some((tool) => tool.id === item.toolId) || !["succeeded", "failed"].includes(item.status))) {
          throw new ControllerNotice("provide an explicit observed result for every unknown tool outcome before recovery.");
        }
        this.sanitizer().exact(resolutions ?? [], 1024 * 1024);
        // Check/reclaim the exact workspace lock before changing any transcript placeholder.
        this.service().confirmRecovery(run.id);
      }
      if (preflight.completed) {
        const output = this.#journal!.listRequestAttempts(run.id).at(-1)!.output!;
        const session = structuredClone(this.#state.session!);
        Object.assign(session.messages.at(-1)!, { content: this.safeText(output.content ?? ""), status: "complete" });
        this.#store.saveSession(session); this.#state.session = session; this.summarize(session); this.publish();
        return Promise.resolve();
      }
      const session = structuredClone(this.#state.session!);
      const assistant: Message = { id: randomUUID(), role: "assistant", content: "", status: "streaming",
        createdAt: new Date().toISOString(), model: run.model, ...(previous.profile ? { profile: { ...previous.profile } } : {}) };
      session.messages.push(assistant);
      this.#state.error = null;
      this.#state.notice = "continuing the original durable context and profile; current attachments and instruction selections apply only to new tasks.";
      const turn: Turn = { session, assistant, abort: new AbortController(), done: Promise.resolve(), dirty: false, writeError: null };
      this.#turn = turn;
      this.#state.busy = true;
      const gateway = withPrivateMode(this.#gateway, metadata?.privateMode ? readPrivateMode(metadata.privateMode) : undefined, applied=>{if(assistant.model && privateModeId(assistant.model))assistant.privateMode={...applied};if(session.privateMode?.id===applied.id&&session.privateMode.revision===applied.revision)session.privateMode={...applied};});
      turn.done = Promise.resolve().then(() => this.runAgentTurn(turn, gateway, [], run.id, recovery, resolutions));
      this.publish();
      return turn.done;
    } catch (error) { this.fail(error); return Promise.resolve(); }
  }

  private async runAgentTurn(turn: Turn, gateway: Gateway, messages: WireMessage[], continueRunId?: string, recovery?: boolean, resolutions?: AgentResolutions): Promise<void> {
    let service: ControllerAgentService | undefined;
    // The first assistant id is also the run id: durable association without changing message storage.
    const runId = continueRunId ?? turn.assistant.id;
    try {
      await this.#cleanup;
      if (turn.abort.signal.aborted) throw new AgentError("aborted");
      service = this.service();
      if (!continueRunId) this.getInstructionSources();
      this.patchAgent({ runId, phase: "preparing_context", failureCode: undefined, events: [], approval: null, tasks: [], jobs: [],
        tools: continueRunId ? this.#journal!.listToolExecutions(runId).slice(-64).map((tool) => toolProjection(tool, (text) => this.safeText(text))) : [] });
      if (continueRunId) this.restoreWorkProjection(runId);
      const metadata = continueRunId ? this.#journal!.loadRun(runId)?.metadata as JsonObject | undefined : undefined;
      const childModel = continueRunId ? (typeof metadata?.subagentModel === "string" ? metadata.subagentModel : undefined) : this.getSubagentModel();
      if (childModel && !this.#state.models.some((model) => model.id === childModel)) throw new CoreError("model");
      const childProfile = childModel ? this.effectiveProfile(childModel, turn.session) : null;
      const selectedInstructions=continueRunId ? (this.#journal!.listRequestAttempts(continueRunId)[0]?.context as unknown as WireMessage[] | undefined)?.filter(m=>m.role==="system" && typeof m.content==="string" && /^selected (markdown|skill):/.test(m.content)).map(m=>m.content).join("\n\n") ?? "" : composeInstructions(turn.session.instructionSources??[]);
      const context = continueRunId ? [] : service.context(this.priorAgentContext(turn.session, messages).map((message) => ({ ...message,
        content: message.content === null ? null : this.safeText(message.content) })) as WireMessage[], this.#attachments, this.instructionTrust(), childModel);
      const result = await service.run({ gateway, runId, sessionId: turn.session.id, model: turn.session.model, messages: context,
        askUser: (question, signal) => this.askAgentQuestion(question, signal),
        reasoningEffort: this.getReasoningEffort(), subagentModel: childModel, subagentInstructions: [childProfile?.instructions,selectedInstructions].filter(Boolean).join("\n\n"),
        privateMode:turn.session.privateMode,
        mode: this.#state.agent!.mode as Exclude<AgentMode, "chat">, signal: turn.abort.signal, continueRunId, recovery, resolutions,
        retryRejectedBatch: !!continueRunId && !recovery,
        onOwned: () => {
          try { this.#store.saveSession(turn.session); }
          catch (error) { turn.writeError = this.recordWriteFailure(error); turn.abort.abort(); throw error; }
          turn.persisted = true;
          this.#state.session = turn.session;
          this.summarize(turn.session);
          this.publish();
        },
        beforeEffect: () => {
          if (!turn.persisted || this.#store.loadSession(turn.session.id)?.revision !== turn.session.revision) {
            turn.writeError = this.recordWriteFailure(new StorageError("session_conflict"));
            turn.abort.abort();
            throw new AgentError("lease_conflict");
          }
        },
        onJobsChanged: () => {
          if (this.#turn === turn) { this.patchAgent({ jobs: service!.jobs(runId) }); this.publish(); }
        },
        onSettling: () => {
          if (!turn.persisted || turn.writeError) return;
          const last = this.#journal!.listRequestAttempts(runId).at(-1);
          turn.assistant.content = this.safeText(last?.output?.content ?? turn.assistant.content);
          turn.assistant.status = last?.status === "completed" && !last.output?.toolCalls ? "complete" : "interrupted";
          // Persist a non-streaming transcript before either ownership fence is released.
          try { this.#store.saveSession(turn.session); }
          catch (error) { turn.writeError = this.recordWriteFailure(error); throw error; }
        },
        approval: (request, signal) => this.approval(request, signal), onEvent: (event) => {
          if (this.#turn !== turn || event.runId !== runId) return;
          const agent = this.#state.agent!;
          // Replace successive output snapshots rather than retaining copies of the same stream.
          const events = event.type === "output" ? agent.events.filter((item) => item.type !== "output" || item.requestId !== event.requestId)
            : event.type === "subagent" ? agent.events.filter((item) => item.type !== "subagent" || item.id !== event.id)
            : event.type === "tool_draft" ? agent.events.filter((item) => item.type !== "tool_draft" || item.requestId !== event.requestId || item.index !== event.index)
            : event.type === "phase" && event.phase !== "requesting_model" ? agent.events.filter((item) => item.type !== "tool_draft") : agent.events;
          const combined = [...events, event];
          // child snapshots remain inspectable while later tools and requests advance.
          const children = combined.filter((item) => item.type === "subagent").slice(-6);
          this.patchAgent({ events: [...combined.filter((item) => item.type !== "subagent").slice(-(64 - children.length)), ...children] });
          if (event.type === "phase") this.patchAgent({ phase: event.phase });
          if (event.type === "context_budget") {
            turn.assistant.context = readContextUsage(event);
            turn.dirty = true;
            this.patchAgent({ context: turn.assistant.context });
          }
          if (event.type === "finished" && event.status === "completed") {
            const repairs = this.#journal!.listRequestAttempts(runId).filter(attempt => attempt.output?.validation).length;
            if (repairs) this.#state.notice = `tool arguments corrected · ${repairs} rejected ${repairs === 1 ? "batch" : "batches"} · details in /tools`;
          }
          if (event.type === "output") {
            turn.assistant.content = event.replace ? event.text : boundedText(turn.assistant.content + event.text, 8192);
            turn.dirty = true;
            if (!turn.timer) turn.timer = setTimeout(() => this.checkpoint(turn), this.#checkpointMs);
          }
          if (event.type === "tool") {
            const tool = this.#journal!.loadToolExecution(event.toolId);
            if (tool) this.patchAgent({ tools: [...this.#state.agent!.tools.filter((item) => item.id !== tool.id),
              toolProjection(tool, (text) => this.safeText(text))].slice(-64) });
            if (tool?.name === "update_tasks" && tool.status === "succeeded" && tool.result && typeof tool.result === "object" && !Array.isArray(tool.result)) {
              const tasks = tool.result.tasks;
              if (Array.isArray(tasks)) this.patchAgent({ tasks: tasks.map((item) => {
                const task = item as JsonObject;
                return { id: String(task.id), title: String(task.title), status: String(task.status) };
              }).slice(0, 64) });
            }
            if (tool && ["run_process", "run_shell", "job_status", "job_stop"].includes(tool.name) && ["succeeded", "failed"].includes(tool.status)) {
              this.patchAgent({ jobs: service!.jobs(runId) });
            }
          }
          this.publish();
        } });
      if (result.status === "completed") turn.assistant.content = this.safeText(result.finalText);
      else {
        const output = this.#journal!.listRequestAttempts(runId).at(-1)?.output?.content;
        if (typeof output === "string") turn.assistant.content = this.safeText(output);
      }
      turn.assistant.status = result.status === "completed" ? "complete" : result.status === "failed" ? "error" : "interrupted";
      this.patchAgent({ phase: result.status, failureCode: result.error?.code, approval: null, jobs: service.jobs(runId) });
      if (result.error && !turn.abort.signal.aborted) {
        const hint=result.error.code.startsWith('model_')||result.error.code==='timeout'
          ? apiDiagnosticHint(this.#gateway?.diagnostics?.()) : '';
        const storage = result.error.storage;
        const storageHint = storage ? `\nstorage: ${storage.code}${storage.nativeCode ? ` / ${storage.nativeCode}` : ''} · ${storage.stage}` : '';
        this.#state.error = this.safeText(result.error.message+storageHint+(hint?'\n'+hint:''));
        if(result.status==='recovery_required'&&!this.#journal!.loadRun(runId)?.ownerId&&onlyUnknownBrowserActions(this.#journal!.listToolExecutions(runId)))
          this.#state.error='browser action outcome is uncertain. send a new prompt in this chat to continue with the saved context. the old action will not be replayed; further effects require approval.';
      }
    } catch (error) {
      turn.assistant.status = turn.abort.signal.aborted ? "interrupted" : "error";
      if (!turn.abort.signal.aborted && error instanceof AgentError && contextLimit(error.code)) {
        this.patchAgent({ context: { ...(this.#state.agent?.context ?? { usedBytes: 0,
          maxBytes: this.#agentOptions?.contextBudgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES, method: "unverified_byte_cap" }), full: true, exhaustedBy: "provider" } });
        turn.assistant.context = this.#state.agent?.context;
      }
      this.patchAgent({ phase: turn.assistant.status === "interrupted" ? "interrupted" : "failed", failureCode: error instanceof AgentError ? error.code : undefined, approval: null });
      if (!turn.abort.signal.aborted) this.#state.error = this.agentError(error);
    } finally {
      if (turn.timer) clearTimeout(turn.timer);
      this.#approval?.settle(false);
      if (service) await service.dispose();
      if (this.#agentService === service) this.#agentService = undefined;
      if (turn.assistant.status === "interrupted" && !turn.writeError) this.#state.notice = onlyUnknownBrowserActions(this.#journal!.listToolExecutions(runId))
        ? 'send a new prompt in this chat to continue. the uncertain browser action stays recorded.'
        : "stopped. send a new prompt, or /retry to continue the previous task.";
      if (this.#state.error) turn.assistant.failure = this.safeText(this.#state.error).slice(0,8192);
      if (turn.persisted && !turn.writeError) {
        try { this.#store.saveSession(turn.session); this.summarize(turn.session); }
        catch (error) { turn.writeError = this.recordWriteFailure(error); }
      }
      if (!turn.persisted && !this.#state.error) this.#state.notice = "the agent did not acquire ownership; no transcript placeholder was saved.";
      if (turn.writeError) this.#state.error = turn.writeError;
      this.#turn = null;
      this.#state.busy = false;
      this.publish();
    }
  }

  private lastChange(): { changeId: string; digest: string } | undefined {
    if (!this.#journal || !this.#state.session) return;
    for (const run of this.#journal.listRuns(this.#state.session.id).reverse()) {
      for (const tool of this.#journal.listToolExecutions(run.id).reverse()) {
        if (tool.name !== "apply_change" || !["succeeded", "failed"].includes(tool.status) || !tool.result || typeof tool.result !== "object" || Array.isArray(tool.result)) continue;
        if (tool.result.status !== "applied" && tool.result.status !== "partial") continue;
        if (typeof tool.args.changeId === "string" && typeof tool.args.digest === "string") return { changeId: tool.args.changeId, digest: tool.args.digest };
      }
    }
  }

  undoLastChange(): Promise<void> {
    try {
      this.assertIdle();
      this.assertSessionAvailable();
      const change = this.lastChange();
      if (!change || !this.#state.agent?.enabled || this.#state.agent.mode === "plan") throw new AgentError("permission_denied");
      const abort = new AbortController();
      this.#manualAbort = abort;
      this.#state.busy = true;
      this.#state.error = null;
      const task = Promise.resolve().then(async () => {
        await this.#cleanup;
        this.#state.notice = await this.service().undo(change, abort.signal, (request, signal) => this.approval(request, signal));
      }).catch((error) => { if (!abort.signal.aborted) this.fail(error); }).finally(() => {
        this.#approval?.settle(false);
        this.#manualAbort = undefined;
        this.retireAgentService();
        this.#operation = null;
        this.#state.busy = false;
        this.patchAgent({ phase: abort.signal.aborted ? "interrupted" : "idle", approval: null });
        this.publish();
      });
      this.#operation = task;
      this.publish();
      return task;
    } catch (error) { this.fail(error); return Promise.resolve(); }
  }

  getTaskDetails(taskId: string): string {
    try {
      const runId = this.#state.agent?.runId;
      if (!runId || !this.#journal) return "no task selected.";
      const tools = this.#journal.listToolExecutions(runId);
      const update = tools.findLast(tool => tool.name === "update_tasks" && tool.status === "succeeded");
      const result = update?.result as JsonObject | undefined;
      const task = (result?.tasks as JsonObject[] | undefined)?.find(task => task.id === taskId);
      if (!task) return "task details unavailable.";
      const evidence = task.evidence as { toolId: string; summary: string }[];
      const children = this.#state.agent!.events.filter(event => event.type === "subagent" && event.taskId === taskId);
      return this.safeText(`step · ${task.title}\nstatus: ${task.status}\nid: ${task.id}\ndependencies: ${(task.dependencies as string[]).join(", ") || "none"}\n\nevidence and linked tools:\n${evidence.map(item => {
        const tool = tools.find(tool => tool.id === item.toolId || tool.callId === item.toolId);
        return `${tool ? `${tool.name} · ${tool.status} · call ${tool.callId}` : item.toolId}\n${item.summary}`;
      }).join("\n\n") || "no completion evidence recorded yet."}\n\nsubagents:\n${children.map(event => event.type === "subagent" ? `${event.title} · ${event.status}\n${event.text}` : "").join("\n\n") || "handled by the main agent."}\n\nuse /tools for run diagnostics and /agents for delegated output.`);
    } catch (error) { return this.agentError(error); }
  }

  getAgentDetails(view: AgentDetailsView): string {
    try {
      if (this.#closed || this.#closing) return "the chat controller is closed.";
      const agent = this.#state.agent;
      if (!agent) return "agent runtime is not configured.";
      let text: string;
      if (view === "permissions") text = `mode: ${agent.mode}\n${agent.approval ? JSON.stringify(agent.approval, null, 2) : "no pending approval. approvals bind to the exact tool arguments and project."}`;
      else if (view === "tasks") text = agent.tasks.length ? agent.tasks.map((task) => `${task.status} · ${task.id} · ${task.title}`).join("\n") : "no tasks recorded.";
      else if (view === "jobs") text = agent.jobs.length ? agent.jobs.map((job) => `${job.id} · ${job.status}${job.command ? ` · ${job.command}` : ""}`).join("\n") : "no jobs recorded.";
      else if (view === "context") text = `project: ${this.#state.project}\nprofile: ${this.#state.profile?.id ?? "none"}\nworkspace instructions: untrusted reference data, never permission authority\n${this.getInstructionSources().map((source) => `${source.path} · scope ${source.scope} · sha256 ${source.hash} · ${source.decision}${source.explicit ? " (explicit)" : " (project default)"}`).join("\n") || "no instruction sources"}\nuse setInstructionTrust(path, hash, include/ignore) after reviewing the source. changed hashes require a new decision.\nattachments:\n${this.#attachments.map((file) => `${file.path} · sha256 ${file.hash} · lines ${file.startLine}-${file.endLine}${file.truncated ? " · truncated" : ""}`).join("\n") || "none"}`;
      else if (view === "undo") text = this.lastChange() ? "undo is available for the last applied file change. invoke undoLastChange(), review the inverse diff, then explicitly approve. unrelated edits cause a conflict." : "no applied file change to undo.";
      else if (view === "diff") {
        const change = this.lastChange();
        text = agent.approval?.preview ?? (change ? this.service().hostFiles.workspaceForChange(change.changeId, change.digest).getChangeReview(change.changeId, change.digest).diff : "no file diff recorded.");
      } else {
        const tools = view === "git" ? agent.tools.filter((tool) => tool.name.startsWith("git_")) : agent.tools;
        text = tools.length ? tools.map((tool) => `${tool.name} · ${tool.status}\n${JSON.stringify(tool.args)}\n${typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result ?? null)}`).join("\n\n")
          : view === "git" ? "no git results recorded. ask the agent to run git_status or git_diff." : "no tools executed.";
      }
      if (view === "tools" && agent.runId && this.#journal) {
        const diagnostics = this.#journal.listRequestAttempts(agent.runId).filter(attempt => attempt.output?.validation);
        if (diagnostics.length) text += "\n\nargument validation (no execution):\n" + diagnostics.map(attempt => {
          const detail = attempt.output!.validation!;
          return `${attempt.id} · ${detail.exhausted ? "correction budget exhausted" : `correction ${detail.repair}/2`}\n${detail.issues.map(issue => `${issue.tool} · call ${issue.callId} · ${issue.path} · ${issue.code}: expected ${issue.expected}; received ${issue.receivedType}`).join("\n")}`;
        }).join("\n\n");
      }
      text = this.safeText(text);
      if (view === "context") {
        const report = agent.events.findLast((event) => event.type === "context_compacted");
        const budget = agent.context;
        if (budget) text += `\ncontext ${contextPercent(budget) === undefined ? "?" : contextPercent(budget) + "%"}: ${budget.inputTokens === undefined ? "awaiting api token usage" : budget.inputTokens + " input tokens in the last reported request"} · ${budget.windowTokens === undefined ? "model window unavailable" : budget.windowTokens + " token window (" + budget.windowSource + ")"}`;
        text += "\npercentage uses api-reported input tokens from one request, including cached tokens, instructions and tool results. it is not cumulative session usage or a live estimate while thinking. output tokens are separate; the next request reports its actual input again. local byte limits only bound storage and compaction.";
        if (budget?.full) text += `\n${NEW_CONTEXT_HINT}`;
        text += `\ncontext budget: ${this.#agentOptions?.contextBudgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES} utf8 json bytes`;
        if (report?.type === "context_compacted") text += `\nlocal summary: ${report.report.beforeBytes} → ${report.report.afterBytes} bytes; ${report.report.removedMessages} messages summarized; originals retained in request history.`;
      }
      return Buffer.byteLength(text) > 64 * 1024 ? `${boundedText(text, 65000)}\n[details truncated; page durable output with readAgentOutput(id, offset, limit)]` : text;
    } catch (error) { return this.agentError(error); }
  }

  async refreshAgentDetails(view: AgentDetailsView): Promise<void> {
    if (this.#closed || this.#closing) return;
    const runId = this.#state.agent?.runId;
    if (!runId || (view !== "tasks" && view !== "jobs")) return;
    try {
      const service = this.service();
      if (view === "jobs") this.patchAgent({ jobs: service.jobs(runId) });
      else {
        const snapshot = await service.tasks.snapshot(runId);
        if (this.#state.agent?.runId !== runId || this.#closed || this.#closing) return;
        this.patchAgent({ tasks: snapshot.tasks.map(({ id, title, status }) => ({ id, title: this.safeText(title), status })) });
      }
      this.publish();
    } catch (error) { this.fail(error); }
  }

  getAgentUsage(): string {
    try {
      if (!this.#journal || !this.#state.session) return "no agent request reports.";
      const runs = this.#journal.listRuns(this.#state.session.id);
      const requests: { id: string; runId: string; status: string; usage?: Usage }[] = runs.flatMap((run) => [
        ...this.#journal!.listRequestAttempts(run.id),
        ...this.service().delegatedRequests(run.id),
      ]);
      const chatReports = this.#state.session.messages.filter((message) => message.role === "assistant" && message.usage);
      const reports = [...requests, ...chatReports];
      let input = 0n, output = 0n, total = 0n;
      for (const report of reports) if (report.usage) { input += BigInt(report.usage.inputTokens); output += BigInt(report.usage.outputTokens); total += BigInt(report.usage.totalTokens); }
      const number = (value: number | bigint) => value.toLocaleString("en-US");
      const lines = requests.slice(-128).map((request) => `${request.id} · ${request.status}${request.status === "completed" ? "" : " · unconfirmed"}\n${request.usage
        ? `input ${number(request.usage.inputTokens)} · output ${number(request.usage.outputTokens)} · total ${number(request.usage.totalTokens)} (${request.usage.totalSource ?? "unknown"})`
        : "usage unavailable"}`);
      const totals = reports.some((report) => report.usage) ? `input ${number(input)} · output ${number(output)} · total ${number(total)}` : "usage unavailable";
      const runId = this.#state.agent?.runId;
      const runRequests = requests.filter((request) => request.runId === runId);
      const summarize = (selected: typeof requests) => {
        const counted = selected.filter((request) => request.usage);
        if (!counted.length) return "usage unavailable";
        const sum = (field: "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens") => counted.reduce((total, request) => total + BigInt(request.usage![field] ?? 0), 0n);
        const cacheReports = counted.filter((request) => request.usage!.cachedInputTokens !== undefined).length;
        return `input ${number(sum("inputTokens"))} · output ${number(sum("outputTokens"))} · total ${number(sum("totalTokens"))}\ninput + output ${number(sum("inputTokens") + sum("outputTokens"))}\ncache ${cacheReports ? `${number(sum("cachedInputTokens"))} (${cacheReports}/${selected.length} reports)` : "unavailable"}\nsource: ${counted.filter((request) => request.usage!.totalSource === "reported").length} reported · ${counted.filter((request) => request.usage!.totalSource === "calculated").length} calculated · ${counted.filter((request) => request.usage!.totalSource === undefined).length} unknown\nunconfirmed ${counted.filter((request) => request.status !== "completed").length}`;
      };
      const last = requests.at(-1);
      return boundedText(this.safeText(`raw request reports: ${requests.length}\nlast request:\n${last ? `${last.id} · ${last.status}\n${summarize([last])}` : "none"}\n\ncurrent run: ${runId ?? "none"} · ${runRequests.length} requests\n${summarize(runRequests)}\n\nsession (including ordinary chat reports):\n${totals}\nmissing agent reports: ${requests.filter((request) => !request.usage).length}\nunconfirmed reports: ${reports.filter((report) => report.usage && !["complete", "completed"].includes(report.status)).length}\nbilling and key balance unavailable.\n\nrequest history:\n${lines.join("\n")}`), 64 * 1024);
    } catch (error) { return this.agentError(error); }
  }

  private async runTurn(turn: Turn, gateway: Gateway, messages: WireMessage[]): Promise<void> {
    let rawText = "";
    try {
      if (!turn.abort.signal.aborted) {
        if (this.#agentOptions) {
          await this.#cleanup;
          messages = this.service().context(messages.map((message) => ({ ...message, content: message.content === null ? null : this.safeText(message.content) })) as WireMessage[], this.#attachments, this.instructionTrust());
        }
        const budget = modelContextBudget(parseModelMetadata(gateway.modelMetadata?.(turn.session.model)), [],
          this.#agentOptions?.contextBudgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES, gateway.contextReservation?.(turn.session.model) ?? 0, gateway.modelContext?.(turn.session.model));
        turn.assistant.context = measuredContext({ usedBytes: Buffer.byteLength(JSON.stringify(messages)), maxBytes: budget.maxBytes, method: budget.method }, gateway, turn.session.model);
        const prepared = compactRequestContext(messages, { maxBytes: budget.maxBytes, tokenBudget: budget.tokenBudget });
        messages = prepared.messages;
        turn.assistant.context.usedBytes = prepared.report.afterBytes;
        this.patchAgent({ context: turn.assistant.context });
        this.publish();
        const result = await gateway.streamChat({
          model: turn.session.model, messages, signal: turn.abort.signal,
          reasoningEffort: this.getReasoningEffort(),
          onDelta: (text) => {
            if (this.#turn !== turn || turn.abort.signal.aborted || !text) return;
            rawText += text;
            turn.assistant.content = this.#agentOptions ? this.sanitizer().partialText(rawText) : rawText;
            turn.dirty = true;
            if (!turn.timer) turn.timer = setTimeout(() => this.checkpoint(turn), this.#checkpointMs);
            this.publish();
          },
          onUsage: (usage) => {
            if (this.#turn !== turn || turn.abort.signal.aborted) return;
            if (isDeepStrictEqual(turn.assistant.usage, usage)) return;
            turn.assistant.usage = structuredClone(usage);
            turn.assistant.context = measuredContext(turn.assistant.context!, gateway, turn.session.model, usage);
            this.patchAgent({ context: turn.assistant.context });
            turn.dirty = true;
            if (!turn.timer) turn.timer = setTimeout(() => this.checkpoint(turn), this.#checkpointMs);
            this.publish();
          },
        });
        if (this.#agentOptions) turn.assistant.content = this.sanitizer().partialText(rawText, true);
        if (!turn.abort.signal.aborted && result.usage) {
          turn.assistant.usage = structuredClone(result.usage);
          turn.assistant.context = measuredContext(turn.assistant.context!, gateway, turn.session.model, result.usage);
          this.patchAgent({ context: turn.assistant.context });
        }
      }
      turn.assistant.status = turn.abort.signal.aborted ? "interrupted" : "complete";
    } catch (error) {
      if (this.#agentOptions) turn.assistant.content = this.sanitizer().partialText(rawText, true);
      turn.assistant.status = turn.abort.signal.aborted || turn.assistant.content ? "interrupted" : "error";
      if (!turn.abort.signal.aborted) {
        const full = error instanceof AgentError && contextLimit(error.code) || error instanceof ApiError && error.code === "context_length_exceeded";
        if (full) {
          turn.assistant.context = { ...(turn.assistant.context ?? { usedBytes: 0,
            maxBytes: this.#agentOptions?.contextBudgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES, method: "unverified_byte_cap" }), full: true, exhaustedBy: "provider" };
          this.patchAgent({ context: turn.assistant.context });
        }
        this.#state.error = full ? NEW_CONTEXT_HINT : this.agentError(error);
      }
    } finally {
      if (turn.timer) clearTimeout(turn.timer);
      if (turn.abort.signal.aborted && !turn.writeError) this.#state.notice = "the response was interrupted. you can retry it manually.";
      if (this.#state.error) turn.assistant.failure = this.safeText(this.#state.error).slice(0,8192);
      if (!turn.writeError) {
        try { this.#store.saveSession(turn.session); this.summarize(turn.session); }
        catch (error) { turn.writeError = this.recordWriteFailure(error); turn.abort.abort(); }
      }
      if (turn.writeError) this.#state.error = turn.writeError;
      this.#turn = null;
      this.#state.busy = false;
      this.publish();
    }
  }

  cancel(): Promise<void> {
    if (this.#cancelTask) return this.#cancelTask;
    const turn = this.#turn;
    const operation = this.#operation;
    this.#authAbort?.abort();
    turn?.abort.abort();
    this.#manualAbort?.abort();
    this.#approval?.settle(false);
    // assertIdle wyklucza równoczesny stream i uwierzytelnianie.
    if (!this.#agentOptions) return turn?.done ?? operation ?? Promise.resolve();
    const task = Promise.resolve(turn?.done ?? operation).then(async () => {
      this.retireAgentService();
      await this.#cleanup;
    }).finally(() => { this.#cancelTask = null; });
    this.#cancelTask = task;
    return task;
  }

  disconnect(): Promise<void> {
    if (this.#disconnectTask) return this.#disconnectTask;
    if (this.#closing || this.#closed) return Promise.reject(new Error(safeError(new CoreError("closed"))));
    const cancelled = this.cancel();
    const task = Promise.resolve().then(async () => {
      await cancelled;
      this.#gateway = null;
      this.#key = null;
      Object.assign(this.#state, { connection: "disconnected", credentialMode: "none", models: [] });
      try { await this.#credentials.delete(this.#state.settings.baseUrl); }
      catch { throw new CoreError("credential_delete"); }
    }).catch((error: unknown) => {
      this.fail(error);
      throw new Error(safeError(error));
    }).finally(() => { this.#disconnectTask = null; this.publish(); });
    this.#disconnectTask = task;
    return task;
  }

  dispose(): Promise<void> {
    if (this.#disposeTask) return this.#disposeTask;
    this.#closing = true;
    const cancelled = this.cancel();
    this.#disposeTask = Promise.resolve().then(async () => {
      await cancelled;
      await this.#disconnectTask?.catch(() => {});
      await this.#browser?.dispose();
      await this.#mcp?.dispose();
      this.#store.close();
      this.#closed = true;
      if (this.#unsaved) throw new CoreError("unsaved");
    }).catch((error: unknown) => {
      this.fail(error);
      throw new Error(safeError(error));
    }).finally(() => {
      this.#gateway = null;
      this.#key = null;
      Object.assign(this.#state, { connection: "disconnected", credentialMode: "none", models: [] });
      this.publish();
      this.#listeners.clear();
    });
    return this.#disposeTask;
  }

  clearError(): void {
    if (this.#state.error !== null) { this.#state.error = null; this.publish(); }
  }
}
import { canonicalModel } from '../api/model-transport';
