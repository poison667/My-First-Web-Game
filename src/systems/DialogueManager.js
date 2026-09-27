import { DIALOGUE, GENERIC_GREETINGS } from '../data/dialogue.js';
import { NPCS } from '../data/npcs.js';
import { ITEMS } from '../data/items.js';

// Drives conversations: relationship-aware greetings + contextual actions
// (chat, gift, romance, start/advance missions). Data-driven from dialogue.js.
export class DialogueManager {
  constructor(state, ui, audio) {
    this.state = state;
    this.ui = ui;
    this.audio = audio;
    this.missions = null;     // set by Game
    this.open = false;
    this.onClose = null;
  }

  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  greeting(npcId) {
    const tier = this.state.relTier(npcId);
    const d = DIALOGUE[npcId];
    if (d && d.greetings) {
      const line = d.greetings[tier] || d.greetings.neutral || Object.values(d.greetings)[0];
      if (line) return this.pick(line);
    }
    return this.pick(GENERIC_GREETINGS);
  }

  // Start a conversation with a named NPC.
  talk(npcId) {
    const def = NPCS[npcId];
    if (!def) { // ambient
      this.ui.showDialogue({ name: 'Local', emoji: '🧑', color: '#888',
        text: this.pick(GENERIC_GREETINGS), choices: [{ label: 'Leave', cb: () => this.close() }] });
      this._begin();
      return;
    }
    this.state.addRel(npcId, {}); // mark met
    this._begin();

    // Mission context
    const talkObj = this.missions?.pendingTalk(npcId);
    if (talkObj) { this._missionTalk(npcId, def, talkObj); return; }

    this._mainMenu(npcId, def);
  }

  _missionTalk(npcId, def, obj) {
    const line = obj.objective.text || 'We need to talk.';
    this.ui.showDialogue({
      name: def.name, emoji: def.emoji, color: this._hex(def.color),
      text: `${line}`,
      relText: this._relText(npcId),
      choices: [
        { label: 'Continue ▶', cb: () => { this.missions.completeTalk(npcId); this.close(); } },
      ],
    });
  }

  _mainMenu(npcId, def) {
    const choices = [];

    // Start a mission if this NPC gives one that's available
    const avail = this.missions?.availableFrom(npcId);
    if (avail) {
      const tag = avail.line === 'student' ? '🎓' : '🔫';
      choices.push({ label: `${tag} [Mission] ${avail.title}`, cb: () => this._offerMission(npcId, def, avail) });
    }

    choices.push({ label: '💬 Chat', cb: () => this._chat(npcId, def) });

    // Gifts
    const gifts = Object.keys(this.state.inventory).filter(id => ITEMS[id]?.affinity);
    if (gifts.length) choices.push({ label: '🎁 Give a gift', cb: () => this._giftMenu(npcId, def, gifts) });

    // Romance
    if (def.romance) {
      const aff = this.state.rel(npcId).affinity;
      if (this.state.romance === npcId) {
        choices.push({ label: '❤ Spend time together', cb: () => this._date(npcId, def) });
      } else if (aff >= 40 && !this.state.romance) {
        choices.push({ label: '💘 Ask them out', cb: () => this._askOut(npcId, def) });
      }
    }

    // Shop
    if (def.shop) choices.push({ label: '🛒 Shop', cb: () => { this.close(); this.onShop && this.onShop(def.shop); } });

    choices.push({ label: 'Leave', cb: () => this.close() });

    this.ui.showDialogue({
      name: def.name, emoji: def.emoji, color: this._hex(def.color),
      text: this.greeting(npcId), relText: this._relText(npcId), choices,
    });
  }

  _offerMission(npcId, def, m) {
    this.ui.showDialogue({
      name: def.name, emoji: def.emoji, color: this._hex(def.color),
      text: m.desc, relText: this._relText(npcId),
      choices: [
        { label: '✅ Accept', cb: () => { this.missions.start(m.id); this.close(); } },
        { label: '↩ Not now', cb: () => this._mainMenu(npcId, def) },
      ],
    });
  }

  _chat(npcId, def) {
    const d = DIALOGUE[npcId];
    const line = d && d.chat ? this.pick(d.chat) : this.pick(GENERIC_GREETINGS);
    this.state.addRel(npcId, { friendship: 2, affinity: def.romance ? 2 : 1, trust: 1 });
    this.audio.ui();
    this.ui.showDialogue({
      name: def.name, emoji: def.emoji, color: this._hex(def.color),
      text: line, relText: this._relText(npcId),
      choices: [ { label: '↩ Back', cb: () => this._mainMenu(npcId, def) }, { label: 'Leave', cb: () => this.close() } ],
    });
  }

  _giftMenu(npcId, def, gifts) {
    const choices = gifts.map(id => ({
      label: `${ITEMS[id].icon} ${ITEMS[id].name} (+${ITEMS[id].affinity})`,
      cb: () => this._give(npcId, def, id),
    }));
    choices.push({ label: '↩ Back', cb: () => this._mainMenu(npcId, def) });
    this.ui.showDialogue({ name: def.name, emoji: def.emoji, color: this._hex(def.color),
      text: 'Is that... for me?', relText: this._relText(npcId), choices });
  }

  _give(npcId, def, itemId) {
    if (!this.state.removeItem(itemId, 1)) return;
    const aff = ITEMS[itemId].affinity || 5;
    this.state.addRel(npcId, { affinity: aff, friendship: Math.round(aff / 2), trust: 2 });
    this.audio.confirm();
    this.ui.notify(`Gave ${ITEMS[itemId].name} to ${def.name} (+${aff} affinity)`, 'good');
    this.ui.showDialogue({ name: def.name, emoji: def.emoji, color: this._hex(def.color),
      text: 'Thank you, that really means a lot.', relText: this._relText(npcId),
      choices: [ { label: '↩ Back', cb: () => this._mainMenu(npcId, def) }, { label: 'Leave', cb: () => this.close() } ] });
  }

  _askOut(npcId, def) {
    this.state.romance = npcId;
    this.state.addRel(npcId, { affinity: 15, friendship: 10, trust: 8 });
    this.audio.confirm();
    this.ui.notify(`You and ${def.name} are now together! 💞`, 'good');
    this.ui.showDialogue({ name: def.name, emoji: def.emoji, color: this._hex(def.color),
      text: "Yes! I'd love that. Let's make it official.", relText: this._relText(npcId),
      choices: [ { label: 'Leave', cb: () => this.close() } ] });
  }

  _date(npcId, def) {
    this.state.addRel(npcId, { affinity: 5, friendship: 3, trust: 2 });
    this.audio.ui();
    this.ui.showDialogue({ name: def.name, emoji: def.emoji, color: this._hex(def.color),
      text: "Being with you is the best part of my day.", relText: this._relText(npcId),
      choices: [ { label: 'Leave', cb: () => this.close() } ] });
  }

  _relText(npcId) {
    const r = this.state.rel(npcId);
    return `Friend ${r.friendship} · Trust ${r.trust} · Respect ${r.respect} · Rival ${r.rivalry}` + (NPCS[npcId]?.romance ? ` · ♥ ${r.affinity}` : '');
  }

  _hex(n) { return '#' + n.toString(16).padStart(6, '0'); }

  _begin() { this.open = true; }
  close() {
    this.open = false;
    this.ui.hideDialogue();
    this.onClose && this.onClose();
  }
}
