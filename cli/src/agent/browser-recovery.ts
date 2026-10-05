import type { Run, ToolExecution } from '../types';

const browserActions = new Set(['browser_open','browser_click','browser_fill','browser_select','browser_key','browser_scroll','browser_close_tab']);
export const isBrowserAction = (name:string) => browserActions.has(name);
export function onlyUnknownBrowserActions(tools:readonly ToolExecution[]):boolean {
  const pending=tools.filter(tool=>!['succeeded','failed','denied','cancelled'].includes(tool.status));
  return pending.length>0&&pending.every(tool=>tool.status==='outcome_unknown'&&isBrowserAction(tool.name));
}
export function parkedBrowserRun(run:Run):boolean {
  return run.status==='failed'&&!run.ownerId&&!!run.metadata&&typeof run.metadata==='object'&&!Array.isArray(run.metadata)&&run.metadata.browserRecoveryParked===true;
}
export const browserUncertaintyNotice = 'a previous browser action has an unknown outcome. it may have completed. its original record is preserved; do not replay it or assume failure. inspect the current page/state before proposing further actions. further effects require explicit approval, including in bypass mode.';
