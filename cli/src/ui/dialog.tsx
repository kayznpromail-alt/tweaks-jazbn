import type { ReactNode } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme";

export function dialogSize(width:number,height:number,desiredHeight=24){return {width:Math.max(1,Math.min(76,width-2)),height:Math.max(1,Math.min(24,height-2,Math.max(10,desiredHeight)))};}
export function Dialog({children,onClose,desiredHeight}:{children:ReactNode;onClose:()=>void;desiredHeight?:number}) {
  const screen=useTerminalDimensions(),size=dialogSize(screen.width,screen.height,desiredHeight);
  return <box id="dialog-overlay" position="absolute" left={0} top={0} width="100%" height="100%" zIndex={100} onMouseDown={event=>{event.stopPropagation();event.preventDefault();onClose();}}>
    <box id="centered-dialog" position="absolute" left={Math.floor((screen.width-size.width)/2)} top={Math.floor((screen.height-size.height)/2)}
      width={size.width} height={size.height} border borderStyle="rounded" borderColor={theme.border} backgroundColor={theme.background} paddingX={1} flexDirection="column"
      onMouseDown={event=>event.stopPropagation()} onMouseUp={event=>event.stopPropagation()}>
      {children}
    </box>
  </box>;
}
