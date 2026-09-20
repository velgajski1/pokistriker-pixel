# Benched: A Striker's Roguelite — Game Design Document

## 1. High-Concept & Core Systems Overview
Instead of simulating standard soccer matches, the game focuses entirely on high-stakes attacking scenarios. The core gameplay loop blends turn-based mechanics with an expanding progression loop.

```text
       ┌─────────────────────────────────────────────────────────┐
       │                       MAIN MENU                         │◄───────────────────────┐
       │        Spend Lifetime Legacy Points on Meta-Upgrades    │                        │
       └────────────────────────────┬────────────────────────────┘                        │
                                    │                                                     │
                                    ▼                                                     │
       ┌─────────────────────────────────────────────────────────┐                        │
       │                   MATCH SIMULATION                      │                        │
       │  Clock scales at 10 in-game minutes per 1 real second   │                        │
       │  3D Canvas is dimmed; Single-line text ticker runs      │                        │
       └────────────────────────────┬────────────────────────────┘                        │
                                    │                                                     │
                                    ├─► [Random Chance Event Met]                         │
                                    │   Clock freezes; Canvas brightens to 100%           │
                                    │   Player enters Highlight Phase                     │
                                    │                                                     │
                                    ▼                                                     │
       ┌─────────────────────────────────────────────────────────┐                        │
       │              HIGHLIGHT PHASE (3D Three.js)              │                        │
       │  1. Aiming: Visual arrow oscillates across goalmouth   │                        │
       │  2. Power: Lock elevation and forward shot velocity    │                        │
       │  3. Flight: Ball launches; AI Goalie attempts save     │                        │
       └────────────────────────────┬────────────────────────────┘                        │
                                    │                                                     │
                                    ▼                                                     │
       ┌─────────────────────────────────────────────────────────┐                        │
       │                     TRAINING ROOM                       │                        │
       │  Match ends (90'). Screen switches to a 2D Overlay.     │                        │
       │  Spend match cash on 5 tiers of stats or restore morale │                        │
       └────────────────────────────┬────────────────────────────┘                        │
                                    │                                                     │
                                    ▼                                                     │
                       [ MANAGER CONFIDENCE = 0% ] ───────────────────────────────────────┘
                            (BENCHED / RUN OVER)
                     Convert goals into Legacy Points
```

---

## 2. Match Pacing & Time Compression Architecture
* **Time Compression Matrix:** The simulation clock advances at exactly **10 in-game minutes per 1 real-world second**. 
* **The Math Breakdown:** A full 90-minute regulation match takes exactly **9 seconds** of raw simulation time:
  * **1 Real-World Second:** 10 In-game Minutes
  * **9 Real-World Seconds:** 90 In-game Minutes
* **Operational States:**
  * **SIMULATING State:** The 3D field graphics are dimmed using a CSS filter overlay (`filter: brightness(0.3)`). A single-line text banner updates every 1.5 seconds to flash match updates (e.g., *“14’ Midfield physical battle...”*, *“28’ Offside flag halts the advance...”*).
  * **HIGHLIGHT State:** The match clock **completely freezes**. The CSS dimming layer is removed instantly, brightening the arena. The user is handed control to aim and power up their shot. After the ball finishes its flight path and a result is registered, the canvas dims again and the simulation clock resumes down into the 90th minute.

---

## 3. High-Contrast, Minimalist User Interface Specification
The visual philosophy relies on absolute functional utility. There are no heavy decorative side panels or skeuomorphic textures.

### In-Match Heads-Up Display (HUD Layout)
```text
 MATCH 1 | CLOCK: 42'                                         GOALS: 2 | CHANCES LEFT: 1
 ───────────────────────────────────────────────────────────────────────────────────────
                                  [3D WebGL Rendering Area]
                                  
                                    (O) Goalkeeper
                                    
                                     ▲ Aiming Arrow
                                     ● Soccer Ball
                                    [#] Striker
                                    
 [Ticker Text Overlay]: 42' Winger breaks down the flank and crosses into the box!!
 ───────────────────────────────────────────────────────────────────────────────────────
                                [====== POWER BAR ======] (Only when setting power)
```

### The In-Season Training Screen Layout (Between Matches)
When a match concludes, the 3D viewport dims completely. A transparent modal presents a vertical interface tracking 5 progress levels per stat using filled `[■]` and empty `[ ]` character boxes.

```text
 ───────────────────────────────────────────────────────────────────────────────────────
                                      TRAINING ROOM
 ───────────────────────────────────────────────────────────────────────────────────────
  MATCH 1 SUMMARY: 2 Goals Scored | Current Bank: $350
  MANAGER CONFIDENCE: [■■■■■■■■■■■■■■■■■■■■] 100%
  
  🎯 TARGET PRACTICE   [■] [■] [■] [ ] [ ]   (Slower Arrow Sweep)        - Buy Level 4: $400
  🦿 LEG DAY           [■] [■] [ ] [ ] [ ]   (Faster Shot Velocity)      - Buy Level 3: $360
  🩹 ICE BATH          [■] [ ] [ ] [ ] [ ]   (Corner Shot Magnetism)     - Buy Level 2: $200
  🦅 POACHER INSTINCT  [■] [■] [■] [■] [ ]   (+Odds For Extra Chance)    - Buy Level 5: $750
  
  ❤️ MEDIA CHARM       [ Restore +25% Manager Confidence ]               - Flat Fee:    $100
  
 ───────────────────────────────────────────────────────────────────────────────────────
                                                                    [ PROCEED TO NEXT MATCH > ]
```

---

## 4. Multi-Level Stat Progression Systems

### In-Season Training Upgrades (Temporary Run Stats)
Purchased using Match Cash (`$`) accumulated during the current run. Progression states clear entirely upon terminal benching. Costs follow a steep multiplier curve (`Base Cost * Level`).

1. **Poacher's Instinct (Max Level 5):** Modifies calculation tracking available match opportunities.
   * *Level 1 (Base):* 3 guaranteed chances per match.
   * *Levels 2-4:* Adds an incremental +25% compounding probability to roll a 4th emergency opportunity.
   * *Level 5 (Max):* 100% absolute guarantee of 4 full opportunities starting from kick-off.
2. **Target Practice (Max Level 5):** Applies a reduction multiplier to the target arrow's angular velocity.
   * *Level 1 (Base):* Fast, volatile 8-bit swing speed.
   * *Level 5 (Max):* Retarded, highly stable track tracking across the mouth of the net.
3. **Leg Day (Max Level 5):** Scales the raw impulse vector applied to forward ball velocity upon button release.
   * *Impact:* Reduces the frames available for the goalkeeper AI's positioning algorithm to execute a successful dive intersection.
4. **Ice Bath (Max Level 5):** Increases the "Clutch" magnet parameter.
   * *Impact:* If a shot vector is projected within a narrow margin of the inside edge of the goalposts, the ball introduces a subtle internal tracking curve directly toward the inner side netting.

### Permanent Meta-Progression Upgrades (Lifetime Unlocks)
Purchased via the Main Menu using **Legacy Points** (`Total Goals Scored in Run * 10`). These stats persist across all save slots and profiles using browser native storage.

* **Star Player Status (Max Level 5):** Modifies your career starting base. Level 5 alters your base match condition to automatically start every single match with 4 chances instead of 3.
* **Super Sub / Safety Net (Max Level 5):** Triggers a unique survival logic routine. If your Manager Confidence drops below 30% mid-game, the machine executes an algorithmic check. At Level 5, there is a **50% probability** to immediately force-inject an extra opportunity into the match canvas, providing a mechanical buffer to save the career.
* **Natural Talent (Max Level 5):** Grants a permanent +5% baseline shot velocity scalar per level at the start of all future career attempts.
* **Ice in the Veins (Max Level 5):** Applies a permanent -5% slower baseline sweep velocity to the targeting indicator mesh.
* **Manager's Pet (Max Level 5):** Expands the top-end ceiling of the manager tracking array (+5% capacity per tier, peaking at a 125% max capability threshold cushion).
* **Golden Boot Heritage (Max Level 5):** Permanently inflates financial payouts rewarded for finding the back of the net (adds a flat `+$10` addition to the `$100` baseline target per level).
