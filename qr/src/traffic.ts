/**
 * The traffic light: two lamps, top to bottom, each one switch at home.
 *
 * Fixed on purpose. The agent at home carries the same allowlist, so a
 * compromised Worker can still only reach these two switches, and only to
 * toggle them.
 */
export const LIGHTS = [
  { entity: 'switch.traffic_1_power1', label: 'Green', color: '#22c55e' },
  { entity: 'switch.tasmota', label: 'Orange', color: '#f59e0b' },
] as const;

/**
 * The party button under the light: one input_boolean at home. Shown only
 * while its own switch is on, and tappable only then.
 */
export const PARTY = { entity: 'input_boolean.party', label: 'Party', color: '#e879f9' } as const;

export const LIGHT_ENTITIES: ReadonlySet<string> = new Set(LIGHTS.map((l) => l.entity));
/** Everything a tap may name: the lamps and the party button. */
export const HOME_ENTITIES: ReadonlySet<string> = new Set([...LIGHT_ENTITIES, PARTY.entity]);
