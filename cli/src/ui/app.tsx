import { modelLabel } from "./model-label";
import { McpView } from "./mcp";
import {UserInstructions} from "./user-instructions";
import { CLI_VERSION } from "../version";
import { TextAttributes, InputRenderable, decodePasteBytes, type MouseEvent, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core";
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChatController } from "../core";
import type { AgentDetailsView, AgentMode, ReasoningEffort } from "../types";
import { basename, join } from "node:path";
import { getDataDirectory } from "../storage/paths";
import { usageLabel } from "../core/usage";
import { Picker } from "./picker";
import { SecretField } from "./secret-field";
import { displayText, theme, dialogBackdropOpacity } from "./theme";
import { agentCommandIds, commands, commandSuggestions, parseInput, visibleCommands, type CommandId } from "./commands";
import { HelpView, ProfileView, UsageView } from "./details";
import { useJailbreakPresentation } from "./jailbreak-presentation";
import { EdgeyLogo, type LogoPointer } from "./logo";
import { measureEdgey } from "./logo-model";
import { agentModes, modeLabels, agentRequestCount, ApprovalView, attachmentInput, AttachmentPicker, changedPaths, CopyPreview, TextDetails } from "./agent-views";
import { AssistantMarkdown, markdownParts } from "./markdown";
import { OutputView } from "./agent-lifecycle";
import { RecoveryView } from "./recovery";
import { InstructionsView } from "./instructions";
import { Activity } from "./activity";
import { LiveWork, SubagentDetails, TaskSteps, agentStatusLabel, childStatus, subagents, workLabel, type ToolDraft } from "./live-work";

import { AgentPages, DraftPage } from "./work-pages";
import { ProcessPage } from "./process-page";
import { Transcript, type TranscriptPosition } from "./transcript";
import { Loading } from "./loading";
import { Dialog, dialogSize } from "./dialog";
import { modelVision } from "../api/vision";
import { ImageDraft } from "../media/draft";
import type { ImageRef } from "../media/images";
import { createClipboard, pasteText, imageClipboardProgram, type ClipboardAdapter } from "./clipboard";
import { Diagnostics } from "./diagnostics";
import { AccountView } from './account';
import { apiErrorHint } from "../api/errors";
import { contextPercent } from "../agent/context-usage";


type View = "mcp" | "browser" | "account" | "messages" | "message-actions" | "replace-draft" | "diagnostics" | "chat" | "transcript" | "key" | "models" | "project" | "sessions" | "palette" | "forget" | "help" | "usage" | "profile"
  | "skills" | "markdown" | "process-detail" | "draft-detail" | "task-detail" | AgentDetailsView | "mode" | "effort" | "agents" | "agent-detail" | "approval" | "attach" | "attachments" | "copy" | "copy-preview" | "recover" | "instructions" | "output";
const agentDetailViews: readonly string[] = ["tools", "diff", "tasks", "permissions", "context", "jobs", "git", "undo"];

const bold = TextAttributes.BOLD;

export function App({ controller, onExit, profileDirectory, clipboard: suppliedClipboard }: {
  controller: ChatController;
  onExit: () => void | Promise<void>;
  profileDirectory?: string;
  clipboard?: ClipboardAdapter;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const renderer = useRenderer();
  const clipboard=useMemo(()=>suppliedClipboard??createClipboard(text=>renderer.copyToClipboardOSC52(text)),[renderer,suppliedClipboard]);
  const [selectedMessage,setSelectedMessage]=useState<string|null>(null);
  const [historyEnd,setHistoryEnd]=useState<number|undefined>();
  const messageClick=useRef<{id:string;x:number;y:number;dragged:boolean}|null>(null);
  const lastPaste=useRef(0),pasteGeneration=useRef(0),copyGeneration=useRef(0);
  const nativePasteReceipt=useRef<{text:string;target:unknown;at:number;image?:boolean}|null>(null);
  const pendingPaste=useRef<{target:unknown;text?:string;generation:number}|null>(null);
  const resendLock=useRef(false);
  const [transcriptAnchor,setTranscriptAnchor]=useState<string|undefined>();

  const { width, height } = useTerminalDimensions();
  const [view, setViewState] = useState<View | null>(null);
  // the session sidebar stays hidden until /sidebar or ctrl+b asks for it.
  const [sidebar, setSidebar] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const imageDraft=useRef(new ImageDraft());
  const [imageRevision,setImageRevision]=useState(0);
  const [browserStatus,setBrowserStatus]=useState("browser is closed");
  const [suggestionSelection, setSuggestionSelection] = useState({ query: "", index: 0 });
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string | null>(null);
  const [editorLines, setEditorLines] = useState(1);
  const editor = useRef<TextareaRenderable>(null);
  const draftPosition = useRef<{ text: string; cursor: number; x: number; y: number; width: number } | null>(null);
  const bookmarkedEditor = useRef<TextareaRenderable | null>(null);
  const history = useRef<ScrollBoxRenderable>(null);
  const pointer = useRef<LogoPointer | null>(null);
  const scrollBottom = useRef(false);
  const bookmark = useRef<{ session: string | undefined; top: number; bottom: boolean } | null>(null);
  const approvalReturn = useRef<View | null>(null);
  const reviewedTool = useRef<string | null>(null);
  const lastEscape = useRef(0);
  const detailPositions = useRef(new Map<string, number>());
  const transcriptPositions=useRef(new Map<string,TranscriptPosition>());
  const [attachmentPath, setAttachmentPath] = useState("");
  const [copyBlock, setCopyBlock] = useState<{ source: string; language: string } | null>(null);
  const [copyResult, setCopyResult] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<{ draft: ToolDraft; file: number } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [outputSelection,setOutputSelection]=useState<{id:string;from:"chat"|"transcript"}|null>(null);
  function openOutput(id:string){setOutputSelection({id,from:current==="transcript"?"transcript":"chat"});setView("output");}
  const childAgents = subagents(state.agent, selectedTask);
  const childAgent = childAgents.find((event) => event.id === selectedAgent);
  const pending = state.busy || state.connection === "connecting" || !state.initialized;
  const current: View = view ?? (state.connection !== "connected" ? "key"
    : !state.settings.model || !state.models.some((model) => model.id === state.settings.model) ? "models" : "chat");
  const jailbreak = useJailbreakPresentation(!!state.session?.privateMode, state.session?.id,
    current === "chat" && !state.session?.messages.length);
  const availableCommands = visibleCommands(!!state.agent);
  const commandInventory=useMemo(()=>{
    if(!draft.trimStart().startsWith('/')||draft.trimStart().startsWith('//'))return [];
    try{return controller.listUserCommands();}catch{return [];}
  },[controller,state.project,current,draft.trimStart().startsWith('/'),state.busy]);
  const matchingCommands = (text: string) => commandSuggestions(text,commandInventory).filter(entry => 'scope' in entry || availableCommands.includes(entry));
  const suggestions = matchingCommands(draft);
  const showSuggestions = current === "chat" && !state.userQuestion && !state.agent?.approval
    && /^\/[a-z0-9_:-]*$/i.test(draft.trimStart()) && dismissedSuggestions !== draft;
  const selectedSuggestion = Math.min(suggestionSelection.query === draft ? suggestionSelection.index
    : Math.max(0, suggestions.findIndex(entry => entry.slash === draft.trimStart().toLowerCase())), Math.max(0, suggestions.length - 1));
  const isDialog=["models","sessions","palette","mode","effort","messages","message-actions","replace-draft"].includes(current);
  const selectedMessageRecord=state.session?.messages.find(message=>message.id===selectedMessage);
  const modelGroups=new Set(state.models.map(model=>state.settings.favorites.includes(model.id)?"favorite":state.settings.recentModels?.includes(model.id)?"recent":"other")).size;
  const dialogItems=current==="models"?state.models.length+modelGroups:current==="sessions"?state.sessions.length:current==="mode"?agentModes.length:
    current==="effort"?controller.getReasoningEfforts().length+1:current==="replace-draft"?2:current==="message-actions"?
      selectedMessageRecord?.role==="user"?4:2+markdownParts(selectedMessageRecord?.content??"").filter(part=>part.kind==="code").length:24;
  const desiredDialogHeight=9+dialogItems+(copyResult?2:0)+(pending&&current==="message-actions"?1:0);
  const modalHeight=dialogSize(width,height,desiredDialogHeight).height-2;
  const messageCount=state.session?.messages.length??0;
  const end=Math.min(historyEnd??messageCount,messageCount),start=Math.max(0,end-40);
  const visibleMessages=state.session?.messages.slice(start,end)??[];
  async function copyText(text:string){const generation=++copyGeneration.current;const result=await clipboard.write(text);if(generation===copyGeneration.current)setCopyResult(result.message);return result;}
  function insertPaste(text:string,target=renderer.currentFocusedEditor){
    if(!target||target.isDestroyed||controller.getSnapshot().agent?.approval)return;
    try{
      const value=pasteText(text),selected=target.getSelectedText();
      if(Buffer.byteLength(target.plainText)-Buffer.byteLength(selected)+Buffer.byteLength(value)>1024*1024)throw new Error("input exceeds 1 mib; nothing inserted");
      if(target instanceof InputRenderable&&(/[\r\n]/.test(value)||target.plainText.length-selected.length+value.length>target.maxLength))throw new Error("paste does not fit this single-line field; nothing inserted");
      // Explicitly clear both native and renderer selection state after replacing it.
      // OpenTUI's programmatic selection otherwise survives an insertion in some hosts.
      target.deleteSelection();target.editorView.resetSelection();target.clearSelection();target.insertText(value);
    }catch(error){setLocalError((error as Error).message);}
  }
  usePaste(event=>{
    if(current==="key"){lastPaste.current=Date.now();pasteGeneration.current++;return;}
    event.preventDefault();event.stopPropagation();
    const text=decodePasteBytes(event.bytes),receipt=nativePasteReceipt.current;nativePasteReceipt.current=null;
    // Some hosts deliver both the shortcut and bracketed paste for one gesture.
    if(pendingPaste.current&&pendingPaste.current.target===renderer.currentFocusedEditor){pendingPaste.current.text=text;return;}
    lastPaste.current=Date.now();pasteGeneration.current++;
    if(receipt&&receipt.target===renderer.currentFocusedEditor&&(receipt.image||receipt.text===text)&&Date.now()-receipt.at<500)return;
    insertPaste(text);
  });
  function messageAction(action:string){
    const message=selectedMessageRecord;if(!message)return;
    if(action==="copy"){void copyText(message.content);return;}
    if(action==="transcript"){setTranscriptAnchor(message.id);setView("transcript");return;}
    if(action.startsWith("code:")){const part=markdownParts(message.content)[Number(action.slice(5))];if(part?.kind==="code")void copyText(part.source);return;}
    if(pending||state.userQuestion||state.agent?.approval){setLocalError("finish or cancel the current operation first.");return;}
    if(action==="edit"&&draft.length>0){setView("replace-draft");return;}
    if(action==="edit"||action==="replace"){
      const value=imageDraft.current.restore(message.content,message.images,message.imagePositions);editor.current?.replaceText(value);setDraft(value);draftPosition.current=null;setView(null);return;
    }
    if(action==="send"&&!resendLock.current){resendLock.current=true;setHistoryEnd(undefined);setView(null);void controller.send(message.content,message.images,message.imagePositions).finally(()=>{resendLock.current=false;});}
  }

  const tall = height >= 20, wide = width >= 80;
  const report = state.agent?.context ?? state.session?.messages.at(-1)?.context;
  const context = report?.model && report.model !== state.session?.model ? undefined : report;
  const contextFull = !!context?.full && context.exhaustedBy === "provider";
  const contextValue = context ? contextPercent(context) : undefined;
  const contextLabel = contextFull ? "context 100% · /new" : contextValue !== undefined ? `context ${contextValue}%`
    : messageCount ? "context ?" : "context 0%";
  const alertRows = tall ? 2 : 1;
  const alertHeight = (current !== "chat" && !isDialog && (localError || state.error) ? alertRows : 0) + (state.notice ? alertRows : 0) + (copyResult&&!isDialog?1:0);
  // the context strip above the composer replaces the former top bar: a rule plus two lines, or one line when short.
  const selectedMarkdown = state.session?.instructionSources?.find(source => source.kind === "markdown");
  const stripRows = (tall ? 3 : 1) + (contextFull ? 1 : 0) + (selectedMarkdown ? 1 : 0);
  // reserve three transcript rows, the composer border, the footer and the strip before the editor grows.
  const maxEditorLines = Math.max(1, Math.min(8, height - 9 - stripRows - alertHeight - (showSuggestions ? 4 : 0)));
  // a single-line prompt that grows with the draft, as in the reference screenshot.
  const editorHeight = Math.min(maxEditorLines, Math.max(1, editorLines));
  const suggestionRows = Math.max(1, Math.min(5, height - editorHeight - 5 - stripRows - alertHeight));
  const suggestionStart = Math.max(0, selectedSuggestion - suggestionRows + 1);
  const suggestionsHeight = showSuggestions ? 1 + Math.min(Math.max(1, suggestions.length), suggestionRows) : 0;
  useEffect(() => { void controller.initialize(); }, [controller]);
  // Capture chat navigation before unmounting its editor. Later output never changes this return target.
  useLayoutEffect(() => {
    const approval = state.agent?.approval;
    if (approval) {
      if (approvalReturn.current === null) { approvalReturn.current = current; setView("approval"); }
      reviewedTool.current = approval.toolId;
    } else if (approvalReturn.current !== null) {
      const previous = approvalReturn.current;
      approvalReturn.current = null;
      reviewedTool.current = null;
      setViewState(previous === "approval" ? "chat" : previous);
    }
  }, [state.agent?.approval?.toolId]);

  useEffect(() => {
    if (state.agent && agentDetailViews.includes(current)) void controller.refreshAgentDetails(current as AgentDetailsView);
  }, [current, controller, state.agent?.runId]);
  function restoreHistory() {
    const box = history.current;
    if (!box) return;
    const saved = bookmark.current;
    if (scrollBottom.current || (saved && saved.session === state.session?.id && saved.bottom)) box.scrollTo(box.scrollHeight);
    else if (saved && saved.session === state.session?.id) box.scrollTo(saved.top);
    scrollBottom.current = false;
    bookmark.current = null;
  }

  function setView(next: View | null) {
    if (current === "chat" && history.current) {
      const box = history.current;
      bookmark.current = { session: state.session?.id, top: box.scrollTop,
        bottom: box.scrollTop >= Math.max(0, box.scrollHeight - box.viewport.height - 1) };
    }
    if (current === "chat" && next !== "chat" && next !== null && editor.current) {
      const viewport = editor.current.editorView.getViewport();
      bookmarkedEditor.current = editor.current;
      draftPosition.current = { text: editor.current.plainText, cursor: editor.current.cursorOffset,
        x: viewport.offsetX, y: viewport.offsetY, width: viewport.width };
    }
    setViewState(next);
  }

  function markSessionChange() {
    bookmark.current = null;
    setHistoryEnd(undefined);
    scrollBottom.current = true;
  }

  function clearDraft() {
    imageDraft.current.clear();setImageRevision(v=>v+1);
    editor.current?.clear();
    setDraft("");
    setDismissedSuggestions(null);
    setSuggestionSelection({ query: "", index: 0 });
    draftPosition.current = null;
  }

  function restoreDraft() {
    const saved = draftPosition.current;
    const field = editor.current;
    // A mouse navigation can render one last chat frame before unmounting it.
    // Consume its bookmark only when the replacement editor has mounted.
    if (saved && field && field !== bookmarkedEditor.current) {
      draftPosition.current = null;
      bookmarkedEditor.current = null;
      if (saved.text === field.plainText) {
        field.cursorOffset = saved.cursor;
        if (field.width === saved.width) field.editorView.setViewport(saved.x, saved.y, field.width, field.height, false);
      }
    }
    measureEditor();
  }

  function measureEditor() {
    if (editor.current) {
      const lines = editor.current.plainText ? Math.max(1, editor.current.editorView.getTotalVirtualLineCount()) : 1;
      if (lines !== editorLines) setEditorLines(lines);
    }
  }

  function act(action: () => void) {
    setLocalError(null);
    try { action(); } catch { /* the controller publishes a safe error */ }
  }

  function navigate(next: View) {
    if (pending && !["account", "messages", "message-actions", "diagnostics", "transcript", "palette", "help", "usage", "profile", "chat", "agents", "agent-detail", "draft-detail", "attachments", "copy", "instructions", "output", ...agentDetailViews.filter((id) => id !== "undo")].includes(next)) {
      setLocalError("finish or cancel the current operation first."); return;
    }
    setLocalError(null);
    setView(next);
  }

  function exit() {
    void Promise.resolve().then(onExit).catch(() => setLocalError("could not close the application."));
  }

  function command(id: string) {
    const entry = commands.find((item) => item.id === id);
    if (!entry) return;
    if (pending && !entry.duringOperation) { if(current==="palette")setView(null);setLocalError("finish or cancel the current operation first."); return; }
    if (agentCommandIds.has(id) && !state.agent) { setLocalError("agent runtime is not configured."); return; }
    setLocalError(null);
    if(id==="mcp"){setView("mcp");return;}
    if(id==="browser"){setBrowserStatus(JSON.stringify(controller.browser().status(state.session?.id??""),null,2));setView("browser");return;}
    if(id==="image"){setView(null);void pickImage();return;}
    if (id === "jailbreak") {
      if (jailbreak.active()) { setLocalError("wait for the animation or press esc."); return; }
      setView(null);
      const before = !!controller.getSnapshot().session?.privateMode;
      void controller.toggleJailbreak().then(() => { const after = !!controller.getSnapshot().session?.privateMode; if (before !== after) jailbreak.start(after, controller.getSnapshot().session?.id); }); return;
    }
    if (id === "exit") { exit(); return; }
    if (id === "cancel") { void controller.cancel(); setView(null); return; }
    if (id === "forceclose") { setView(null);void controller.forceClose().then(()=>{clearDraft();setHistoryEnd(undefined);setView("chat");}).catch(()=>setLocalError("could not open a fresh session. inspect /diagnostics; your history is retained."));return; }
    if (id === "sidebar") { setSidebar((value) => !value); setView(null); return; }
    if (id === "bottom") {
      setHistoryEnd(undefined);
      scrollBottom.current = true;
      if (history.current) { history.current.scrollTo(history.current.scrollHeight); scrollBottom.current = false; }
      setView(null); return;
    }
    if (id === "retry") { setView(null); void controller.retry(); return; }
    if (id === "output") setOutputSelection(null);
    if (id === "transcript") setTranscriptAnchor(undefined);
    if (id === "continue") { setView(null); void controller.continueAgent(); return; }
    if (id === "new") { act(() => { controller.newSession(); clearDraft(); setView("chat"); }); return; }
    navigate(id as View);
  }

  function runSlash(id: CommandId) {
    if(!["image","attachments","attach","browser"].includes(id))clearDraft();
    else if(editor.current?.plainText.trim()===`/${id}`){editor.current.replaceText("");imageDraft.current.update("");setDraft("");}
    command(id);
  }

  function chooseSuggestion(entry:(typeof suggestions)[number]){
    if(!('scope' in entry)){runSlash(entry.id);return;}
    const text=entry.slash+' ';
    editor.current?.replaceText(text);if(editor.current)editor.current.cursorOffset=text.length;
    setDraft(text);setLocalError(null);
  }

  useKeyboard((key) => {
    const consume = () => { key.preventDefault(); key.stopPropagation(); };
    nativePasteReceipt.current=null; // a new keyboard gesture is independent
    if(key.ctrl&&key.name==="c"&&current!=="key"){
      const selection=renderer.getSelection()?.getSelectedText()||renderer.currentFocusedEditor?.getSelectedText()||"";
      if(selection||key.shift){consume();if(selection)void copyText(selection);else setCopyResult("select text to copy");return;}
    }
    if((key.ctrl&&key.name==="v")||(key.shift&&key.name==="insert")){
      if(current==="key")return;
      consume();if(key.repeated||controller.getSnapshot().agent?.approval)return;
      const target=renderer.currentFocusedEditor,generation=++pasteGeneration.current,started=Date.now();
      const transaction={target,generation} as {target:unknown;generation:number;text?:string};pendingPaste.current=transaction;
      void (async()=>{
        const bytes=current==="chat"?await clipboard.readImage?.():null;
        if(bytes){if(generation===pasteGeneration.current&&target===renderer.currentFocusedEditor){addImage(controller.imageStore().add(bytes,"clipboard.png"));nativePasteReceipt.current={text:"",target,at:Date.now(),image:true};}return;}
        const text=transaction.text??await clipboard.read();
        if(generation===pasteGeneration.current&&lastPaste.current<started&&target===renderer.currentFocusedEditor){const value=transaction.text??text;insertPaste(value,target);nativePasteReceipt.current={text:value,target,at:Date.now()};}
      })().catch(()=>{if(transaction.text!==undefined&&target===renderer.currentFocusedEditor&&generation===pasteGeneration.current)insertPaste(transaction.text,target);else setLocalError("system paste unavailable · use the terminal paste command");}).finally(()=>{if(pendingPaste.current===transaction)pendingPaste.current=null;});return;
    }
    if(key.ctrl&&["a","x"].includes(key.name)&&renderer.currentFocusedEditor&&current!=="key"&&!state.agent?.approval){
      const target=renderer.currentFocusedEditor;
      if(key.name==="a"){consume();target.selectAll();return;}
      // ctrl+x remains job stop in read-only job views; cut belongs to editable fields only.
      if(!["jobs","process-detail"].includes(current)){consume();const text=target.getSelectedText(),before=target.plainText,selection=target.getSelection();
        if(text)void copyText(text).then(result=>{if(result.kind!=="error"&&!target.isDestroyed&&target.plainText===before&&JSON.stringify(target.getSelection())===JSON.stringify(selection)){target.deleteSelection();target.editorView.resetSelection();target.clearSelection();}});return;}
    }
    if(isDialog&&key.name==="escape"){consume();setView(null);setLocalError(null);return;}
    // Inline completion keeps the editor focused; it never opens the palette on typing.
    // Approval and question input always keep their existing, explicit controls.
    if(showSuggestions&&!controller.getSnapshot().agent?.approval&&!key.ctrl&&!key.shift&&!key.meta&&!key.option&&!key.super&&!key.hyper){
      if(key.name==="escape"){consume();setDismissedSuggestions(draft);lastEscape.current=0;return;}
      if(["up","down"].includes(key.name)){
        consume();setSuggestionSelection({query:draft,index:Math.max(0,Math.min(suggestions.length-1,selectedSuggestion+(key.name==="down"?1:-1)))});return;
      }
      if(key.name==="tab"){
        consume();const selected=suggestions[selectedSuggestion];
        if(selected&&editor.current){editor.current.replaceText(selected.slash);editor.current.cursorOffset=selected.slash.length;}
        return;
      }
    }
    if(current==="chat"&&!pending&&!state.userQuestion&&!state.agent?.approval&&!key.ctrl&&!key.shift&&!key.meta){
      if(key.name==="up"&&!(editor.current?.plainText??draft).length){const message=state.session?.messages.findLast(m=>m.role==="user");if(message){consume();try{for(const image of message.images??[])controller.imageStore().read(image);const value=imageDraft.current.restore(message.content,message.images,message.imagePositions);editor.current?.replaceText(value);if(editor.current)editor.current.cursorOffset=value.length;setDraft(value);setImageRevision(v=>v+1);}catch(error){setLocalError((error as Error).message);}return;}}
      if(key.name==="escape"&&imageDraft.current.recalled){consume();clearDraft();return;}
    }
    if (jailbreak.active() && key.name === "escape") { consume(); jailbreak.skip(); return; }
    if (key.name === "escape" && !key.repeated && ["chat", "approval"].includes(current)) {
      const now = Date.now();
      const twice = now - lastEscape.current < 1000;
      lastEscape.current = now;
      if (twice) {
        consume(); lastEscape.current = 0; reviewedTool.current = null;
        setView(null); setLocalError(null);
        void controller.cancel().then(() => controller.clearError());
        return;
      }
    }
    // Read the live snapshot as well: an Enter queued with submit must never reach a review action.
    const approval = controller.getSnapshot().agent?.approval;
    if (approval || current === "approval") {
      if (key.ctrl && key.name === "c") { consume(); reviewedTool.current = null; void controller.cancel(); return; }
      if (approval && current === "approval" && reviewedTool.current === approval.toolId && !key.repeated) {
        if ((key.ctrl && ["y", "n"].includes(key.name)) || key.name === "escape") {
          consume(); reviewedTool.current = null;
          controller.resolveApproval(approval.toolId, key.ctrl && key.name === "y"); return;
        }
      }
      if (!["up", "down", "pageup", "pagedown", "home", "end"].includes(key.name)) consume();
      return;
    }
    // These views own their local navigation and explicit decision keys.
    if (["skills", "markdown", "recover", "instructions", "output", "process-detail"].includes(current) && !(key.ctrl && ["c", "p"].includes(key.name))) return;
    if (current === "draft-detail" && key.ctrl && key.name === "o") return;
    if (current === "agent-detail" && key.ctrl && ["i", "r", "o"].includes(key.name)) return;
    if (key.ctrl && key.name === "c") {
      consume();
      if (state.busy) void controller.cancel();
      else {
        setCopyResult("select text or open message actions to copy");
      }
    } else if (key.name === "escape") {
      consume();
      if (current === "draft-detail") { setView(null); setLocalError(null); }
      else if (current === "agent-detail") { setView("agents"); setLocalError(null); }
      else if (["mcp", "browser", "account", "diagnostics", "transcript", "usage", "profile", "help", "palette", "mode", "effort", "attach", "attachments", "copy", "copy-preview", "agents", "task-detail", ...agentDetailViews].includes(current)) { setView(null); setLocalError(null); }
      else if (state.busy || state.connection === "connecting") void controller.cancel();
      else { setView(null); setLocalError(null); controller.clearError(); }
    } else if (["chat","transcript"].includes(current) && key.ctrl && key.name === "r") {
      consume();setTranscriptAnchor(undefined);setView(current==="transcript"?null:"transcript");
    } else if (current === "chat" && key.ctrl && key.name === "g" && state.agent) {
      consume(); setSelectedTask(null); setSelectedAgent(null); setView("agents");
    } else if (current === "chat" && key.ctrl && key.name === "t") {
      consume();
      if (key.repeated) return;
      if (pending) { setLocalError("finish or cancel the current operation before changing effort."); return; }
      const levels = controller.getReasoningEfforts();
      const ordered = [...levels.filter((level) => level !== "none"), ...levels.filter((level) => level === "none")];
      if (!ordered.length) { setLocalError("no declared effort levels for this model."); return; }
      const currentEffort = controller.getReasoningEffort();
      const next = currentEffort === undefined ? ordered[0] : ordered[ordered.indexOf(currentEffort) + 1];
      act(() => controller.setReasoningEffort(next)); setLocalError(null);
    } else if (current === "chat" && key.name === "tab" && state.agent) {
      consume();
      if (key.repeated) return;
      if (pending) { setLocalError("stop the current task with double esc, then tab changes mode."); return; }
      const modes: AgentMode[] = ["auto", "review", "trusted", "plan", "bypass"];
      const index = modes.indexOf(state.agent.mode);
      const next = (index + (key.shift ? -1 : 1) + modes.length) % modes.length;
      act(() => controller.setAgentMode(modes[next])); setLocalError(null);

    } else if (key.ctrl && key.name === "r" && current === "models" && !pending) {
      consume(); void controller.refreshModels();
    } else if (key.ctrl && key.name === "p") {
      consume();
      if (current === "palette") setView(null); else navigate("palette");
    } else if (["agents","task-detail"].includes(current) && key.ctrl && key.name === "o") {
      consume();
      command("output");
    } else if (current !== "key" && current !== "browser" && key.ctrl && ["o", "s", "n", "b"].includes(key.name)) {
      consume();
      if (key.name === "o") navigate("models");
      if (key.name === "s") navigate("sessions");
      if (key.name === "n" && !pending) command("new");
      if (key.name === "b") setSidebar((value) => !value);
    } else if (current === "chat" && ["pageup", "pagedown"].includes(key.name)) {
      consume();
      history.current?.scrollBy(key.name === "pageup" ? -1 : 1, "viewport");
    } else if (current === "chat" && key.ctrl && key.name === "j") {
      consume();
      editor.current?.newLine();
    } else if (key.ctrl && key.name === "r" && agentDetailViews.includes(current)) {
      consume(); void controller.refreshAgentDetails(current as AgentDetailsView);
    } else if (key.ctrl && key.name === "y" && !key.repeated && current === "undo" && !pending) {
      consume(); setView("chat"); void controller.undoLastChange();
    } else if(current==="browser"&&!pending&&key.ctrl&&["o","w","r"].includes(key.name)){
      consume();try{const id=controller.browserSession(),manager=controller.browser();const action=key.name==="o"?manager.open(id):key.name==="w"?manager.close(id):Promise.resolve();void action.then(()=>setBrowserStatus(JSON.stringify(manager.status(id),null,2))).catch(error=>setLocalError((error as Error).message));}catch(error){setLocalError((error as Error).message);}
    } else if(current==="attachments"&&!pending&&/^[1-4]$/.test(key.name)){
      consume();imageDraft.current.remove(Number(key.name)-1);setDraft(imageDraft.current.text);if(draftPosition.current)draftPosition.current.text=imageDraft.current.text;setImageRevision(v=>v+1);
    } else if (key.ctrl && key.name === "d" && current === "attachments") {
      consume();
      if (pending) setLocalError("finish or cancel the current operation first.");
      else act(() => {controller.clearAttachments();for(let i=imageDraft.current.marks.length-1;i>=0;i--)imageDraft.current.remove(i);setDraft(imageDraft.current.text);if(draftPosition.current)draftPosition.current.text=imageDraft.current.text;setImageRevision(v=>v+1);});
    } else if (key.ctrl && key.name === "y" && !key.repeated && current === "copy-preview" && copyBlock) {
      consume();
      void copyText(copyBlock.source);
    } else if (current === "forget" && key.name === "return") {
      consume();
      void controller.disconnect().then(() => setView("key")).catch(() => {});
    }
  });

  const models = [...state.models].sort((a, b) => {
    const score = (id: string) => state.settings.favorites.includes(id) ? -100
      : (state.settings.recentModels ?? []).includes(id) ? (state.settings.recentModels ?? []).indexOf(id) - 50 : 0;
    return score(a.id) - score(b.id) || a.id.localeCompare(b.id);
  }).map((model) => ({ id: model.id,
    name: `${state.settings.favorites.includes(model.id) ? "★ " : "  "}${modelLabel(model.id)}`,
    active: model.id===state.settings.model,
    group:state.settings.favorites.includes(model.id)?"favorites":(state.settings.recentModels??[]).includes(model.id)?"recent":"all models",
    description: `${model.owned_by??"provider unspecified"} · images: ${modelVision(model.id).status} · tools: ${controller.getToolCapability(model.id)} · effort: ${model.reasoningEfforts?.join(", ")||"undeclared"}`,

  }));
  const sessions = state.sessions.map((session) => ({ id: session.id, name: session.title, description: modelLabel(session.model) }));
  const status = state.agent?.enabled ? displayText(agentStatusLabel(state.agent)) : state.busy ? "generating…" : state.connection === "connecting" ? "connecting…"
    : state.connection === "connected" ? "connected" : "disconnected";
  const statusColor = state.busy || state.connection === "connecting" ? theme.warning
    : state.connection === "connected" ? theme.accentBright : theme.error;
  const rawError = localError ?? state.error;
  const errorHint=rawError?apiErrorHint(rawError):undefined;
  const error=rawError&&errorHint?`${rawError}\n${errorHint}`:rawError;
  const availableHeight = height - 4 - alertHeight;
  const hasSidebar = width >= 100 && tall && sidebar && current === "chat" && (state.sessions.length > 0 || !!state.agent?.enabled);
  const project = basename(state.project) || state.project;
  const profile = state.profile ? `${state.profile.name}@${state.profile.version}` : "none";
   const usageEvent = state.agent?.events.findLast((event) => event.type === "request");
   const usageKey = usageEvent?.type === "request" ? JSON.stringify([usageEvent.requestId, usageEvent.status, usageEvent.usage]) : "";
   const delegatedUsageKey = childAgents.map((agent) => `${agent.id}:${agent.status}`).join("|");
   const agentUsage = useMemo(() => state.agent?.enabled ? controller.getAgentUsage() : null,
     [controller, state.agent?.enabled, state.agent?.runId, state.session?.id, state.busy, usageKey, delegatedUsageKey, current === "usage"]);
  // The façade exposes request counts in its source-labelled usage summary, not one assistant per request.
  const requests = agentUsage === null ? state.session?.messages.filter((message) => message.role === "assistant").length ?? 0
    : agentRequestCount(agentUsage);
  const blocks = useMemo(() => (state.session?.messages ?? []).filter((message) => message.role === "assistant")
    .flatMap((message) => markdownParts(message.content).filter((part) => part.kind === "code" && part.complete)
      .map((part, index) => ({ ...part, id: `${message.id}:${index}`, name: `${part.language || "code"} · ${modelLabel(message.model ?? "assistant")} · block ${index + 1}` }))), [state.session?.messages]);
  const paths = state.agent ? changedPaths(state.agent) : [];
  const lastTool = state.agent?.tools.at(-1);
  const keyMode = state.credentialMode === "memory" ? "memory only" : "system store";
  // welcome block sizing: the logo takes the rows left after the text lines below it.
  const historyHeight = Math.max(1, height - alertHeight - suggestionsHeight - stripRows - (editorHeight + 2) - 1);
  const welcomeTextRows = height >= 24 ? 7 : tall ? 5 : 3;
  const artWidth = Math.max(1, Math.min(80, width - (wide ? 4 : 2) - (hasSidebar ? 28 : 0)));
  const artHeight = Math.max(1, Math.min(measureEdgey(artWidth, 22) || 1, historyHeight - welcomeTextRows));
  const trackPointer = (event: MouseEvent) => { pointer.current = { x: event.x, y: event.y }; };
  // the renderer would focus whichever focusable box was clicked (the transcript, for one);
  // in the chat view every click returns the keyboard to the composer instead.
  function openMessage(id:string){setSelectedMessage(id);setCopyResult(null);setView("message-actions");}

  function submit() {
    if (controller.getSnapshot().agent?.approval) return;
    const text = editor.current?.plainText ?? "";
    if (!text.trim()) return;
    if (text.trim().toLowerCase()==="/forceclose") {runSlash("forceclose");return;}
    if (state.userQuestion) { controller.answerAgentQuestion(text); clearDraft(); return; }
    if (dismissedSuggestions !== text) {
      const matches = matchingCommands(text);
      const selected = matches[Math.min(suggestionSelection.query === text ? suggestionSelection.index
        : Math.max(0, matches.findIndex(entry => entry.slash === text.trimStart().toLowerCase())), Math.max(0, matches.length - 1))];
      if (selected && (!('scope' in selected)||selected.slash!==text.trim())) { chooseSuggestion(selected); return; }
    }
    const imageCommand=/^\/image\s+(.+)$/s.exec(text.trim());
    if(imageCommand?.[1]==="clipboard"){
      if(pending)return;
      const target=editor.current,session=state.session?.id,generation=++pasteGeneration.current;
      void (async()=>{try{
        const bytes=await clipboard.readImage?.();
        if(generation!==pasteGeneration.current||target!==editor.current||target?.plainText!==text||controller.getSnapshot().session?.id!==session||controller.getSnapshot().busy)return;
        if(!bytes)throw new Error("no image in clipboard · copy a screenshot first");
        const image=controller.imageStore().add(bytes,"clipboard.png");
        clearDraft();addImage(image);setLocalError(null);
      }catch(error){if(generation===pasteGeneration.current&&target===editor.current)setLocalError((error as Error).message);}})();
      return;
    }
    if(imageCommand){if(pending)return;try{const path=imageCommand[1].replace(/^"(.*)"$/s,"$1");const image=controller.imageStore().addFile(path);clearDraft();addImage(image);}catch(error){setLocalError((error as Error).message);}return;}
    const parsed = parseInput(text);
    if (parsed.kind === "command") { runSlash(parsed.command.id); return; }
    if (parsed.kind === "error") {
      setLocalError(parsed.message); return;
    }
    if (pending) { setLocalError("response in progress; /cancel stops it, /usage shows token counts."); return; }
    if (state.agent && /^\s*@/.test(text)) {
      if (attach(text) && !imageDraft.current.images().length) clearDraft();
      return;
    }
    setLocalError(null);
    // send publishes synchronously after saving the user message.
    imageDraft.current.update(text);
    const sent = parsed.kind==='user-command'
      ? controller.sendUserCommand(parsed.text,imageDraft.current.images(),imageDraft.current.marks.map(mark=>mark.start))
      : controller.send(parsed.text,imageDraft.current.images(),imageDraft.current.marks.map(mark=>mark.start));
    if (controller.getSnapshot().busy) clearDraft();
    void sent;
  }

  function addImage(image:ImageRef){
    const field=editor.current;const text=field?.plainText??draft;imageDraft.current.update(text);
    const at=field?.cursorOffset??text.length;const marker=imageDraft.current.add(image,at);
    if(field){field.replaceText(imageDraft.current.text);field.cursorOffset=at+marker.length;}else draftPosition.current={text:imageDraft.current.text,cursor:at+marker.length,x:0,y:0,width};
    setDraft(imageDraft.current.text);setImageRevision(v=>v+1);
  }
  async function pickImage(){const session=state.session?.id;try{const path=await imageClipboardProgram("pick");if(path&&controller.getSnapshot().session?.id===session&&!controller.getSnapshot().busy)addImage(controller.imageStore().addFile(path));}catch(error){setLocalError((error as Error).message);}}
  function attach(text: string): boolean {
    const parsed = attachmentInput(text);
    if (!parsed) { setLocalError('use @"path with spaces" [start line] [line count], or /attach.'); return false; }
    return attachFile(parsed);
  }

  function attachFile(file: NonNullable<ReturnType<typeof attachmentInput>>): boolean {
    if(/\.(png|jpe?g|webp)$/i.test(file.path)){try{addImage(controller.imageStore().addFile(join(state.project,file.path)));return true;}catch(error){setLocalError((error as Error).message);return false;}}
    let attached = false;
    act(() => { controller.attachFile(file.path, file.startLine, file.limit); attached = true; });
    return attached;
  }

  const hint = (key: string, label: string, onClick?: () => void) =>
    <text key={key} height={1} wrapMode="none" onMouseDown={onClick}>
      <span fg={theme.accent}>{key}</span><span fg={theme.muted}>{` ${label}`}</span>
    </text>;
  const welcome = <box flexDirection="column" alignItems="center" justifyContent="center" flexShrink={0} minHeight={historyHeight}>
    <EdgeyLogo paused={isDialog} name="EDGEY" width={artWidth} height={artHeight} pointer={pointer} />
    {tall ? <text height={1} marginTop={1} fg={theme.accentBright} attributes={bold}>{"E D G E Y"}</text> : null}
    <text height={1} fg={theme.muted}>{`terminal client  ·  v${CLI_VERSION}`}</text>
    {tall ? <text height={1} marginTop={height >= 24 ? 1 : 0} fg={theme.text} attributes={bold}>what can i do for you?</text> : null}
    <box flexDirection="row" gap={3} marginTop={height >= 24 ? 1 : 0} flexShrink={0}>
      {hint("ctrl+p", "commands", () => command("palette"))}
      {artWidth >= 76 ? hint("ctrl+o", "models", () => command("models")) : null}
      {artWidth >= 76 ? hint("ctrl+s", "sessions", () => command("sessions")) : null}
      {hint("shift+enter", "new line")}
      {hint("esc", "stop")}
    </box>
  </box>;

  const strip = <box flexDirection="column" flexShrink={0} height={stripRows}>
    {tall ? <text height={1} wrapMode="none" fg={theme.accentDeep}>{"─".repeat(Math.max(1, width))}</text> : null}
    <box flexDirection="row" height={1} gap={2}>
      <text flexGrow={1} flexShrink={1} minWidth={0} height={1} wrapMode="none">
        <span fg={theme.text} attributes={bold}>{displayText(project)}</span>
      </text>
      <text id="context-meter" height={1} flexShrink={0} wrapMode="none" fg={contextFull ? theme.error : context && (contextPercent(context) ?? 0) >= 80 ? theme.warning : theme.muted}
        onMouseDown={() => { if (state.agent) command("context"); }}>{contextLabel}</text>
      {wide ? <text height={1} flexShrink={0} wrapMode="none">
        {state.agent?.enabled ? <span fg={state.agent.mode === "bypass" ? theme.warning : state.busy ? theme.warning : theme.muted}>{displayText(`${modeLabels[state.agent.mode]} · tab · ${status}`)}</span>
          : state.busy ? <span fg={theme.warning}>generating…  esc stop</span>
          : state.connection === "connecting" ? <span fg={theme.warning}>connecting…</span>
          : !tall ? <span fg={theme.muted}>{displayText(modelLabel(state.settings.model ?? "select model"))}</span>
          : <><span fg={theme.text}>{String(state.models.length)}</span><span fg={theme.muted}>{state.models.length === 1 ? " model  ·  " : " models  ·  "}</span>
            <span fg={theme.text}>{String(state.sessions.length)}</span><span fg={theme.muted}>{state.sessions.length === 1 ? " session" : " sessions"}</span></>}
      </text> : null}
    </box>
    {tall ? <text height={1} wrapMode="none">
      <span fg={theme.muted}>model </span><span fg={theme.text}>{displayText(modelLabel(state.settings.model ?? "select model"))}</span>
      {state.agent?.enabled&&state.settings.model&&state.settings.model!=="gpt-6-astra"?<span fg={theme.warning}> · unverified tools</span>:null}
      <span fg={theme.accent}>{`  ·  effort ${controller.getReasoningEffort() ?? "default"} · ctrl+t`}</span>
      <span fg={theme.muted}>  ·  profile </span><span fg={theme.text}>{displayText(profile)}</span>
      <span fg={theme.muted}>  ·  </span><span fg={theme.accent}>/models</span>
      {state.agent?.enabled ? <span fg={theme.muted}>  ·  ctrl+r transcript</span> : null}
    </text> : null}
    {selectedMarkdown ? <text id="instructions-active" height={1} wrapMode="none" fg={theme.info}
      onMouseDown={() => command("instructions")}>{displayText(`instructions: ${selectedMarkdown.name} · /instructions`)}</text> : null}
    {contextFull ? <text id="context-new-hint" height={1} wrapMode="none" fg={theme.warning}>/new · new chat, same project</text> : null}
  </box>;

  const footer = <box flexDirection="row" height={1} flexShrink={0} gap={2}>
    <text flexGrow={1} flexShrink={1} minWidth={0} height={1} wrapMode="none">
      <span fg={statusColor}>● </span>
      {current === "chat" && width >= 70 ? <>
        <span fg={theme.info}>{displayText(modelLabel(state.settings.model ?? status))}</span>
        <span fg={theme.muted}>{width >= 110 ? `  ·  ${requests ?? "?"} ${agentUsage === null ? "" : "agent "}${requests === 1 ? "request" : "requests"} this session  ·  key: ${keyMode}` : `  ·  key: ${keyMode}`}</span>
        {width >= 90 ? <><span fg={theme.muted}>  ·  </span><span fg={theme.accent}>/help</span></> : null}
      </> : <span fg={theme.muted}>{state.connection !== "connected" ? "connect your key to get started"
        : width >= 70 ? `${status}  ·  key: ${keyMode}` : width >= 50 ? status : ""}</span>}
    </text>
    <text height={1} flexShrink={0} wrapMode="none" fg={theme.muted}>{current === "chat"
      ? (width >= 140 ? "enter send  ·  shift+enter newline  ·  ctrl+p palette" : "enter send · shift+enter newline")
      : current === "approval" ? "enter never approves" : (wide ? "esc back  ·  ctrl+p palette" : "esc back")}</text>
  </box>;

  return <box width="100%" height="100%" backgroundColor={theme.background} flexDirection="column" paddingX={wide ? 2 : 1}
    onMouseMove={trackPointer} onMouseDrag={trackPointer}>
    {current !== "chat" && !isDialog ? <box flexDirection="row" height={1} flexShrink={0} gap={2}>
      <text flexGrow={1} minWidth={0} height={1} wrapMode="none">
        <span fg={theme.accent} attributes={bold}>edgey</span><span fg={theme.muted}>{displayText(`  ·  ${project}`)}</span>
      </text>
      <text height={1} wrapMode="none"><span fg={statusColor}>● </span><span fg={theme.muted}>{status}</span></text>
    </box> : null}
    {error && current !== "chat" && !isDialog ? <text fg={state.agent?.phase === "recovery_required" ? theme.warning : theme.error}
      onMouseDown={() => { if (state.agent?.phase === "recovery_required" && !pending) command("recover"); }}
      flexShrink={0} maxHeight={alertRows}>{displayText(error)}</text> : null}
    {state.notice ? <text fg={theme.muted} flexShrink={0} maxHeight={alertRows}>{displayText(state.notice)}</text> : null}
    <box flexGrow={1} minHeight={0} flexDirection="row" gap={2} opacity={isDialog?dialogBackdropOpacity:1} marginTop={current !== "chat" && !isDialog && tall ? 1 : 0}>
      <box flexGrow={1} minWidth={0} flexDirection="column">
        {current === "mcp" ? <McpView controller={controller}/> : null}
        {current === "key" ? <scrollbox flexGrow={1}><SecretField clipboard={clipboard} disabled={pending} onSubmit={(key, remember) => {
          void controller.connect(key, remember).then(() => {
            if (controller.getSnapshot().connection === "connected") setView("models");
          });
        }} /></scrollbox> : null}
        {current === "project" ? <box flexDirection="column" gap={1}>
          <text fg={theme.accent} attributes={bold}>open project</text>
          <box border borderStyle="rounded" borderColor={theme.accent} height={3} paddingX={1} backgroundColor={theme.background}>
          <input focused value={state.project} textColor={theme.text} backgroundColor={theme.background}
            focusedBackgroundColor={theme.background} onSubmit={(path) => { if (typeof path === "string") act(() => { controller.openProject(path); clearDraft(); setView(null); }); }} />
          </box>
          <text fg={theme.muted}>enter open directory · esc back</text>
        </box> : null}
        {current === "usage" ? agentUsage !== null ? <TextDetails key="agent-usage" title="usage · actual model requests" source={agentUsage}
          identity={`${state.session?.id}:usage`} positions={detailPositions.current} /> : <UsageView state={state} /> : null}
        {current === "profile" ? <ProfileView state={state} directory={profileDirectory ?? join(getDataDirectory(), "profiles")} /> : null}
        {current === "diagnostics" ? <Diagnostics controller={controller} clipboard={clipboard}/> : null}
        {current === "account" ? <AccountView controller={controller}/> : null}
        {current === "help" ? <HelpView agent={!!state.agent} /> : null}
        {current === "approval" && state.agent?.approval ? <ApprovalView key={state.agent.approval.toolId} approval={state.agent.approval} project={state.project} /> : null}
        {current === "agents" || current === "agent-detail" ? <AgentPages agents={childAgents} selected={current === "agents" ? null : selectedAgent}
          onSelect={(id) => { setSelectedAgent(id); setView(id === null ? "agents" : "agent-detail"); }} /> : null}
        {current === "draft-detail" && selectedDraft ? <DraftPage key={`${selectedDraft.draft.requestId}:${selectedDraft.draft.index}`}
          draft={state.agent?.events.find((event): event is ToolDraft => event.type === "tool_draft" && event.runId === selectedDraft.draft.runId && event.requestId === selectedDraft.draft.requestId && event.index === selectedDraft.draft.index) ?? selectedDraft.draft}
          initialFile={selectedDraft.file} positions={detailPositions.current} onOutput={() => command("output")} /> : null}
        {current === "agents" ? <box id="subagent-list" flexDirection="column" flexGrow={1} minHeight={0}>
          {selectedTask ? <text fg={theme.accent} flexShrink={0} maxHeight={2}>{displayText(`step · ${state.agent?.tasks.find((task) => task.id === selectedTask)?.title ?? selectedTask}`)}</text> : null}
          <text fg={theme.muted} flexShrink={0}>delegated work · enter inspect · ctrl+o recorded output</text>
          <Picker key="subagents" title="subagents · automatic delegation" height={availableHeight - (selectedTask ? 7 : 5)}
            items={childAgents.map((agent) => ({ id: agent.id, name: `${agent.title} · ${childStatus(agent)}`, description: modelLabel(agent.model) }))}
            onSelect={(id) => { setSelectedAgent(id); setView("agent-detail"); }} />
          {!selectedTask && !childAgents.length ? <text fg={theme.muted}>no delegated tasks in this run</text> : null}
           {selectedTask && !childAgents.length ? <text fg={theme.muted} flexShrink={0}>no subagent is attached to this step</text> : null}
        </box> : null}
        {current === "agent-detail" ? <SubagentDetails key={`${state.agent?.runId}:${selectedAgent}`} child={childAgent}
          identity={`${state.agent?.runId}:${selectedAgent}`} positions={detailPositions.current}
          onOutput={() => command("output")} /> : null}
        {current === "recover" ? <RecoveryView controller={controller} height={availableHeight} onBack={() => setView(null)} /> : null}
        {current === "skills" || current === "markdown" ? <UserInstructions controller={controller} height={availableHeight} skills={current === "skills"} onBack={()=>setView(null)}/> : null}
        {current === "instructions" ? <InstructionsView controller={controller} height={availableHeight} onBack={() => setView(null)} /> : null}
        {current === "output" ? <OutputView controller={controller} height={availableHeight} initialId={outputSelection?.id} onBack={() => {setView(outputSelection?.from??null);setOutputSelection(null);}} /> : null}
        {current === "transcript" ? <Transcript key={state.session?.id??"new"} controller={controller} state={state} onOutput={openOutput} positions={transcriptPositions.current} anchor={transcriptAnchor}/> : null}
        {current === "process-detail" && selectedJob ? <ProcessPage key={selectedJob} controller={controller} jobId={selectedJob} onBack={() => setView("jobs")} /> : null}
        {current === "jobs" ? <box id="agent-jobs" flexDirection="column" flexGrow={1} minHeight={0}>
          <Picker title="process jobs" items={(state.agent?.jobs ?? []).map((job) => ({ id: job.id,
            name: `${job.id} · ${job.status}${job.command ? ` · ${job.command}` : ""}` }))} height={availableHeight}
            onSelect={(id) => { setSelectedJob(id); setView("process-detail"); }}
            onStop={(id) => { void controller.stopAgentJob(id).catch(() => setLocalError("could not stop the selected job.")); }} />
        </box> : null}
        {current === "task-detail" && selectedTask ? <TextDetails title="task details" source={controller.getTaskDetails(selectedTask)} identity={`${state.agent?.runId}:${selectedTask}`} positions={detailPositions.current} /> : null}
        {current === "tasks" && state.agent ? <TaskSteps agent={state.agent} height={availableHeight}
          onTask={(id) => { setSelectedTask(id); setView("task-detail"); }} /> : null}
        {current !== "jobs" && current !== "tasks" && agentDetailViews.includes(current) ? <TextDetails key={current} title={current === "tools" ? "tools · expanded timeline and results" : current}
          source={controller.getAgentDetails(current as AgentDetailsView)} identity={`${state.session?.id}:${current}`} positions={detailPositions.current}
          hint={current === "undo" ? "ctrl+y prepare inverse review · esc back" : undefined} /> : null}
        {current === "attach" ? <AttachmentPicker controller={controller} value={attachmentPath} onInput={setAttachmentPath} height={availableHeight}
          onAttach={(file) => { if (!pending && attachFile(file)) { setAttachmentPath(""); setView(null); } }}
          onInvalid={() => setLocalError('use "path with spaces" [start line] [line count].')} /> : null}
        {current === "browser" ? <TextDetails title="ai browser" identity={`${state.session?.id}:browser`} positions={detailPositions.current} source={browserStatus} hint="ctrl+o open · ctrl+w close · ctrl+r refresh · esc back" /> : null}
        {current === "attachments" ? <TextDetails key="attachments" title="attached file snapshots" identity={`${state.session?.id}:attachments`} positions={detailPositions.current}
          source={(imageDraft.current.marks.map((mark,i)=>`${i+1}. ${imageDraft.current.text.slice(mark.start,mark.end)} · ${mark.image.name} · ${mark.image.width}×${mark.image.height} · ${mark.image.bytes} bytes`).join("\n")+"\n"+(state.agent?.attachments.map((file) => `${file.path} · sha256 ${file.hash}\n${file.content ?? "content unavailable"}`).join("\n\n") || "")).trim() || "no attachments"}
          hint="1–4 remove image · ctrl+d clear all when idle · esc back" /> : null}
        {current === "copy" ? <Picker key="copy" title="choose code · enter preview, then ctrl+y copy" items={blocks} height={availableHeight}
          onSelect={(id) => { const block = blocks.find((item) => item.id === id); if (block) { setCopyBlock(block); setCopyResult(null); setView("copy-preview"); } }} /> : null}
        {current === "copy-preview" && copyBlock ? <CopyPreview {...copyBlock} result={copyResult} /> : null}
        {current === "forget" ? <box flexDirection="column" gap={1}>
          <text fg={theme.accent} attributes={bold}>remove the key from the system credential store?</text>
          <text fg={theme.text}>enter remove and disconnect · esc cancel</text>
        </box> : null}
        {current === "chat" || isDialog ? <>
          <scrollbox id="conversation-history" key={state.session?.id ?? "new"} ref={history} flexGrow={1} minHeight={0} scrollY scrollX={false} stickyScroll
            stickyStart={bookmark.current?.session === state.session?.id && bookmark.current && !bookmark.current.bottom ? "top" : "bottom"} renderAfter={restoreHistory}>
            {start>0?<text id="history-earlier" fg={theme.info} onMouseDown={()=>{setHistoryEnd(start);history.current?.scrollTo(0);}}>↑ earlier messages</text>:null}
            {messageCount ? visibleMessages.map((message) => <box key={message.id} id={`message:${message.id}`}

              flexDirection="column" paddingBottom={1} flexShrink={0}>
              {message.role === "user"
                ? <text height={1} wrapMode="none"><span fg={theme.accent} attributes={bold}>› you</span></text>
                : message.status === "streaming" && state.busy && !state.userQuestion ? <Loading startedAt={message.createdAt} label={`${modelLabel(message.model??"assistant")} · ${state.agent?workLabel(state.agent,!!message.content):"generating"}`}/>
                : <text height={1} wrapMode="none"><span fg={theme.accent}>◆ </span><span fg={theme.muted}>{
                  displayText(`${modelLabel(message.model ?? "assistant")} · ${(message.privateMode || (message.profile?.id === "private-profile" && message.model === "gpt-6-astra")) ? "jailbreak ON · " : ""}${message.status === "streaming" ? state.agent ? workLabel(state.agent, !!message.content) : "generating" : message.status === "interrupted" ? "interrupted" : message.status === "error" ? "error" : "complete"}`)}</span></text>}
              {message.role === "assistant" && message.id === state.session?.messages.at(-1)?.id && state.agent?.tools.length
                ? <Activity tools={state.agent.tools} onDetails={() => command("transcript")} onOutput={openOutput}/> : null}
              {message.role === "assistant" && message.id === state.session?.messages.at(-1)?.id && state.agent?.enabled
                 ? <LiveWork agent={state.agent} onTasks={() => command("tasks")}
                   onTask={(id) => { setSelectedTask(id); setSelectedAgent(null); setView("task-detail"); }}
                   onAgents={() => { setSelectedTask(null); setView("agents"); }}
                   onAgent={(id) => { setSelectedTask(null); setSelectedAgent(id); setView("agent-detail"); }}
                   onDraft={(draft, file) => { setSelectedDraft({ draft, file }); setView("draft-detail"); }} /> : null}
              <box id={`message-body:${message.id}`} flexDirection="column" flexShrink={0}
              onMouseDown={event=>{if(current!=="chat")return;messageClick.current={id:message.id,x:event.x,y:event.y,dragged:false};}}
              onMouseDrag={()=>{if(messageClick.current)messageClick.current.dragged=true;}}
              onMouseUp={event=>{const click=messageClick.current;messageClick.current=null;if(current==="chat"&&click?.id===message.id&&!click.dragged&&click.x===event.x&&click.y===event.y&&!renderer.getSelection()?.getSelectedText())openMessage(message.id);}}
              >{!message.content && message.failure ? null : message.role === "assistant" && state.agent ? <AssistantMarkdown source={message.content} /> : <text fg={theme.text} wrapMode="word">{displayText(message.content) || "…"}</text>}</box>
              {message.failure ? <box id={`message-error:${message.id}`} flexDirection="column" border borderStyle="rounded" borderColor={theme.error} paddingX={1} flexShrink={0}>
                <text fg={theme.error}>work paused</text>
                <text fg={theme.text} wrapMode="word">{displayText(message.failure)}</text>
              </box> : null}
              {message.role === "assistant" ? <text fg={theme.muted}>{state.agent?.enabled && !message.usage ? "request reports · /usage" : usageLabel(message)}</text> : null}
             </box>) : welcome}
            {end<messageCount?<text id="history-later" fg={theme.info} onMouseDown={()=>{setHistoryEnd(Math.min(messageCount,end+40));history.current?.scrollTo(0);}}>↓ later messages · /bottom latest</text>:null}
            {error && (localError || state.session?.messages.at(-1)?.failure !== state.error) ? <box id="conversation-error" flexDirection="column" border borderStyle="rounded" borderColor={theme.error} paddingX={1} flexShrink={0}>
              <text fg={theme.error}>work paused</text><text fg={theme.text} wrapMode="word">{displayText(error)}</text>
            </box> : null}
          </scrollbox>
          {strip}
          {state.userQuestion ? <text id="agent-question" fg={theme.accent} flexShrink={0} maxHeight={3}>{displayText(`${state.userQuestion}\ntype your answer below · esc cancels`)}</text> : null}
          {showSuggestions ? <box id="command-suggestions" flexDirection="column" flexShrink={0} backgroundColor={theme.surface} paddingX={wide ? 2 : 1}>
            <text height={1} wrapMode="none" fg={theme.accent}>{`commands ${suggestions.length ? `${selectedSuggestion + 1}/${suggestions.length}` : "0"} · ↑↓ · tab${width >= 60 ? " complete · enter open" : " · enter"}`}</text>
            {suggestions.length ? suggestions.slice(suggestionStart, suggestionStart + suggestionRows).map((entry, index) =>
              <text key={entry.id} id={`command-suggestion:${entry.id}`} height={1} wrapMode="none"
                fg={suggestionStart + index === selectedSuggestion ? theme.accent : theme.text}
                onMouseDown={() => { if (!controller.getSnapshot().agent?.approval) chooseSuggestion(entry); }}>
                {`${suggestionStart + index === selectedSuggestion ? "›" : " "} ${entry.slash} — ${entry.name}`}
              </text>) : <text height={1} wrapMode="none" fg={theme.muted}>no command · /help · // for text</text>}
          </box> : null}
          <box id="message-composer" height={editorHeight + 2} flexShrink={0} border borderStyle="rounded" flexDirection="row" alignItems="flex-start"
            borderColor={state.busy ? theme.accentDeep : theme.accent} backgroundColor={theme.background} paddingX={1} renderAfter={restoreDraft}>
            <text height={1} width={3} flexShrink={0} fg={theme.accent} attributes={bold} selectable={false}>{" › "}</text>
            <textarea id="message-editor" ref={editor} key={state.session?.id ?? "new"} focused={current==="chat"&&!state.agent?.approval} initialValue={draft}
              flexGrow={1} height="100%" wrapMode="word" placeholder={state.userQuestion ? `answer: ${state.userQuestion}` : "ask something or type /help"}
              textColor={theme.text} backgroundColor={theme.background} focusedBackgroundColor={theme.background}
              cursorColor={theme.accent}
              keyBindings={[{ name: "return", action: "submit" }, { name: "kpenter", action: "submit" },
                { name: "return", shift: true, action: "newline" }, { name: "linefeed", action: "newline" }]}
              onContentChange={() => { if(editor.current)imageDraft.current.update(editor.current.plainText); setDraft(editor.current?.plainText ?? ""); setDismissedSuggestions(null); measureEditor(); }}
              onSubmit={submit} />
          </box>
        </> : null}
      </box>
      {hasSidebar ? <box width={26} flexShrink={0} border borderStyle="rounded" borderColor={theme.border} flexDirection="column" paddingX={1}>
        <text fg={theme.accent} attributes={bold}>sessions · ctrl+s</text>
        <scrollbox flexGrow={1}>
          {state.sessions.map((session) => <text key={session.id} height={1} wrapMode="none"
             onMouseDown={() => { if (!pending && session.id !== state.session?.id) act(() => { controller.resumeSession(session.id); markSessionChange(); clearDraft(); setView(null); }); }}>
            <span fg={session.id === state.session?.id ? theme.accent : theme.border}>{session.id === state.session?.id ? "› " : "  "}</span>
            <span fg={session.id === state.session?.id ? theme.text : theme.muted}>{displayText(session.title)}</span>
          </text>)}
          {state.agent?.enabled ? <>
            <text fg={theme.accent}>changed / proposed paths</text>
            {paths.length ? paths.map((path) => <text key={path} height={1} wrapMode="none" fg={theme.muted}>{displayText(path)}</text>) : <text fg={theme.muted}>none recorded</text>}
            <text fg={theme.accent}>tasks · /tasks</text>
            {state.agent.tasks.map((task) => <text key={task.id} fg={theme.muted}
              onMouseDown={() => { setSelectedTask(task.id); setView("task-detail"); }}>{displayText(`${task.status} · ${task.title}`)}</text>)}
          </> : null}
        </scrollbox>
      </box> : null}
    </box>
    {isDialog?<Dialog desiredHeight={desiredDialogHeight} onClose={()=>{if(current!=="replace-draft")setView(null);}}>
        {current === "models" ? <Picker key="models" title="select model · ctrl+r refresh" items={models} height={modalHeight}
          onFavorite={(id) => act(() => controller.toggleFavorite(id))}
          onSelect={(id) => { setLocalError(null); try { void Promise.resolve(controller.selectModel(id)).then(()=>setView(controller.getSnapshot().session ? "chat" : "project")).catch(()=>{}); } catch { /* controller publishes the selection error */ } }} /> : null}
        {current === "sessions" ? <Picker key="sessions" title="project sessions" items={sessions} height={modalHeight}
          onSelect={(id) => act(() => { controller.resumeSession(id); markSessionChange(); clearDraft(); setView(null); })}
          onDelete={(id) => act(() => { if (id === state.session?.id) { bookmark.current = null; clearDraft(); } controller.deleteSession(id); })} /> : null}
        {current === "palette" ? <Picker key="commands" title="commands · /help" items={availableCommands.map((entry) => ({
          id: entry.id, name: `${entry.slash} — ${entry.name}`, description: entry.shortcut,
        }))} height={modalHeight} onSelect={command} /> : null}
        {current === "mode" ? <Picker key="agent-mode" title={`agent mode · ${modeLabels[state.agent?.mode ?? "chat"]}`} items={agentModes} height={modalHeight}
          onSelect={(mode) => act(() => { controller.setAgentMode(mode as AgentMode); setView(null); })} /> : null}
        {current === "effort" ? <box flexDirection="column" flexGrow={1} minHeight={0}>
          {!controller.getReasoningEfforts().length ? <text fg={theme.muted}>no declared effort levels for this model</text> : null}
          <Picker title={`reasoning effort · ${controller.getReasoningEffort() ?? "default"}`} height={modalHeight}
            items={[{ id: "default", name: "default · let the api choose" }, ...controller.getReasoningEfforts().map((level) => ({ id: level, name: level }))]}
            onSelect={(level) => act(() => { controller.setReasoningEffort(level === "default" ? undefined : level as ReasoningEffort); setView(null); })} />
        </box> : null}
      {current==="messages"?<Picker title="messages · select to open actions" height={modalHeight} items={(state.session?.messages??[]).map(message=>({id:message.id,name:`${message.role=== "user"?"you":"assistant"} · ${message.content.replace(/\s+/g," ").slice(0,100)}`}))} onSelect={openMessage}/>:null}
      {current==="message-actions"&&selectedMessageRecord?<Picker title={selectedMessageRecord.role==="user"?"prompt actions":"response actions"} height={modalHeight} onSelect={messageAction} items={[
        {id:"copy",name:"copy message"},
        ...(selectedMessageRecord.role==="user"?[{id:"edit",name:"edit and resend",disabled:pending},{id:"send",name:"send again",description:"new message here · current model and settings",disabled:pending}]:markdownParts(selectedMessageRecord.content).flatMap((part,index)=>part.kind==="code"?[{id:`code:${index}`,name:`copy code · ${part.language||"text"}`}]:[])),
        {id:"transcript",name:"show in transcript"},
      ]}/>:null}
      {current==="replace-draft"?<Picker title="replace your current draft?" height={modalHeight} items={[{id:"cancel",name:"keep current draft"},{id:"replace",name:"replace with selected prompt"}]} onSelect={action=>action==="replace"?messageAction("replace"):setView(null)}/>:null}
      {copyResult?<text fg={theme.info} flexShrink={0} maxHeight={2}>{copyResult}</text>:null}
      {pending&&["message-actions","messages"].includes(current)?<text fg={theme.muted} flexShrink={0}>copy and inspect available · sending waits for the current task</text>:null}
    </Dialog>:null}
    {copyResult&&!isDialog?<text fg={theme.info} height={1} flexShrink={0}>{copyResult}</text>:null}
    {footer}
  </box>;
}
