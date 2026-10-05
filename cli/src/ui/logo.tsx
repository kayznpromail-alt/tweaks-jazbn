import { StyledText, fg, type TextRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { logoPointerAngles, renderEdgey } from "./logo-model";
import { logoPalette, theme } from "./theme";

export type LogoPointer = { x: number; y: number };

// the resting pose turns the word slightly so its extrusion shows before the pointer moves.
const restYaw = -0.32, restPitch = 0.24;

function styleLogo(frame: string): StyledText {
  return new StyledText((frame.match(/@+|0+|o+|#+|%+|[^@0o#%]+/g) ?? []).map((run) => {
    const color = logoPalette[run[0] as keyof typeof logoPalette];
    return fg(color ?? theme.accentBright)(run);
  }));
}

export function EdgeyLogo({ width, height, pointer, name = "EDGEY", paused = false }: {
  paused?: boolean;
  name?: string;
  width: number;
  height: number;
  pointer: RefObject<LogoPointer | null>;
}) {
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const text = useRef<TextRenderable>(null);
  const angles = useRef({ yaw: restYaw, pitch: restPitch });
  const initial = useMemo(() => styleLogo(renderEdgey(width, height, angles.current.yaw, angles.current.pitch, name)), [width, height, name]);

  useEffect(() => {
    if(paused)return;
    let pending = 0;
    let previous = "";
    const tick = async (deltaMs: number) => {
      const node = text.current;
      if (!node || node.isDestroyed) return;
      const delta = Number.isFinite(deltaMs) ? Math.max(0, Math.min(deltaMs, 100)) : 0;
      pending += delta;
      if (previous && pending < 1000 / 30) return;
      const cursor = pointer.current;
      const { yaw, pitch } = cursor ? logoPointerAngles(cursor.x, cursor.y, terminal.width, terminal.height)
        : { yaw: restYaw, pitch: restPitch };
      const mix = 1 - Math.exp(-pending / 70);
      pending = 0;
      if (previous && angles.current.yaw === yaw && angles.current.pitch === pitch) return;
      angles.current.yaw += (yaw - angles.current.yaw) * mix;
      angles.current.pitch += (pitch - angles.current.pitch) * mix;
      if (Math.abs(yaw - angles.current.yaw) < 0.004) angles.current.yaw = yaw;
      if (Math.abs(pitch - angles.current.pitch) < 0.004) angles.current.pitch = pitch;
      const frame = renderEdgey(width, height, angles.current.yaw, angles.current.pitch, name);
      // update only the artwork; animation must not rerender the composer or history.
      if (frame !== previous) node.content = styleLogo(frame);
      previous = frame;
    };
    renderer.setFrameCallback(tick);
    renderer.requestLive();
    return () => {
      renderer.removeFrameCallback(tick);
      renderer.dropLive();
    };
  }, [height, pointer, renderer, terminal.width, terminal.height, width, name, paused]);

  return <text id="edgey-logo" ref={text} width={width} height={height} flexShrink={0}
    fg={theme.accentBright} selectable={false} wrapMode="none" content={initial} />;
}
