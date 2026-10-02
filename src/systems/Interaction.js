// ---------------------------------------------------------------------------
// Contextual interaction system.
//
// Systems register "providers" that describe what can be interacted with near
// the player (doors, shop counters, vehicles, NPCs, ladders, pickups…).
// Every frame the best candidate is chosen by distance *and* how directly the
// player is facing it, so standing between a door and an NPC always picks the
// one you are looking at.
// ---------------------------------------------------------------------------

export class InteractionSystem {
  constructor() {
    this.providers = [];
    this.candidates = [];
    this.current = null;
    this.lastLabel = null;
  }

  /** @param {(ctx, out:Array) => void} fn */
  addProvider(fn) { this.providers.push(fn); return fn; }

  clear() { this.providers.length = 0; }

  /**
   * @param {object} ctx { player, camYaw, blocked }
   */
  update(ctx) {
    const out = this.candidates;
    out.length = 0;
    if (ctx.blocked) { this.current = null; return null; }

    for (const p of this.providers) {
      try { p(ctx, out); } catch (e) { console.warn('interaction provider failed', e); }
    }

    const pos = ctx.player.pos;
    const fx = Math.sin(ctx.player.rot), fz = Math.cos(ctx.player.rot);
    let best = null, bestScore = Infinity;

    for (const c of out) {
      const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z;
      const dy = (c.pos.y ?? pos.y) - pos.y;
      const dist = Math.hypot(dx, dz);
      const range = c.range ?? 3.0;
      if (dist > range) continue;
      if (Math.abs(dy) > (c.vertical ?? 2.6)) continue;

      const inv = dist > 0.001 ? 1 / dist : 0;
      const facing = dist < 0.4 ? 1 : (dx * inv) * fx + (dz * inv) * fz;
      if (facing < (c.minFacing ?? -0.45)) continue;

      // lower = better: near + in front + explicit priority bonus
      const score = dist * (1.5 - facing * 0.5) - (c.priority ?? 0) * 1.2;
      if (score < bestScore) { bestScore = score; best = c; c.dist = dist; }
    }

    this.current = best;
    return best;
  }

  /** Fire the current interaction if its key was pressed. */
  tryTrigger(input) {
    const c = this.current;
    if (!c || !c.action) return false;
    const key = c.key || 'interact';
    if (input.pressed(key)) { c.action(); return true; }
    return false;
  }

  /** HTML prompt for the HUD, or null. */
  prompt() {
    const c = this.current;
    if (!c) return null;
    const key = c.keyLabel || (c.key === 'vehicle' ? 'V' : c.key === 'jump' ? 'Space' : 'E');
    return `<b>${key}</b> ${c.label}${c.badge ? ' ' + c.badge : ''}`;
  }
}
