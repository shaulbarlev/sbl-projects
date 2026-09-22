type Attrs = Record<string, string | number | boolean | undefined>
type Child = Node | string | null | undefined | false

/** Tiny createElement helper: h('a', { href: '/' }, 'home') */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    if (k === 'class') el.className = String(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false))
  return el
}
