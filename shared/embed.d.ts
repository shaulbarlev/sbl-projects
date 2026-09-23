export type Lamp = { color: string; on: boolean }
export type Box = { x: number; y: number; w: number; h: number }
export function host(frame: HTMLIFrameElement, cover: HTMLElement, onLayout: (layout: { height: number; box?: Box; lamps?: Lamp[]; off?: boolean }) => void, onTap?: () => void): void
export function guest(): void
