# Brackenridge — Two Lives

An **original, 3D, open‑world browser game** set in the fictional school‑town of
**Brackenridge**. One persistent world, one player character, a living NPC/social
simulation, and **two full storylines** — a **Student** life and a **Gangster**
life — spanning **100 data‑driven missions (50 + 50)**.

Built from scratch with **Three.js + vanilla JavaScript (ES modules)**. All art,
characters, dialogue, missions, and audio are original and procedurally/geometry
generated — no copyrighted game assets are used.

---

## ▶ How to play (easiest first)

The game is pure HTML/JS and loads Three.js from a CDN, so there is **nothing to
build**. You only need to serve the folder over `http://` (opening the file
directly with `file://` will not work because browsers block ES‑module imports on
`file://`).

### Option A — Python (already on most computers)
1. Open a terminal in this folder.
2. Run:
   ```
   python3 -m http.server 8080
   ```
3. Open your browser at **http://localhost:8080**

### Option B — Node
```
npm start
```
(That runs `npx serve` on port 8080 — just open the printed URL.)

### Option C — VS Code
Install the **“Live Server”** extension, right‑click `index.html` → **Open with Live Server**.

Then **click the game screen** to lock the mouse and start playing.

---

## 🎮 Controls

| Action | Key |
|---|---|
| Move | `W A S D` / Arrow keys |
| Sprint | `Shift` (uses stamina) |
| Jump | `Space` |
| Look | Mouse (click screen to lock) |
| Attack | `Left‑Click` or `F` |
| Interact / Enter building / Talk | `E` |
| Enter / exit vehicle | `V` |
| Quick items | `1` Medkit · `2` Burger · `3` Energy · `4` Soda |
| Pause / Menu | `Tab` or `Esc` |
| Map | `M` |
| Dialogue choices | Click, or number keys `1‑6` |

> **Start the stories:** talk to **Devon** (around the school) for the 🎓 Student
> storyline, or **Rosa** (at the diner) for the 🔫 Gangster storyline. A ⭐ on the
> talk prompt means that NPC has a mission for you.

---

## 🌆 What’s in the game

**World & exploration**
- Fully explorable 3D town: school campus, downtown shops, park, skatepark,
  basketball court, residential street, docks/warehouse district, alleys,
  bank, town hall, a clock tower, and more.
- **11 enterable interiors** with real gameplay (shops, gym, arcade, your home,
  the diner, the pawn shop, the warehouse…).
- **Day/night cycle**, dynamic sky & lighting, and **rain weather**.
- **12 hidden collectible “Brackenridge Secrets.”**

**Characters & simulation**
- Named NPCs with **daily schedules/routines** (they walk to school, work, the
  park, home by time of day) plus an **ambient crowd**.
- **Dialogue system** whose greetings change with your relationship tier.
- **Social sim**: every important NPC tracks **Friendship, Trust, Respect,
  Rivalry, Fear, and Affinity**, and remembers how you treat them.
- **Romance** with age‑appropriate peers (asking out, gifts, dates, milestones).
- **Multi‑track reputation**: Overall, School, Student, Teacher/Staff, Street,
  Eastside Kings, North Market, and Police Heat.
- **Factions** (Eastside Kings, North Market Crew, Hall Cliques, Police) with
  rivalries — helping one can anger another.

**Systems**
- Third‑person character controller (walk/run/jump/attack) with collision.
- **Combat** with melee weapons (fists, bat, crowbar, stun baton, …).
- **Drivable vehicles** + arcade driving.
- **Economy**: earn/spend money, dynamic prices that react to reputation.
- **Inventory**, equippable weapons & gear, consumables.
- **Character progression**: XP, levels, growing health/stamina.
- **Police response / wanted system** — attack civilians and the heat comes.
- **Mission framework**: 100 chained missions with objectives (go to, talk,
  defeat, collect, deliver), waypoints, tracker, and rewards that feed back into
  money/rep/relationships (shared persistent world).
- **Save/Load** (localStorage, plus autosave), **pause & settings menus**,
  **HUD, minimap, full map, notifications**, and a self‑contained
  **procedural audio** engine (music + SFX, no audio files needed).

**Performance options** (Settings tab)
- Low / Medium / High presets (shadows, draw distance, NPC simulation count).
- Adjustable render‑resolution scale, pixel‑ratio clamping.
- Distance culling & fog, instanced geometry for trees/lamps, efficient NPC LOD.

---

## 📁 Project structure

```
My-First-Web-Game/
├── index.html                # entry page (loads Three.js via importmap CDN)
├── package.json              # optional: `npm start` static server
├── README.md
└── src/
    ├── main.js               # bootstraps the Game
    ├── config.js             # tunables, graphics presets, colors
    ├── core/
    │   ├── Input.js          # keyboard + mouse (pointer lock)
    │   ├── SaveManager.js    # localStorage save/load + settings
    │   └── Audio.js          # procedural Web Audio music & SFX
    ├── data/                 # DATA-DRIVEN content
    │   ├── world.js          # locations, buildings, interiors, shops
    │   ├── npcs.js           # named NPCs + schedules, ambient styles
    │   ├── items.js          # item catalog
    │   ├── factions.js       # factions + reputation tracks
    │   ├── missions.js       # 100 missions (50 student + 50 gangster)
    │   └── dialogue.js       # relationship-aware dialogue lines
    ├── world/
    │   └── TownBuilder.js    # builds all 3D geometry, colliders, doors
    ├── entities/
    │   ├── Character.js      # blocky humanoid model + walk animation
    │   ├── Player.js         # third-person controller + physics
    │   ├── NPC.js            # NPC AI (schedules, wander, enemy combat)
    │   └── Vehicle.js        # drivable car
    ├── systems/
    │   ├── GameState.js      # money, inventory, rep, relationships, XP, save
    │   ├── CameraController.js
    │   ├── Combat.js
    │   ├── NPCManager.js     # crowd spawn, LOD, enemy/cop spawning
    │   ├── MissionManager.js # objective engine, rewards, unlocking
    │   └── DialogueManager.js
    ├── ui/
    │   ├── UI.js             # HUD, menus, dialogue, shop, minimap, map
    │   └── style.css
    └── Game.js               # main loop wiring everything together
```

---

## 🧩 Extending the game (data‑driven)

The architecture is built to grow without rewrites. Most content is data:

- **Add a mission** → append an entry to the `STUDENT` or `GANG` array in
  `src/data/missions.js` (objectives use the `goto/talk/defeat/collect/deliver`
  helpers). It auto‑chains and unlocks in order.
- **Add an NPC** → add to `src/data/npcs.js` with a `schedule`.
- **Add a place/building/interior/shop** → edit `src/data/world.js`.
- **Add items** → `src/data/items.js`. **Dialogue** → `src/data/dialogue.js`.

---

## 🛠 Development phases (roadmap this codebase follows)

- **Phase 1 ✔** Core engine, third‑person controller, camera, world, collision, save.
- **Phase 2 ✔** Full explorable town, interiors, interaction & NPC framework.
- **Phase 3 ✔** Combat, vehicles, economy, inventory, reputation, relationships, factions.
- **Phase 4 ✔** Mission framework + both storylines’ arcs playable end‑to‑end.
- **Phase 5 ▲ ongoing** All 100 missions are defined and playable through the
  objective engine; content depth (bespoke set‑pieces, extra activities, cutscene
  scripting, more secrets) is where future polish plugs in via the data files.

---

## Notes

- Your progress **autosaves** every ~60 seconds and when you **Rest** at home;
  you can also Save/Load from the pause menu.
- If the screen is blank, make sure you opened it via `http://localhost:...`
  (not `file://`) and that your browser can reach the Three.js CDN (unpkg.com).

MIT‑licensed original work. Have fun in Brackenridge.
