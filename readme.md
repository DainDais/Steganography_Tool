<div align="center">

```
 ███████ ████████ ███████  ██████   █████  ███    ██  ██████  ███████
 ██         ██    ██      ██       ██   ██ ████   ██ ██    ██ ██
 ███████    ██    █████   ██   ███ ███████ ██ ██  ██ ██    ██ ███████
      ██    ██    ██      ██    ██ ██   ██ ██  ██ ██ ██    ██      ██
 ███████    ██    ███████  ██████  ██   ██ ██   ████  ██████  ███████
```

**multi-carrier steganography**

*Hide encrypted messages inside images and ordinary text —<br>then try to catch yourself doing it.*

[![Live Demo](https://img.shields.io/badge/demo-live-ffb000?style=flat-square)](https://daindais.github.io/Steganography_Tool/)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646cff?style=flat-square&logo=vite&logoColor=white)
![Tests](https://img.shields.io/badge/tests-38%20passing-4ade80?style=flat-square)
![Dependencies](https://img.shields.io/badge/runtime%20deps-0-9a6b00?style=flat-square)

</div>

---

```
┌──────────────────────────────────────────────────────────────────┐
│  STEGANOS                                              23:55:47  │
│  multi-carrier steganography                                     │
│ ════════════════════════════════════════════════════════════════ │
│  ──                                                              │
│                                                                  │
│ ▌operation — carrier — cover — payload — secure — run            │
│                                                                  │
│ ▌choose an operation                                             │
│                                                                  │
│ ▌hide                                                            │
│  reveal                                                          │
│  capacity                                                        │
│  detect                                                          │
│                                                                  │
│  embed an encrypted payload inside a cover                       │
│                                                                  │
│  ↑/↓ move │ enter select │ esc back │ ctrl+r restart             │
└──────────────────────────────────────────────────────────────────┘
```

<div align="center">
<sub>Everything runs locally in your browser. Nothing is sent anywhere.</sub>
</div>

---

## ▌ What it does

Steganography hides the **existence** of a message; cryptography hides its
**contents**. This does both — your message is encrypted with AES-256-GCM,
then tucked into a carrier file where nobody has reason to look.

| Carrier | Method | Capacity |
|---|---|---|
| **Image** | Last bit of each RGB channel — one step out of 255, invisible | `w × h × 3 ÷ 8` bytes |
| **Text** | Zero-width Unicode between visible letters | 1 byte per 8 characters |

Two **detectors** attack the first half. Chi-square analysis finds the
statistical fingerprint bit-flipping leaves in a color histogram; sample
pair analysis takes an independent angle via neighboring pixels. Building
both sides was the point — a hiding tool alone doesn't teach you what makes
hiding detectable.

The interface is a keyboard-driven wizard styled after amber phosphor
terminals: scanlines, monospace grid, keybind bar along the bottom. Sound
effects are **synthesized live** through the Web Audio API rather than
loaded as files — real terminals had a single-tone beeper, not a sample
library.

---

## ▌ Background and how this was built

I came in with **Python** and **GameMaker** experience, plus some **Java**.
What I didn't have was the modern JavaScript ecosystem, TypeScript, browser
APIs, or any experience shipping something to a URL other people can open.

Built in collaboration with Claude, and I'd rather be straightforward about
that than imply otherwise.

> **The AI wrote the core logic** — bit manipulation, encryption, the
> statistical detectors, the wizard state machine.
>
> **I directed the architecture and ran every tool myself** — choosing
> TypeScript for this problem, deciding on a keyboard wizard over a command
> parser, setting the visual and audio direction, building detection
> alongside hiding. Node, npm, Vite, Vitest, Git, GitHub Actions, VS Code —
> and the debugging, which is where most of the learning happened.

What I was after wasn't *how to write code*. It was everything **around**
the code: how a project gets scaffolded, why a dev server is a long-running
process, what CI means in practice, how a static site gets from a folder on
my laptop to a public URL. That layer is invisible in coursework, where you
hand in a file and someone else runs it.

---

## ▌ Things that broke

<details>
<summary><b>I typed Git commands into a dev server for ten minutes</b></summary>

`npm run dev` occupies the terminal until you stop it; everything after went
to Vite, which ignored it silently. The lesson was reading a terminal's
state — noticing when the prompt is absent and knowing what that means.

</details>

<details>
<summary><b>"X is not a function," three separate times</b></summary>

Every instance was an unsaved file. The test runner reads disk, not my
editor buffer. The third time I turned on autosave and the whole class of
problem vanished.

</details>

<details>
<summary><b>Tests passed while the project refused to compile</b></summary>

One file was empty, and the only thing importing it used a type-only
import — stripped before tests run. Type-checking and test-running are
separate pipelines.

</details>

<details>
<summary><b>A detector that couldn't distinguish anything</b></summary>

My scorer scaled linearly and clamped at `1.0`, so clean and embedded images
both maxed out. The detector worked; the scale had no headroom to show it.

</details>

<details>
<summary><b>A threshold I'd picked by feel</b></summary>

Set at `0.6` because it seemed reasonable. The math showed fully-embedded
data lands at `≈0.607` — the classifier was flipping a coin exactly where it
mattered. Now documented as provisional rather than presented as validated.

</details>

<details>
<summary><b>A failing test that was itself wrong</b></summary>

Expected `-9`, got `0`. Zero was correct: text under 79 characters can't
hold even the header. The reflex to "fix" code until a test goes green
produces broken functions with passing suites.

</details>

<details>
<summary><b>TypeScript caught something I didn't know existed</b></summary>

Its type system distinguishes regular from shared memory buffers, and Web
Crypto rejects shared ones — another thread could alter your plaintext
mid-encryption. A real vulnerability class, flagged at compile time.

</details>

---

## ▌ Architecture

```
 application ──────────────  keyboard wizard, sound
      │
 security ─────────────────  AES-GCM, PBKDF2 key derivation
      │
 position selection ───────  password-seeded scattering
      │
 carrier embedding ────────  format-specific bit writing
                             ├── image  (LSB)
                             └── text   (zero-width unicode)
```

The encryption and scattering layers don't know whether their bits end up in
pixels or Unicode characters. That's why adding the text carrier after the
image carrier meant writing one module rather than restructuring anything.

Every payload carries a **10-byte header**:

| Offset | Size | Field |
|:---:|:---:|---|
| `0` | 4 | Magic marker `STG2` |
| `4` | 1 | Format version |
| `5` | 1 | Flags — bit 0 = encrypted |
| `6` | 4 | Payload length |

The magic marker distinguishes *"nothing hidden here"* from *"wrong
password."* Without it, a failed extraction returns convincing garbage
instead of a clean error.

---

## ▌ Limitations

> The detection threshold is **uncalibrated** — treat the flag as a nudge,
> not a verdict.

- Detection confidence scales with how full the carrier is. A short message
  in a large photo is nearly invisible to these methods — the shape of the
  problem, not a flaw.
- Position scattering uses a fast non-cryptographic generator. It defeats
  sequential analysis but isn't a security boundary; AES protects contents.
- Images must be **PNG or BMP**. JPEG compression discards exactly the bits
  the payload lives in.

---

## ▌ Running it

```bash
npm install
npm run dev          # dev server
npm test             # 38 tests
npx tsc --noEmit     # type check
npm run build        # production build
```

Deploys via GitHub Actions on push to `main`. The pipeline runs the test
suite **before** building, so a failing test blocks the deploy.

<div align="center">
<br>
<sub>TypeScript · Vite · Vitest · Web Crypto API · Web Audio API<br>
<b>Zero runtime dependencies</b></sub>
</div>
