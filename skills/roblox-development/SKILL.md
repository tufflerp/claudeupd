---
name: roblox-development
description: Roblox game development in Luau - client/server architecture, secure RemoteEvents, DataStores, typed Luau, Rojo/Wally tooling, performance, monetization, and Roblox animation. Use when building or reviewing Roblox experiences.
metadata:
  origin: ECC
---

# Roblox Development

Build Roblox experiences that are secure, performant, and maintainable. Covers
the client/server model, networking, data persistence, typed Luau, tooling, and
the Roblox-specific parts of animation.

## When to Use

- Writing or reviewing Luau scripts (`Script`, `LocalScript`, `ModuleScript`)
- Designing client/server communication with RemoteEvents or RemoteFunctions
- Saving player data with DataStoreService
- Setting up a file-based workflow (Rojo, Wally, Selene, StyLua)
- Diagnosing lag, memory growth, or exploit reports
- Adding developer products, game passes, or animations

## How It Works

### 1. Respect the client/server boundary

The server is the only source of truth. Anything running on a player's device can
be modified by an exploiter.

| Location | Runs on | Use for |
|----------|---------|---------|
| `ServerScriptService` | Server | Game rules, data, damage, currency |
| `ServerStorage` | Server only (not replicated) | Server-only modules and assets |
| `ReplicatedStorage` | Both | Shared modules, RemoteEvents, shared assets |
| `StarterPlayerScripts` | Client | Input, camera, UI, local effects |
| `StarterGui` | Client | UI |

Rules:
- Never trust values sent by the client: validate types, ranges, ownership, and cooldowns on the server.
- Never let the client decide outcomes (damage, rewards, purchases). The client sends *intent*; the server decides.
- Keep secrets (keys, admin lists, loot tables) in `ServerStorage` or `ServerScriptService`.

### 2. Validate every remote

```lua
--!strict
-- ServerScriptService/CombatServer.server.lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local attackRemote = ReplicatedStorage.Remotes.Attack :: RemoteEvent
local COOLDOWN = 0.5
local MAX_RANGE = 12
local lastAttack: { [Player]: number } = {}

attackRemote.OnServerEvent:Connect(function(player: Player, target: unknown)
    -- 1. Type-check everything the client sent
    if typeof(target) ~= "Instance" or not target:IsA("Model") then
        return
    end

    -- 2. Rate-limit
    local now = os.clock()
    if now - (lastAttack[player] or 0) < COOLDOWN then
        return
    end
    lastAttack[player] = now

    -- 3. Check game state on the server
    local character = player.Character
    local humanoid = target:FindFirstChildOfClass("Humanoid")
    local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
    local targetRoot = target:FindFirstChild("HumanoidRootPart") :: BasePart?
    if not (humanoid and root and targetRoot) then
        return
    end
    if (root.Position - targetRoot.Position).Magnitude > MAX_RANGE then
        return
    end

    humanoid:TakeDamage(10) -- server decides the amount
end)

Players.PlayerRemoving:Connect(function(player)
    lastAttack[player] = nil -- avoid leaking per-player state
end)
```

Prefer `RemoteEvent` over `RemoteFunction`. Never call `InvokeClient` from the
server: a client can hang or error and stall the server thread.

### 3. Save data safely

```lua
--!strict
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local store = DataStoreService:GetDataStore("PlayerData_v1")
local sessionData: { [number]: { coins: number } } = {}

local function withRetries<T>(fn: () -> T): (boolean, T?)
    for attempt = 1, 3 do
        local ok, result = pcall(fn)
        if ok then
            return true, result
        end
        task.wait(2 ^ attempt) -- back off: 2s, 4s, 8s
    end
    return false, nil
end

Players.PlayerAdded:Connect(function(player)
    local ok, data = withRetries(function()
        return store:GetAsync(tostring(player.UserId))
    end)
    if not ok then
        player:Kick("Could not load your data. Please rejoin.") -- never overwrite on a failed load
        return
    end
    sessionData[player.UserId] = data or { coins = 0 }
end)

local function save(player: Player)
    local data = sessionData[player.UserId]
    if not data then
        return
    end
    withRetries(function()
        return store:UpdateAsync(tostring(player.UserId), function()
            return data
        end)
    end)
    sessionData[player.UserId] = nil
end

Players.PlayerRemoving:Connect(save)
game:BindToClose(function()
    for _, player in Players:GetPlayers() do
        task.spawn(save, player)
    end
    task.wait(3)
end)
```

Rules:
- Wrap every DataStore call in `pcall`; they fail under load.
- If loading fails, do not let the session save over the player's real data.
- Prefer `UpdateAsync` over `SetAsync` for read-modify-write.
- Save on `PlayerRemoving` **and** `BindToClose`; autosave every few minutes for long sessions.
- Version store names (`PlayerData_v1`) so schema changes can migrate.
- For trading or high-value items, use session locking (or a proven library such as ProfileStore).

### 4. Use modern Luau

- Add `--!strict` and type annotations to new modules.
- Use the `task` library (`task.wait`, `task.spawn`, `task.defer`, `task.delay`). Do not use the legacy `wait`, `spawn`, or `delay`.
- Fetch services with `game:GetService("Name")`.
- Use `WaitForChild` on the client for replicated instances, and avoid it on the server for things the server created.
- Disconnect connections you no longer need, and clean up per-player tables on `PlayerRemoving`.
- Tag instances with `CollectionService` and store small config on Attributes instead of hard-coding paths.

### 5. Tooling for a file-based workflow

| Tool | Purpose |
|------|---------|
| Rojo | Sync files on disk into Studio so code lives in git |
| Wally | Package manager for Luau libraries |
| Selene | Linter |
| StyLua | Formatter |
| Rokit (or Aftman) | Pins tool versions per project |
| luau-lsp | Editor type checking and autocomplete |

A typical Rojo layout:

```text
src/
  server/   -> ServerScriptService
  client/   -> StarterPlayer/StarterPlayerScripts
  shared/   -> ReplicatedStorage/Shared
default.project.json
wally.toml
selene.toml
stylua.toml
```

### 6. Performance

- Do per-frame work in `RunService.Heartbeat` (server or client) or `RunService.RenderStepped` (client camera only), and scale by the delta time.
- Avoid creating and destroying many parts per frame; pool them instead.
- Set network ownership explicitly for physics objects the server must control (`part:SetNetworkOwner(nil)`).
- Enable `StreamingEnabled` for large maps.
- Use the MicroProfiler and the Developer Console (F9) before optimizing.

### 7. Monetization and user content

- Grant developer products only in `MarketplaceService.ProcessReceipt`, and return `Enum.ProductPurchaseDecision.PurchaseGranted` only after the reward is saved. Otherwise return `NotProcessedYet` so Roblox retries.
- Check game passes with `MarketplaceService:UserOwnsGamePassAsync` on the server.
- Filter all player-written text that other players can see with `TextService:FilterStringAsync`. This is required by Roblox policy.

### 8. Animation on Roblox

- Load animations through the `Animator` (inside the `Humanoid` or an `AnimationController`). `Humanoid:LoadAnimation` is deprecated.
- Set `AnimationTrack.Priority` (`Core`, `Idle`, `Movement`, `Action` to `Action4`) so attacks override walking.
- Use `track:GetMarkerReachedSignal("Hit")` for gameplay timing. Add markers in the Animation Editor.
- Play character animations from a `LocalScript` for the local player; they replicate automatically through the Animator.
- Animations only play in experiences owned by the same user or group that owns the animation asset.
- Use `TweenService` for UI and simple object motion.

```lua
local animator = humanoid:WaitForChild("Animator") :: Animator
local swing = Instance.new("Animation")
swing.AnimationId = "rbxassetid://0000000000" -- your uploaded animation

local track = animator:LoadAnimation(swing)
track.Priority = Enum.AnimationPriority.Action
track:GetMarkerReachedSignal("Hit"):Connect(function()
    attackRemote:FireServer(currentTarget) -- the server still validates the hit
end)
track:Play(0.1) -- 0.1s fade-in
```

See the `game-animation` skill for animation principles and state machines.

## Examples

**Review checklist for a Roblox pull request:**

- [ ] Every `OnServerEvent` handler type-checks and range-checks its arguments
- [ ] Rewards, damage, and currency are computed on the server
- [ ] DataStore calls are wrapped in `pcall`, with retries and no overwrite after a failed load
- [ ] Data saves on `PlayerRemoving` and `BindToClose`
- [ ] No `wait`/`spawn`/`delay`. Uses the `task` library
- [ ] Per-player tables are cleaned up when the player leaves
- [ ] `ProcessReceipt` grants only after saving
- [ ] Player-visible text goes through `TextService` filtering

**Prompt:** "Add a daily reward." Approach: store the last claim time in the
player's data on the server. Expose one `ClaimDaily` RemoteEvent. On the server,
compare `os.time()` with the stored time, grant the reward, save, then tell the
client the result. The client only shows UI and sends the claim request.

## Related Skills

- `game-development` - engine-agnostic game architecture
- `game-animation` - animation principles and state machines
