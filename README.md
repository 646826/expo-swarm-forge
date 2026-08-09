# Swarm Browser Game Starter

A small, dependency-free foundation for teaching disciplined browser-game development with a project-local [SwarmForge](https://github.com/unclebob/swarm-forge) team.

The repository deliberately separates deterministic game rules from Canvas presentation, DOM UI, Web Audio, persistence, and publisher-platform adapters. The reusable starter is committed before the complete casual-game example so the history also teaches incremental delivery.

## Play Canyon Charms

The immutable public preview is pinned to an exact merged commit:

**[Play Canyon Charms](https://rawcdn.githack.com/646826/expo-swarm-forge/baf9e0f510b9434931673561603f1b9c5b994f2a/example/canyon-charms/index.html)**

A dedicated GitHub Actions smoke test verifies the preview HTML, CSS, every ES module, MIME types, and the game title. This third-party mirror is the immediate preview while the repository owner completes the one-time GitHub Pages source selection described in [`docs/CANYON_CHARMS_DELIVERY.md`](docs/CANYON_CHARMS_DELIVERY.md).

## Five-minute start

Requirements: Node.js 22 or newer. No package installation is needed.

```bash
npm test
npm run check -- --project template/browser-game
npm run build -- --project template/browser-game
npm run serve -- template/browser-game/dist 4173
```

Open `http://127.0.0.1:4173`.

Create a new game:

```bash
npm run create -- my-game "My Game"
npm run check -- --project games/my-game
npm run serve -- games/my-game 4173
```

## SwarmForge

Install `zsh`, `git`, `tmux`, Babashka (`bb`), and at least one supported coding-agent CLI. Then run:

```bash
./swarm
```

The first run downloads only the shared SwarmForge operational scripts. Project rules, topology, and role prompts remain versioned in this repository.

| Role | Owns |
|---|---|
| director | specification, slicing, integration, release truth |
| gameplay | deterministic rules and unit tests |
| presentation | Canvas, DOM, input, animation, audio, accessibility |
| qa | browser verification, screenshots, package and deployment evidence |

See [`docs/SWARMFORGE_GUIDE.md`](docs/SWARMFORGE_GUIDE.md).

## Commands

```bash
npm test                                      # all Node tests
npm run check                                 # every discovered game
npm run check -- --project path/to/game       # one game
npm run build -- --project path/to/game       # static dist + SHA-256 manifest
npm run package -- --project path/to/game     # deterministic ZIP
npm run serve -- path/to/static/files 4173    # local preview
```

The complete original match-3 reference game lives under `example/canyon-charms/`.
