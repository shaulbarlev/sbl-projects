export type Lamp = { color: string; on: boolean }
export function host(frame: HTMLIFrameElement, cover: HTMLElement, onLayout: (layout: { height: number; lamps?: Lamp[] }) => void): void
export function guest(): void
