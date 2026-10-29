---
name: game-animation
description: Animation for games - the 12 principles applied to gameplay, animation state machines and blend trees, root motion, animation events, sprite and skeletal animation, IK, and engine specifics for Unity, Godot, Unreal, Roblox, and Blender exports.
metadata:
  origin: ECC
---

# Game Animation

Make characters and objects move in ways that read clearly, respond instantly
to input, and stay in sync with gameplay.

## When to Use

- Setting up an animation controller or state machine for a character
- Blending walk, run, and strafe, or layering upper-body actions
- Syncing hitboxes, footsteps, or VFX to animation frames
- Choosing between root motion and code-driven movement
- Importing animations from Blender or Mixamo into an engine
- Animating 2D sprites, UI, or cutscenes
- Animating characters on Roblox (see also `roblox-development`)

## How It Works

### 1. Apply the principles, with gameplay in mind

| Principle | In games |
|-----------|----------|
| Anticipation | Wind-up before an attack. Keep it short for player actions (responsiveness) and longer for enemies (readability) |
| Follow-through | Recovery frames after an attack. This is where you allow cancels |
| Squash and stretch | Jumps and landings, bouncy pickups |
| Easing (slow in/out) | Almost nothing should move linearly |
| Arcs | Limbs and thrown objects follow curves |
| Exaggeration | Push poses so they read at gameplay camera distance |
| Timing | Frame counts define feel: a 3-frame and an 8-frame startup are different games |
| Secondary action | Hair, cloth, weapons trailing. Physics bones or spring bones work well |

**Responsiveness beats realism for player characters.** Start the action on the
input frame, then hide the transition with blending.

### 2. Structure with a state machine

```text
          +--------+  speed > 0.1   +---------+
 start -> |  Idle  | -------------> | Locomotion (blend: walk/run by speed)
          +--------+ <------------- +---------+
              |  jump pressed           |  jump pressed
              v                         v
          +--------+  grounded     +---------+
          |  Jump  | ------------> |  Land   | -> back to Idle/Locomotion
          +--------+               +---------+
 Any State --(attack trigger)--> Attack --(exit time / cancel window)--> previous
```

- Drive transitions with **parameters** (`speed`, `grounded`, `attack` trigger) that gameplay code sets. Animation should not own gameplay logic.
- Use **blend trees or blend spaces** for continuous movement (1D by speed, 2D by direction for strafing).
- Use **layers with masks** to play upper-body actions (shoot, wave) over lower-body locomotion.
- Keep transition durations short (0.05-0.15 s) for player actions, and turn off "exit time" on transitions that must respond to input.

### 3. Root motion vs in-place

| | Root motion | In-place, moved by code |
|--|-------------|-------------------------|
| Foot sliding | None | Possible; tune speeds to match |
| Control | Animation decides distance | Code decides; easier to tune and network |
| Good for | Melee lunges, climbing, cinematic moves | Player locomotion, multiplayer |

A common hybrid: in-place locomotion plus root motion for specific attacks or traversal.

### 4. Sync gameplay to animation

- Use **animation events or markers** for the exact frame a hitbox turns on, a footstep plays, or a projectile spawns.
- Gameplay should still work if an event is missed (an interrupted animation). Clean up in the state's exit logic.
- In multiplayer, the server decides hits. Animation events on the client only *request* or *display* them.

### 5. Engine notes

**Unity**
- Animator Controller: states, transitions, parameters, Blend Trees, layers with Avatar Masks.
- `animator.SetFloat("Speed", speed)`, `animator.SetTrigger("Attack")`. Cache parameter hashes with `Animator.StringToHash`.
- Animation Events call methods on the GameObject. The Animation Rigging package adds runtime IK (aim, two-bone).
- Humanoid rigs allow retargeting between characters.

**Godot 4**
- `AnimationPlayer` holds clips; `AnimationTree` with an `AnimationNodeStateMachine` and BlendSpace1D/2D drives them.
- Travel between states: `$AnimationTree.get("parameters/playback").travel("run")`.
- Set blend positions: `$AnimationTree.set("parameters/locomotion/blend_position", speed)`.
- Call methods from a "Call Method" track for animation events.

**Unreal Engine 5**
- Animation Blueprint: AnimGraph state machines, Blend Spaces, and Montages for one-off actions such as attacks.
- Anim Notifies for events, Control Rig for procedural animation and IK.

**Roblox**
- Load through `Animator:LoadAnimation`, set `AnimationTrack.Priority`, and use `GetMarkerReachedSignal` for events.
- Build animations in the Animation Editor or import FBX, then upload them under the same owner as the experience.

**2D and web**
- Sprite sheets: keep frame size consistent, pack them in an atlas, and set the frame rate per clip.
- Skeletal 2D (Spine, DragonBones, Godot Skeleton2D) for smooth, reusable rigs.
- UI tweens: Unity DOTween, Godot `Tween`, Roblox `TweenService`, and CSS or the Web Animations API on the web.

### 6. Importing from Blender

- Apply transforms (`Ctrl+A`, All Transforms) before export. Use a scale of 1 and a consistent forward axis.
- Export FBX or glTF. Name actions clearly (`Run`, `Attack_01`) and bake them if you use constraints.
- Keep one armature per character. Check bone roll and rest pose before retargeting.
- Mixamo clips: download "without skin" for extra animations and use "in place" for code-driven locomotion.

### 7. Inverse kinematics (IK)

Use IK for foot placement on slopes, hands on weapons or ledges, and look-at
heads. Apply it after the base animation, and blend its weight in and out to
avoid pops.

## Examples

**Problem:** "Attacks feel delayed."
**Fix:** Turn off exit time on transitions into the attack. Shorten the wind-up
for the player, start the attack state on the input frame, and use a 0.05 s
transition.

**Problem:** "Feet slide when walking."
**Fix:** Match movement speed to the clip's stride: measure distance per cycle
and divide by the cycle duration. Alternatively, use root motion or a speed-driven blend tree.

**Problem:** "The hitbox is active when the sword is not swinging."
**Fix:** Enable it only between two animation events (`HitStart`, `HitEnd`),
and disable it in the attack state's exit so interrupts cannot leave it on.

## Related Skills

- `game-development` - game loop, state machines, and architecture
- `roblox-development` - Roblox Animator, TweenService, and Luau
- `motion-foundations` - UI motion on the web (React)
