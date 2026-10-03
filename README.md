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

**Movement**

| Action | Key |
|---|---|
| Move | `W A S D` / Arrow keys |
| Sprint | `Shift` (uses stamina) |
| Walk (slow, quiet) | `Alt` |
| Crouch | `Ctrl` (hold) or `C` (toggle) |
| Slide | `Ctrl` while sprinting — fits under pipes and barriers |
| Jump | `Space` |
| Vault / climb a ledge | `Space` facing the obstacle — or just run into low cover |
| Jump out of a slide | `Space` mid‑slide |
| Climb a ladder | `E` at the ladder, `W`/`S` to move, `Space` to drop off |
| Catch a ledge | automatic when you fall past a lip you can reach |
| Shimmy / climb up / let go | `A`/`D` · `Space` or `W` · `S` |

**Camera**

| Action | Key |
|---|---|
| Look | Mouse (click the screen to lock the pointer) |
| Zoom the camera in/out | Mouse wheel |
| Swap shoulder | `Q` |

**Combat & interaction**

| Action | Key |
|---|---|
| Melee combo | `F` or `Left‑Click` (unarmed: jab → cross → hook → kick) |
| Draw / holster firearm | `G` |
| Aim | `Right‑Click` (hold, or toggle in Settings) |
| Fire | `Left‑Click` while the weapon is drawn |
| Reload | `R` |
| Interact / enter building / talk / pick up | `E` |
| Enter / exit vehicle | `V` |
| Quick items | `1` Medkit · `2` Burger · `3` Energy · `4` Soda |
| Pause / Menu | `Tab` or `Esc` |
| Map | `M` |
| Dialogue choices | Click, or number keys `1‑6` |

**Driving**

| Action | Key |
|---|---|
| Get in / get out | `V` (you must be nearly stopped to get out) |
| Throttle / brake / reverse | `W` / `S` — `S` brakes first, reverses once stopped |
| Steer | `A` `D` |
| Handbrake | `Space` — locks the rear axle, swings the back out |
| Change gear manually | `Z` down · `X` up (takes the gearbox out of automatic) |
| Horn | `H` |
| Headlights | `L` (they come on by themselves at night) |
| Siren | `B` (emergency vehicles only) |
| Refuel at a pump | `E` while stopped on the forecourt |

**Gamepad** (plug one in and it takes over automatically): left stick move,
right stick look, `A` jump, `B` crouch, `X` melee, `Y` interact, `LB`
draw/holster, `RB` enter/exit vehicle, `LT` aim, `RT` fire, `L3` sprint,
`R3` swap shoulder, `D‑pad ←` reload, `D‑pad ↓` walk, `Back` map, `Start` menu.

The strip at the bottom of the screen always shows what the character is doing
(`IDLE`, `WALKING`, `RUNNING`, `SPRINTING`, `CROUCHED`, `SNEAKING`, `JUMPING`,
`FALLING`, `SLIDING`, `VAULTING`, `CLIMBING`, `HANGING`, `SHIMMYING`, `AIMING`,
`DRIVING`) and turns red when you
are out of breath. The one‑line key reminder under it fades out after a minute —
the full list lives in the pause menu.

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
- **16 drivable vehicles** — cars, motorcycles, trucks, vans, buses and
  emergency services, each with its own engine, gearbox, grip, fuel tank and
  damage model. See [Driving](#-driving).
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
    │   ├── Input.js          # action bindings: keyboard, mouse, gamepad
    │   ├── SaveManager.js    # localStorage save/load + settings
    │   └── Audio.js          # procedural Web Audio music & SFX
    ├── data/                 # DATA-DRIVEN content
    │   ├── world.js          # locations, buildings, interiors, shops
    │   ├── npcs.js           # named NPCs + schedules, ambient styles
    │   ├── items.js          # item catalog
    │   ├── factions.js       # factions + reputation tracks
    │   ├── missions.js       # 100 missions (50 student + 50 gangster)
    │   ├── vehicles.js       # vehicle specs (engines, gearing, grip, fuel) + spawns
    │   └── dialogue.js       # relationship-aware dialogue lines
    ├── world/
    │   └── TownBuilder.js    # builds all 3D geometry, colliders, doors
    ├── entities/
    │   ├── Character.js      # blocky humanoid model + walk animation (NPCs)
    │   ├── PlayerRig.js      # jointed player skeleton (spine, arms, legs, head)
    │   ├── PlayerAnimator.js # procedural layered animation (locomotion/aim/attack)
    │   ├── Player.js         # third-person controller state machine
    │   ├── NPC.js            # NPC AI (schedules, wander, panic, enemy combat)
    │   ├── Vehicle.js        # vehicle simulation (see "Driving" below)
    │   └── VehicleMeshes.js  # procedural bodies for every vehicle style
    ├── systems/
    │   ├── GameState.js      # money, inventory, rep, relationships, XP, save
    │   ├── Physics.js        # AABB collision world: sweeps, steps, ledges, rays
    │   ├── CameraController.js # spring-arm third-person camera
    │   ├── Interaction.js    # contextual targeting + prompts
    │   ├── Weapons.js        # hit-scan firearms, spread, recoil, tracers
    │   ├── Combat.js
    │   ├── NPCManager.js     # crowd spawn, LOD, enemy/cop spawning
    │   ├── VehicleManager.js # the town fleet: parking, culling, fuel stations
    │   ├── MissionManager.js # objective engine, rewards, unlocking
    │   └── DialogueManager.js
    ├── ui/
    │   ├── UI.js             # HUD, menus, dialogue, shop, minimap, map
    │   └── style.css
    └── Game.js               # main loop wiring everything together

tests/                        # headless test suite (`npm test`)
├── controller.test.mjs       # movement, parkour, collision, combat, camera
├── world.test.mjs            # the real town: colliders, ladders, doors
├── vehicles.test.mjs         # physics, gearbox, fuel, damage, collisions, fleet
├── integration.test.mjs      # DOM ids, UI methods/hooks, config keys, events
└── boot.test.mjs             # boots the whole game in jsdom and plays it
```

---

## 🕹 The player controller

The character controller is the core of the game feel, so it is built as a small
state machine (`src/entities/Player.js`) over a custom AABB collision world
(`src/systems/Physics.js`) — no physics engine, no animation files.

**Motion states:** `ground` · `air` · `slide` · `vault` · `mantle` · `hang` · `ladder` ·
`vehicle` · `ko`

**What makes it feel responsive**

- **Three speed tiers** — walk (`Alt`), jog, sprint (`Shift`) — with separate
  acceleration and deceleration so stops are crisp but never icy, plus a
  stamina drain that forces you to pace a chase.
- **Jump feel** — variable height (hold for higher), *coyote time* (you can
  still jump a moment after walking off a ledge) and *input buffering* (a jump
  pressed just before you land still fires).
- **Sprint slide** — crouching at speed converts momentum into a slide that
  keeps the capsule low (so you can go under pipes and barriers a standing
  character cannot pass), bleeds speed with friction, can be steered a little,
  can be jumped out of, and leaves you crouched if you stop under something.
- **Contextual climbing** — every frame the controller probes the obstacle in
  front of you and classifies it: kerbs and steps are absorbed automatically,
  waist‑high cover is **vaulted** (and auto‑vaulted when you are sprinting),
  ledges up to ~2.4 m are **mantled** if you have the stamina, ladders are
  climbed, and building walls stay unclimbable. Scripted vault/mantle arcs use
  a Bézier path so the body never clips through the geometry.
- **Ledge hanging** — fall past a lip you can reach and the character catches
  it instead of dropping (which also absorbs the fall). From the hang you can
  shimmy along the wall with `A`/`D` until the ledge runs out, pull up with
  `Space`, or let go with `S`; your arms tire, so you cannot hang forever.
- **Natural facing** — the body turns smoothly toward where it is going, leans
  into turns and acceleration, and snaps to a strafing stance while aiming.
- **Procedural animation** (`PlayerAnimator.js`) blends layers on a jointed rig:
  locomotion (stride length and arm swing scale with real speed), crouch, air,
  land absorption, ladder, melee combo, aim pose and additive head‑look —
  footstep audio is driven by the animation itself, not a timer.

**Camera** (`src/systems/CameraController.js`) is a spring‑arm rig: it trails the
player with critically damped smoothing, pulls in when geometry would clip the
arm, swaps shoulders with `Q`, tightens and offsets over the shoulder when you
aim, widens the FOV with speed, and adds dips, shakes and weapon recoil.

**Interaction** (`src/systems/Interaction.js`) scores every nearby candidate by
distance *and* how directly you are facing it, so the prompt always offers the
thing you mean: a door, a shop counter, a ladder, a car, or a person.

---

## 🚗 Driving

Sixteen vehicles across six classes — hatchbacks, saloons, a sports coupe, a
muscle car, taxis, an EV, a superbike, a scooter, a pickup, a panel van, a box
truck, a city bus, a school bus, a police interceptor, an ambulance and a fire
engine. Every one of them is described in SI units in `src/data/vehicles.js`
(mass, kW, Nm, gear ratios, Cd·A, tyre friction, brake force, wheelbase, tank
size) and `src/entities/Vehicle.js` derives the behaviour from those numbers.
Nothing is special‑cased: a bus understeers and a sport bike is twitchy purely
because of their specifications.

**What the simulation models**

- **Bicycle‑model handling** — each axle develops a lateral force from its slip
  angle; the resulting forces move the body and spin it about its yaw axis.
  Below walking pace it blends to a kinematic steer so parking stays stable.
- **A real gearbox** — torque curve, ratios, final drive, auto shifting that
  holds gears longer in a sporty car, manual override on `Z`/`X`, clutch slip
  that multiplies torque off the line, and a redline you can bounce off.
- **Friction circle** — braking and cornering compete for the same grip, so you
  cannot do both at full force. Longitudinal load transfer adds front grip under
  braking and lifts the rear under power.
- **Handbrake** — clamps the rear axle: it slows you down *and* costs rear grip,
  which is what makes the back step out.
- **Fuel and energy** — burned against the engine's actual load, not a timer.
  Electrics use a single ratio and recover charge under regenerative braking.
  Run dry and the engine stops; refuel at a pump or a charger with `E`.
- **Damage** — impacts are costed from kinetic energy and softened by the body's
  armour. A head‑on hit damages the engine, a rear‑ender holes the tank (which
  then leaks), a side swipe bends the steering so the car pulls. Enough abuse
  writes it off, with smoke and fire on the way there.
- **Oriented‑box collisions** — separating‑axis tests against the world and
  against other vehicles, resolved with proper two‑body impulses, so a seven
  tonne truck shoves a parked hatchback out of the way. Kerbs are driven over
  and low bridges are driven under — if you are short enough.

**What you see and hear** — a speedometer that sweeps against *that* vehicle's
top speed, a tachometer, gear, fuel and body‑condition gauges, warning lamps for
a leaking tank or a burning engine, and a performance card dealt when you get in
whose figures come from running the simulation headlessly. The engine is a
continuous Web Audio source whose pitch tracks the revs through every gear
change, with tyre squeal, sirens, horns and crash noise on top.

| | 0–100 km/h | Top speed | Stops from 100 | Turning circle |
|---|---|---|---|---|
| Mirado GT (sports) | 4.2 s | 277 km/h | 29 m | 11.0 m |
| Vanguard Interceptor (police) | 3.8 s | 240 km/h | 31 m | 11.8 m |
| Kessler Nib (hatchback) | 10.7 s | 172 km/h | 37 m | 9.1 m |
| Ridgeback 2500 (pickup) | 7.4 s | 175 km/h | 41 m | 16.1 m |
| Haulmaster 7T (box truck) | 29.2 s | 119 km/h | 60 m | 22.6 m |
| Brackenridge Transit (bus) | 43.3 s | 100 km/h | 62 m | 25.9 m |
| Pico 125 (scooter) | never | 85 km/h | 32 m | 3.4 m |

---

## 🧪 Tests

```
npm install     # dev-only: three + jsdom, for the headless tests
npm test
```

154 assertions run in Node with no browser and no GPU:

- `npm run test:controller` — speed tiers, crouch under ceilings, jump feel,
  sliding, wall sliding, step‑ups, vaulting, mantling, ledge hangs and shimmies,
  ladders, melee combos, aiming, camera collision and interaction scoring.
- `npm run test:world` — builds the actual town and verifies every collider,
  that every ladder can be climbed to a real roof, that rooftop lips can be
  caught in mid‑air, and that every door has somewhere to stand.
- `npm run test:vehicles` — drives the real simulation: every vehicle pulls away
  and reaches its specified top speed, acceleration and braking rank the fleet
  correctly, full lock traces the specified turning circle, the handbrake breaks
  traction, the gearbox works up and down the ratios, fuel burns under load and
  runs out, crashes damage the right components, and the fleet manager parks,
  culls, refuels and saves.
- `npm run test:integration` — static audit of the seams a browser would break
  on: DOM ids, UI methods, UI hooks, `CONFIG` paths, input actions, events.
- `npm run test:boot` — boots the **real game** inside jsdom with a stubbed
  renderer and plays it with synthetic input: walking, sprinting, crouching,
  jumping, sliding, shooting, driving, entering buildings, climbing a ladder,
  saving — plus the whole town fleet: that nothing is parked inside a building,
  that a sports car out‑accelerates a bus, that the instrument cluster reads
  out correctly, that fuel is consumed and can be bought, and that stealing a
  police car is noticed.

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
- **Phase 5 ✔** Professional third‑person controller: speed tiers, crouch, slide,
  contextual vault/mantle/hang/ladder climbing, melee combos, firearms with aiming,
  vehicles, spring‑arm camera, procedural animation — all covered by a headless
  test suite.
- **Phase 6 ▲ ongoing** All 100 missions are defined and playable through the
  objective engine; content depth (bespoke set‑pieces, extra activities, cutscene
  scripting, more secrets) is where future polish plugs in via the data files.

---

## Notes

- Your progress **autosaves** every ~60 seconds and when you **Rest** at home;
  you can also Save/Load from the pause menu.
- If the screen is blank, make sure you opened it via `http://localhost:...`
  (not `file://`) and that your browser can reach the Three.js CDN (unpkg.com).

MIT‑licensed original work. Have fun in Brackenridge.
