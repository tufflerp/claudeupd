---
name: game-development
description: Engine-agnostic game development - choosing an engine, game loops and fixed timesteps, entity/component architecture, state machines, input, save systems, performance budgets, and playtesting, with notes for Unity, Godot, Unreal, and web games.
metadata:
  origin: ECC
---

# Game Development

Practical architecture and workflow guidance for building games that feel good,
run smoothly, and stay maintainable as they grow.

## When to Use

- Starting a new game and choosing an engine or framework
- Structuring gameplay code (entities, components, systems, state machines)
- Fixing jitter, physics tunnelling, or frame-rate-dependent bugs
- Designing save/load, input mapping, or scene management
- Profiling and hitting a frame budget
- Planning playtests and iterating on game feel

## How It Works

### 1. Pick the engine for the game, not the hype

| Need | Good fit |
|------|----------|
| 2D or small 3D, open source, fast iteration | Godot 4 (GDScript or C#) |
| Cross-platform 2D/3D, large asset ecosystem, mobile/console | Unity (C#) |
| High-end 3D, large worlds, Blueprints plus C++ | Unreal Engine 5 |
| Browser games | Phaser (2D), Three.js or Babylon.js (3D), PlayCanvas |
| Multiplayer social games with a built-in audience | Roblox (Luau). See `roblox-development` |

Prototype the core mechanic in a day or two before committing to an engine.

### 2. Get the game loop right

Run simulation at a **fixed timestep** and render with interpolation. Physics
and gameplay then behave the same at 30, 60, or 144 FPS.

```text
accumulator += frame_delta (clamped to e.g. 0.25s to avoid a spiral of death)
while accumulator >= FIXED_DT:
    simulate(FIXED_DT)
    accumulator -= FIXED_DT
render(alpha = accumulator / FIXED_DT)  # interpolate between last two states
```

- Unity: physics in `FixedUpdate`, visuals and input reading in `Update`.
- Godot: physics in `_physics_process(delta)`, visuals in `_process(delta)`.
- Unreal: `Tick(DeltaTime)`. Use the physics substepping settings for stable physics.
- Always multiply movement by delta time in variable-step code.

### 3. Structure gameplay code

Prefer **composition over deep inheritance**.

- **Components:** small reusable behaviours (`Health`, `Mover`, `Hitbox`) attached to entities.
- **ECS** (Unity DOTS, Bevy, flecs): data-oriented systems that iterate over components. Use it when you have thousands of similar entities.
- **Finite state machines** for player and AI states (`Idle`, `Run`, `Jump`, `Attack`). Each state owns its enter, update, and exit logic, which prevents boolean soup like `isJumping && !isAttacking`.
- **Events or signals** to decouple systems (UI listens for `HealthChanged` instead of polling).
- **Data-driven design:** keep stats, waves, and loot tables in data files (ScriptableObjects, Godot Resources, JSON) so designers can tune them without code changes.

```gdscript
# Godot 4: a minimal state machine on the player
enum State { IDLE, RUN, JUMP }
var state := State.IDLE

func _physics_process(delta: float) -> void:
    match state:
        State.IDLE:
            if Input.get_axis("move_left", "move_right") != 0.0:
                state = State.RUN
        State.RUN:
            velocity.x = Input.get_axis("move_left", "move_right") * SPEED
            if Input.is_action_just_pressed("jump") and is_on_floor():
                velocity.y = JUMP_VELOCITY
                state = State.JUMP
        State.JUMP:
            if is_on_floor():
                state = State.IDLE
    velocity.y += gravity * delta
    move_and_slide()
```

### 4. Input

- Map **actions**, not keys (`jump`, not `Space`): Unity Input System, Godot Input Map, Unreal Enhanced Input.
- Support keyboard, gamepad, and touch from the start if you plan to ship on them.
- Buffer inputs (accept a jump pressed 100 ms before landing) and add coyote time (allow a jump shortly after leaving a ledge). Both make controls feel fair.

### 5. Saving and loading

- Save a versioned, plain data snapshot (JSON or binary), never engine objects directly.
- Include a `version` field and write migrations when the format changes.
- Write to a temporary file, then rename it, so a crash mid-save cannot corrupt the save.
- Keep saves in the platform's user data folder (`Application.persistentDataPath`, `user://`).

### 6. Performance budget

At 60 FPS you have **16.6 ms per frame** for everything; at 30 FPS, 33.3 ms.

- Profile first (Unity Profiler, Godot Profiler and Monitors, Unreal Insights, browser DevTools).
- Pool frequently spawned objects (bullets, particles, enemies).
- Avoid per-frame allocations in hot paths. In C#, watch for LINQ and boxing in `Update`.
- Batch draw calls with atlases and instancing. Use LODs for 3D.
- Use spatial partitioning (grids, quadtrees) for many-to-many checks.
- Test on the weakest target device early.

### 7. Game feel ("juice")

Small touches make actions feel weighty: hit-stop (freeze 2-4 frames on impact),
screen shake with falloff, particles, squash and stretch, sound on every action,
and easing instead of linear motion. Add these after the mechanic works, then
playtest with and without them.

### 8. Playtesting and iteration

- Build a playable vertical slice early, then iterate.
- Watch players without helping. Note where they get stuck or bored.
- Track a few metrics (time to first death, level completion rate).
- Keep a fast build-and-run loop. Iteration speed beats up-front design.

## Examples

**Bug:** "Player moves faster on high-refresh monitors."
**Cause:** Movement applied per frame without delta time.
**Fix:** Move movement into the fixed-step physics callback, or multiply by delta.

**Bug:** "Fast bullets pass through thin walls."
**Fix:** Enable continuous collision detection on the projectile, or raycast
from the previous position to the current one each step.

**Prompt:** "Structure enemies for a top-down shooter." Approach: one `Enemy`
scene or prefab composed of `Health`, `Mover`, `Weapon`, and an AI state
machine (`Patrol`, `Chase`, `Attack`, `Flee`). Stats come from a data asset per
enemy type, and spawning goes through an object pool.

## Related Skills

- `game-animation` - animation principles, state machines, and blend trees
- `roblox-development` - Roblox and Luau specifics
