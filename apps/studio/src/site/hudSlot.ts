/**
 * The hall HUD's bottom-centre slot (the Viewer's `hud.bottom`), handed from the island's world to the
 * site's pieces: the hall's timeline bar is drawn there (`createPortal(<HallTimeline …/>, slot)`), so it
 * sits in the HUD's layout (clear of the Chronicle and the sheet, hidden with the HUD, under the
 * loading cover). Null off a hall, and until its island is built.
 */
let slot: HTMLElement | null = null

export function setHudBottom(next: HTMLElement | null): void {
  slot = next
}

export const hudBottom = (): HTMLElement | null => slot
