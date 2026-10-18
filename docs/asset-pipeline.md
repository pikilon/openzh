# Asset pipeline: clean art, AI tools and new armies

Status: **planning, phase 4**. Written 2026-10-18 from the owner's question
about replacing the game's assets with AI and adding new armies. Nothing here
changes the order in `AGENTS.md`: phases 0 to 3 still come first. This file
records what was measured, what the engine requires and what is still a
decision; it is not a task until it becomes issues.

Sources: EA's GPL engine source in this repository, and the owner's Zero Hour
install read locally at `ZHWP_GAME_DIR` (counts only; no file copied anywhere).

## 1. Two different goals, with very different sizes

* **A port with no copyright problem.** This already exists: the repository
  ships no game data and the player supplies their own install. Replacing the
  assets is not needed for it. The only work is to keep it that way
  (`scripts/check-no-ea-assets.sh`).
* **A build that runs with no game install at all** (a public demo, a store
  page). That product needs *every* asset it touches replaced: models,
  textures, UI, audio, strings, maps, fonts. The measured scale (§3) makes that
  a separate, multi-year project, not a phase of this one.
* **New content** (new armies, units, maps). Needs new art only, and it
  *adds* to the player's files instead of replacing them. This is the only one
  of the three that is a phase-4 task, and it is the one worth planning now.

Keep the three apart: most of the effort in "replace the assets" only exists if
the owner decides to ship a build that does not use the player's files.

## 2. Altering EA assets does not make them clean

A recoloured, rescaled, re-posed, retopologised or "base model plus heavy
edits" version of an EA asset is a **derivative work**: distributing it still
needs EA's permission. There is no percentage of change that makes it
original; the test is substantial similarity, and a recognisable tank in a
recognisable faction still fails it.

The same applies to the AI route people usually try: feeding a screenshot, a
render or a ripped model into an image-to-3D tool. The tool's terms put the
input's copyright on the user (Tripo's own help page says the user is
responsible for the source material), and the output is still derivative.

What is clean, in order of how easy it is to defend:

1. Work made from scratch: drawn, modelled, commissioned, or AI-assisted from
   prompts that describe a design and not an EA asset.
2. Third-party work under a permissive licence, with the licence text and the
   attribution kept in the repository.
3. AI output from a named tool and version, with the prompt recorded, plus
   human editing. Copyright in purely AI-generated output is unsettled (in the
   US it is not protected at all), which is acceptable here because the
   project needs permission to distribute, not ownership. The consequence is
   that copyright cannot be used to defend these assets, so the provenance
   record is the only protection.

What stays risky even when new: reproducing a specific EA unit's silhouette,
names and role. A style is not copyrightable; a particular expression is, and
faction and unit names are trademarks (see `AGENTS.md`, Legal Limits).

Practical rule: an asset is usable only if its provenance fits in one line
(§9). If the line cannot be written, the asset does not ship.

## 3. What the game actually contains (measured)

Zero Hour, from the owner's install:

| Archive | Files | Content | Size |
| --- | --- | --- | --- |
| `W3DZH.big` | 4,432 | 4,429 `.w3d` models, 2 `.txt`, 1 `.tga` | 180 MiB |
| `TexturesZH.big` | 3,546 | 3,496 `.dds`, 50 `.tga` | 212 MiB |
| `AudioZH.big` | 287 | `.wav` | 22 MiB |
| `TerrainZH.big` | 149 | `.tga` terrain tiles | 8 MiB |
| `ShadersZH.big` | 8 | 6 `.pso`, 2 `.vso` | < 1 MiB |
| `INIZH.big` | 135 | `.ini` data | — |

Generals 1.0 adds its own set. The data side is large as well: Zero Hour has
15 `PlayerTemplate` blocks, 472 `CommandSet`, 817 `CommandButton` and 96
`Science` definitions. Replacing the whole game is an art studio's workload.

Three facts change the shape of the plan:

* **The shaders are not art.** `ShadersZH.big` holds eight precompiled DirectX
  8 shader blobs (`Shaders\fterrain.pso`, `Shaders\MotionBlur.vso`, ...). The
  WebGPU backend compiles its own WGSL
  (`Core/GameEngineDevice/Source/WebGPUDevice/WebGPUD3D8.cpp`). Clearing them
  is an engine task — stop loading the `.pso`/`.vso` path — not an asset task.
* **Textures are DDS.** A clean pipeline must emit DDS with mipmaps, or the
  engine must learn PNG/KTX2. KTX2/Basis is the natural web format; that is a
  phase-4 decision (§6).
* **Models are W3D with a contract, not just geometry.** `W3DModelDraw`,
  `W3DTruckDraw`, `W3DTankDraw` and friends look up sub-objects and bones **by
  name** in every condition state. `Data\INI\Object\AmericaVehicle.ini` shows
  the whole contract for one unit:

  ```ini
  Object AmericaVehicleHumvee
    Draw = W3DTruckDraw ModuleTag_01
      OkToChangeModelColor = Yes
      ConditionState = NONE
        Model = AVHUMMER
        Turret = Turret
        HideSubObject = TurretUp01 Housecolor03 MuzzleFXUP01
        WeaponFireFXBone = PRIMARY Muzzle
        WeaponMuzzleFlash = PRIMARY MuzzleFX
      End
      ConditionState = REALLYDAMAGED
        Model = AVHUMMER_d
        ...
  ```

  An AI-generated mesh is the easy part. The expensive part is the HLod tree,
  the turret and muzzle bones with those exact names, one model per damage
  state, the `HousecolorNN` sub-objects that the team colour blends into, the
  LODs and the animations. That is human work with a tool.

## 4. Clean sources

| Source | Gives | Terms | Keep |
| --- | --- | --- | --- |
| Own or commissioned | anything | full control | author, date, contract |
| CC0: Poly Haven, ambientCG, Kenney, Quaternius, Poly Pizza | props, terrain, textures, simple units | none | source URL, download date |
| CC-BY: OpenGameArt, Sketchfab | more variety | attribution | `ASSET-LICENSES.md` |
| AI generation | concepts, base meshes, texture variants | tool terms, and your input | tool, version, prompt, seed, date |
| EA renders, rips from any game, "reskins" of mods | — | derivative | never |

Only the CC0 filter of OpenGameArt and Freesound counts; the sites host every
licence at once.

## 5. AI tools by job

Names and terms change; the terms of the version actually used are what
matters, and they are recorded per asset (§9).

| Job | Candidates | Output | Watch |
| --- | --- | --- | --- |
| Concept art, silhouettes | Stable Diffusion (SDXL/Flux) self-hosted; Adobe Firefly | PNG | some model weights are non-commercial; Firefly is the paid, indemnified route |
| Image to 3D / text to 3D | TRELLIS (MIT, self-hosted); Hunyuan3D 2.x (Tencent community licence: user-count and territory limits); Stable Fast 3D (Stability community licence); Tripo, Meshy, Rodin (subscription) | GLB/OBJ/STL | commercial rights usually only on paid plans; input responsibility is the user's |
| Retopology, UVs | Blender; Instant Meshes (BSD) | mesh | — |
| Texturing | Material Maker (MIT); SD with a tiling setup; ArmorPaint | PNG/DDS | tiles must tile; team colour lives in a sub-object, not the texture |
| Rig, animation | Blender + Rigify; Mixamo, Cascadeur | FBX/GLB | check the animation licence before shipping |
| Audio and voice | Freesound (CC0 filter); ElevenLabs; own recordings | WAV | voice cloning terms are stricter than music terms |

There is no model that is safe *because* it allows EA references: every major
tool makes the user responsible for the input, and copyright applies whatever
the tool. Choosing a different model does not launder the input.

## 6. The W3D bottleneck, and the format decision

Three ways to get a new model into the engine:

1. **Write W3D.** Blender exporter or a small writer of our own. The engine
   path already exists and needs no change; the exporter must emit HLod,
   bones, shaders, DDS references and LODs the way the engine expects.
2. **Teach the engine glTF/KTX2.** Every AI tool emits glTF. The Draw modules
   would build the same hierarchy from glTF nodes, and textures arrive in the
   browser-native format. More engine work, but it removes the lossy step and
   the DDS pipeline at once.
3. **External converter** glTF to W3D. Same as (1) with an extra step.

The format is not the difficulty; the naming contract of §3 is. Both (1) and
(2) need a human (or a very constrained generator) to produce the named
sub-objects, damage variants and house-colour meshes.

What makes this testable without any EA file: a **synthetic model** built in
the test (a box with a bone named `Turret`, a `Housecolor01` sub-object, a
`_d` variant) loaded from a fixture that the repository legitimately owns. It
exercises the writer or loader, the Draw module and the placeholder path, and
it goes in CI. `docs/briefs/` already uses this pattern for synthetic data.

Recommendation: decide (1) against (2) in a phase-4 decision, not now, and
make the decision depend on the answer to "does the browser build want KTX2
anyway?". If it does, (2) is cheaper than it looks.

## 7. Adding an army is additive (measured in the source)

This is the useful finding for new content: **the engine already supports
adding a faction in new files, without rewriting EA's files.**

`INI::loadFileDirectory("Data\INI\Object")` loads `Data\INI\Object.ini` if it
exists and then **scans the `Data\INI\Object\` directory recursively**
(`Core/GameEngine/Source/Common/INI/INI.cpp:197`). Every store is initialised
that way (`GeneralsMD/Code/GameEngine/Source/Common/GameEngine.cpp:574-845`;
`CommandButton` and `CommandSet` in
`Core/GameEngine/Source/GameClient/GUI/ControlBar/ControlBar.cpp:1076-1080`;
`ControlBarScheme` in `ControlBarScheme.cpp:1023`). So a mod archive can add
`Data\INI\PlayerTemplate\MyArmy.ini` and that block is parsed after the
originals.

| Store | Add a file under | Loaded at |
| --- | --- | --- |
| `PlayerTemplate` | `Data\INI\PlayerTemplate\` | `GameEngine.cpp:759` |
| `Object` (units, buildings) | `Data\INI\Object\` (already a directory) | `GameEngine.cpp:808` |
| `CommandSet` | `Data\INI\CommandSet\` | `ControlBar.cpp:1080` |
| `CommandButton` | `Data\INI\CommandButton\` | `ControlBar.cpp:1077` |
| `ControlBarScheme` | `Data\INI\ControlBarScheme\` | `ControlBarScheme.cpp:1024` |
| `Weapon` | `Data\INI\Weapon\` | `GameEngine.cpp:790` |
| `Armor` | `Data\INI\Armor\` | `GameEngine.cpp:795` |
| `Locomotor` | `Data\INI\Locomotor\` | `GameEngine.cpp:792` |
| `Science` | `Data\INI\Science\` | `GameEngine.cpp:725` |
| `Upgrade` | `Data\INI\Upgrade\` | `GameEngine.cpp:823` |
| `SpecialPower` | `Data\INI\SpecialPower\` | `GameEngine.cpp:793` |
| `ObjectCreationList` | `Data\INI\ObjectCreationList\` | `GameEngine.cpp:791` |
| `FXList` | `Data\INI\FXList\` | `GameEngine.cpp:770` |
| `DamageFX` | `Data\INI\DamageFX\` | `GameEngine.cpp:794` |
| `AIData` | `Data\INI\AIData\` | `GameEngine.cpp:842` |
| `Rank` | `Data\INI\Rank\` | `GameEngine.cpp:758` |
| `Multiplayer` | `Data\INI\Multiplayer\` | `GameEngine.cpp:726` |

Constraints that come with it:

* Names must not collide with EA's: the load type is `INI_LOAD_OVERWRITE`, so a
  same-named block replaces the original instead of adding to it.
* Directory scans are sorted so every machine parses the same order
  (`INI::loadDirectory`); do not build content that depends on a different
  order.
* `PlayerTemplate.Side` must have a matching `ControlBarScheme <Side>8x6`, or
  the game silently falls back to the Observer control bar. The original
  `PlayerTemplate.ini` says so in a comment.
* `BaseSide` is not the same as `Side`: it is used for rank images, academy
  stats and the score screen, and the code compares it against literal
  `"USA"`, `"China"` and `"GLA"` (`Core/GameEngine/Source/Common/RTS/AcademyStats.cpp`,
  `Player.cpp:420`). A new army borrows one of the three, or those screens need
  engine changes.
* **Loading INI data feeds the replay CRC** (`initSubsystem(..., &xferCRC,
  ...)`). Any new content changes the CRC, so vanilla replays stop matching and
  modded games need their own baselines — which is exactly issue #55. The
  phase-2 oracle validates unmodified games only.
* **Strings.** Text lives in one binary `Data\English\generals.csf`, but the
  engine also merges `data/patch.str`, a plain-text overlay, as a second table
  (`Core/GameEngine/Source/GameClient/GameText.cpp:450`). A mod that ships its
  own `data/patch.str` would *replace* the retail one and lose its strings, so
  new factions need either a mod-specific overlay path or an engine-side list
  of overlays. Small task, must exist before the first faction.

## 8. Checklist for one new faction

The order matters: each step is visible in-game only after the previous one.

1. `PlayerTemplate Faction<Name>` with `Side`, `BaseSide`, `PlayableSide =
   Yes`, `IntrinsicSciences`, the three `PurchaseScienceCommandSetRankN`,
   `StartingBuilding`, `StartingUnit0`, `DisplayName`, the medallion and icon
   images.
2. `ControlBarScheme <Side>8x6`, copying an existing one and its images.
3. `IntrinsicSciences`: one `Science` block per faction, plus the
   `PurchaseScienceCommandSetRank1/3/8` command sets.
4. `CommandSet` for the faction and one per structure and unit.
5. `CommandButton` blocks for every entry of those sets, with an image.
6. `Object` for the command centre (with `KindOf = STRUCTURE ...
   FS_AIRFIELD ...`), then one worker, one unit, one weapon.
7. `Weapon`, `Armor`, `Locomotor`, `ObjectCreationList` and `FXList` entries
   those objects reference.
8. `AIData SideInfo <Side>` with `ResourceGatherersEasy/Normal/Hard`,
   `BaseDefenseStructure1` and the `SkillSet1/2/3` blocks, or the skirmish AI
   never builds the faction.
9. Strings for every `DisplayName`, `TextLabel` and `DescriptLabel`, in the
   overlay of §7.
10. Audio: `Speech`/`Voice`/`SoundEffects` entries only if the faction has new
    voices; silence is acceptable for a first pass.
11. A replay of a skirmish against the AI on the new faction, stored as its own
    CRC baseline (#55).
12. The provenance manifest and the guard (§9) must pass.

A faction is not done because it appears in the menu: it is done when the AI
builds it, it can be defeated, and its replay matches across runs.

Order of delivery, each one an issue: one replaced unit with clean art (the
pipeline proof) → a one-unit faction (data proof) → a full second army (art).

## 9. Manifest, provenance, and a conflict with the current guard

Every asset that ships needs one line: file, kind, source (`own`, `cc0`,
`cc-by`, `ai`), tool and version and prompt if AI, licence URL, author, date.
A JSONL file in the repository plus its check is the whole mechanism, and it
is what makes "we are clean" verifiable rather than asserted.

**Conflict to resolve first:** `scripts/check-no-ea-assets.sh` rejects files by
**extension** (`.w3d`, `.dds`, `.tga`, `.wav`, `.big`, `.map`, ...). Our own
clean models and textures use exactly those extensions, so the guard will
reject them. Two ways out, and it is a decision for the owner:

* keep shipped assets out of the git repository (built or downloaded as
  release artifacts), and leave the guard as it is; or
* let the guard accept a file listed in the provenance manifest with a
  non-EA source, and keep the extension check as the default.

The first is simpler and keeps the repository code-only; the second makes the
release reproducible from the repository. Until it is decided, no asset file
enters the repository.

## 10. Open decisions

* **D-0x, asset distribution:** assets in the repository with a manifest, or
  release artifacts only (§9).
* **D-0x, model format:** W3D writer, or glTF/KTX2 support in the engine (§6).
* **D-0x, scope:** is a standalone build with no game install a goal at all?
  If not, no original asset is ever replaced and §3's scale never matters.

## 11. Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Scope creep from "replace all assets" | Years of art, phases 1-3 delayed | Only new content ships; the port keeps using the player's files |
| AI output has no damage states, LODs or turret bones | Models unusable in game | Treat generation as concept and base mesh; the pipeline adds the contract (§3) |
| Licence terms change under a tool | Assets already shipped become unlicensed | Record tool, version and terms URL per asset; prefer MIT/CC0 tools |
| AI output not copyrightable | Cannot defend the assets legally | Acceptable for distribution; provenance is the protection |
| Guard blocks our own clean assets | Phase 4 stops at the first commit | Decide §9 before the first asset |
| New content changes the CRC | Vanilla replays fail on modded games | Separate baselines per content set (#55) |
