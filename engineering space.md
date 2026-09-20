# Benched: A Striker's Roguelite — Software Architecture & Engineering Spec

This document details the engineering parameters, multi-file code boundaries, mathematical formulas, and technical constraints required to execute the game code cleanly.

---

## 1. Project Directory Structure
```text
├── index.html          # Entry point & HTML UI structure
├── style.css           # Ultra-minimalist arcade UI styling
└── js/
    ├── app.js          # Bootstrapper & Main Application State Machine
    ├── gameEngine.js   # Three.js Setup, Scene Rendering, & Match Simulation
    ├── physics.js      # Vector Mathematics, Ball Kinetics, & Collision Checks
    ├── uiManager.js    # 2D Screen Overlays & Match Ticker Updates
    └── saveSystem.js   # LocalStorage Interface for Permanent Upgrades
```

---

## 2. Technical Constraints & Architecture Enforcements
To build this cleanly across separate JavaScript files rather than stuffing it into a fragile single-file wrapper, code generation must strictly adhere to the following architecture:

### Modular Architecture Mapping
* `index.html`: Core mounting target containing primitive container divs for overlay screens and WebGL rendering zones.
* `style.css`: Minimalist CSS layout rules handling screen transitions using a uniform utility visibility flag (`.hidden { display: none !important; }`).
* `js/app.js`: Main state orchestrator tracking application state arrays (meta records vs active run conditions).
* `js/gameEngine.js`: Single instantiation layer for Three.js engine components (`THREE.Scene`, `THREE.WebGLRenderer`, `THREE.PerspectiveCamera`). Includes lighting trees, field grid models, frame timing variables, and the primary animation loop.
* `js/physics.js`: Lightweight, decoupled analytical mathematical vector space handling point-to-plane goal constraints and goalie bounding volumes. **No complex external dependency overhead allowed (e.g., Ammo.js / Cannon.js).**
* `js/uiManager.js`: Handles updating text commentary banners, power meter transitions, and building out procedural HTML rows for the 5-tier upgrade tables.
* `js/saveSystem.js`: Clean interface layer interacting with browser native JSON `localStorage` modules.

### Strict Coding Paradigms
1. **Instantiation Isolation:** The WebGL loop structures must load exactly once during application boot inside `gameEngine.js`. When a chance updates or resets, objects must be translated spatially via repositioning properties (`mesh.position.set()`) instead of breaking down and rebuilding objects from memory.
2. **Decoupled State Pipeline:** The 3D animation context must not double as a data store. All calculations tracking wallet currency, manager morale metrics, and skill levels must stay isolated inside an independent JS data literal model inside `app.js`.
3. **Framerate Independence:** Every single linear displacement transformation loop step (such as incremental arrow rotation swings or ball movement tracking arrays) must scale proportionally against performance delta counters (`clock.getDelta()`). This ensures consistency on high-refresh-rate gaming monitors (e.g., 144Hz) compared to standard 60Hz displays.
4. **Clean Garbage Isolation:** Avoid runtime garbage collection hitching. Do not instantiate new `THREE.Vector3` or `THREE.Box3` structures inside high-frequency updating paths (`requestAnimationFrame`). Instead, declare static scratch vectors once at file-level scopes and update them using reassigning utility methods (`vector.copy()` or `vector.set()`).

---

## 3. Mathematical Simulation Reference Data

### Ball Mechanics
* **Aim Phase:** Arrow sweeps horizontally mirroring a standard sine or bouncing arithmetic function. Bounds: `-0.9 radians` to `+0.9 radians`.
* **Power Phase:** Power value scales uniformly up and down from `0.0` to `1.0`.
* **Launch Vector:**
  \[\vec{V}_{initial} = \text{Normalize}(\text{Direction}(\theta_{arrow})) \times \text{Velocity}_{base} \times (0.6 + 0.4 \times \text{Power})\]
  \[V_y = \text{Power} \times 4.0\]
* **Gravity:** Active on the ball whenever Y > 0.25. Acceleration vector applies standard downforce: -9.81 m/s².
* **Pitch Rebound Dampening:** On turf intersection (Y ≤ 0.25), invert vertical velocity using a standard bounce coefficient (\(V_y = V_y \times -0.4\)), then apply linear drag on horizontal friction planes (\(V_x = V_x \times 0.92\), \(V_z = V_z \times 0.92\)).

### Bounding Box Collision Targets
* **Goal Line Plane Target:** Positioned precisely at coordinate plane Z = -20.0.
* **Goalmouth Cross-Section Limits:** X bounds between \([-4.0, +4.0]\); Y bounds between \([0.0, 3.0]\).
* **Woodwork Detection:** Bounding intersections within a `0.2` meter tolerance zone around structural limits trigger a physical rebound. This flips velocity vectors back into active play while dampening absolute energy metrics.
* **Goalkeeper Interception Radius:** Evaluated as an analytical sphere-to-point comparison array. If the 3D distance between the ball center and the goalie mesh center drops below exactly `0.85` meters inside active play zones, a safe execution state is logged immediately.
