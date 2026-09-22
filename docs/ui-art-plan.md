# BENCHED: UI art plan for image generation

What to generate for the menus, upgrades and screens, with prompts to copy. The file names
match the keys in `js/app.js`, so wiring the art in later is mechanical.

**Order of work:** lock the style first (section 1), then do the tier 1 assets (they replace
the emoji and change the game most), then the screens in tier 2. Tier 3 is optional polish.

---

## 1. Rules for every image (read first)

1. **No text in images.** Generators garble lettering, and the game's text changes anyway
   (costs, levels, numbers). Every label stays in HTML/CSS. The only exceptions are the logo and
   the app icon (see 5.7 and 5.10).
2. **One palette**, taken from `style.css`:
   - background: near-black navy `#070b10`
   - accent: electric lime `#d6ff3f`
   - text white: `#f2f4f7`
   - warning red: `#ff5566`, good green: `#5fe08a`

   Generators don't obey hex codes exactly. Keep them in the prompt anyway, and reject images
   that drift.
3. **No real brands, clubs, competitions or players.** No sportswear stripes or logos, no league
   badges, no named footballers. Say "fictional" in the prompt.
4. **Consistency beats quality.** Use the same style block (section 2) word for word on every
   prompt in a set. If your tool supports it, use a **style reference image** (your first
   accepted icon) and a **fixed seed** for the rest of that set.
5. **Character reference.** For any art with the Captain in it, upload
   `.captures/rig-rest-front.png` (his in-game render) as the character or image reference, so
   the art matches the model in the game.
6. **Generate 4 variations per prompt** and pick one. Budget about 150 generations for tiers 1
   and 2.

### Tool notes
- **Midjourney:** add `--ar 1:1` (icons) or `--ar 16:9` (scenes), plus `--style raw`. Put the
  negatives after `--no`. Use `--sref <url>` to lock the style from your first good icon, and a
  character reference for the Captain.
- **ChatGPT / GPT-image:** plain language works. You can ask for a transparent-background PNG
  directly (useful for icons), and it's the best choice for the logo lettering.
- **Ideogram:** the strongest at lettering. Use it for the logo if you want it generated rather
  than typeset.
- **Stable Diffusion / Flux:** paste the negative block into the negative-prompt field where
  supported.

---

## 2. Style blocks (paste these)

**`STYLE-ICON`** (append to every icon prompt):
> game UI icon, bold flat vector emblem, thick clean silhouette readable at small size, electric
> lime (#d6ff3f) and off-white (#f2f4f7) only, one subtle soft glow, centered with generous
> padding, isolated on a solid flat black background, sports-broadcast graphic style, no text

**`STYLE-SCENE`** (append to every background or illustration prompt):
> cinematic night football stadium atmosphere, floodlight haze and volumetric light, deep
> navy-black palette (#070b10) with electric lime (#d6ff3f) rim-light accents, high contrast,
> realistic digital painting, shallow depth of field, subtle film grain, moody and quiet

**`NEGATIVE`** (Midjourney `--no`, or the negative field):
> text, letters, words, numbers, watermark, signature, logo, brand, sportswear stripes, league
> badge, frame, border, blurry, low contrast, extra limbs, deformed hands, cartoon, anime

---

## 3. Tier 1: highest impact

### 3.1 Upgrade icons (11)
They replace the emoji in the Training Room and fill the empty icon slot in the main menu's
permanent upgrades. Each prompt is **subject + `STYLE-ICON`**.

**Training Room** (per run, bought with match cash):

| File | Upgrade (effect) | Subject prompt |
|---|---|---|
| `poacher.png` | Poacher Instinct (odds of an extra chance) | the head of a hawk in sharp profile, its eye fixed on a small football |
| `target.png` | Target Practice (slower aim sweep) | a crosshair reticle locked onto the top corner of a football goal |
| `legday.png` | Leg Day (faster shots) | a powerful leg and boot mid-strike with speed lines, a football launching away |
| `icebath.png` | Ice Bath (corner shot magnetism) | a round ice bath tub filled with ice cubes, cold mist rising, one snowflake above it |
| `charm.png` | Media Charm (restores confidence) | a press-conference microphone with a camera flash bursting behind it |

**Main menu** (permanent, bought with Legacy Points):

| File | Upgrade (effect) | Subject prompt |
|---|---|---|
| `star.png` | Star Player Status (4 chances a match) | a football shirt seen from the front with one large bold star on its chest |
| `subnet.png` | Super Sub (bonus chance when confidence is low) | a touchline substitution board with one bold up arrow and one down arrow, no numbers |
| `talent.png` | Natural Talent (shot velocity) | a football streaking forward, trailing a jagged lightning bolt |
| `veins.png` | Ice in the Veins (slower aim sweep) | a heart carved from ice with a calm flat heartbeat line across it |
| `pet.png` | Manager's Pet (higher confidence ceiling) | a manager's tactics clipboard with a heart drawn on it |
| `boot.png` | Golden Boot (more cash per goal) | a gleaming golden football boot trophy on a small plinth |

**Full example**, exactly as you'd paste it:
> a crosshair reticle locked onto the top corner of a football goal, game UI icon, bold flat
> vector emblem, thick clean silhouette readable at small size, electric lime (#d6ff3f) and
> off-white (#f2f4f7) only, one subtle soft glow, centered with generous padding, isolated on a
> solid flat black background, sports-broadcast graphic style, no text `--ar 1:1 --style raw
> --no text, letters, logo, border`

**Tips**
- Do `target.png` and `boot.png` first. Once one looks right, use it as the style reference
  for the other nine.
- **Squint test:** shrink each candidate to 48 px (the size the game shows it at). If the
  silhouette doesn't read, reject it, however nice it looks large.
- For a tighter set, you can instead ask for all 11 in a single image ("an icon sheet, 4 by 3
  grid, evenly spaced, identical style") and slice it. The icons match better, but the sizes
  come out less even.

### 3.2 Currency icons (2)
Subject + `STYLE-ICON`.

| File | Used for | Subject prompt |
|---|---|---|
| `cash.png` | match cash ($), Training Room | a small stack of gold coins, the top coin embossed with a football pattern |
| `legacy.png` | Legacy Points, main menu | a laurel wreath around a single star, like a hall-of-fame medal |

### 3.3 Main menu key art (1, plus an optional phone version)
The game's opening image. **Composition matters more than detail:** he sits on the right third,
and the left half stays dark and empty for the menu panel.

> the team captain, a footballer in a white and gold kit with a black captain's armband and
> dark curly hair, sits alone on a substitutes' bench at the edge of a floodlit night stadium,
> elbows on his knees, looking out at the empty pitch; seen from low and to the side; he fills
> the right third of the frame and the left half is dark shadowed stand, left empty for
> interface text; [STYLE-SCENE] `--ar 16:9`

Upload the Captain render as the character reference. **Optional phone version:** the same
prompt at `--ar 9:16`, with "he sits in the lower half; the upper half is dark sky and
floodlights, left empty for interface text".

---

## 4. Tier 2: screens

### 4.1 Training Room background
> an empty football club recovery room at night: an ice bath, a physio table, a rack of weights
> and a tactics whiteboard with magnets but no writing, lit by cold fluorescent strips and one
> electric lime accent light; wide shot, the centre of the frame kept dark and uncluttered for
> interface panels; [STYLE-SCENE, but replace "night football stadium" with "night-time
> training facility"] `--ar 16:9`

### 4.2 "Benched" game-over art
The run-over screen. It should hurt a little.
> the same captain seen from behind, slumped on the substitutes' bench with a towel over his
> head, rain falling through the floodlight beams, the match continuing out of focus on the
> pitch; he sits low in the centre with dark empty space above him for a title; [STYLE-SCENE]
> `--ar 16:9`

### 4.3 Manager portraits: the confidence meter (5)
The **Manager Confidence** bar is the run's life bar, and a face reacting to it turns a number
into drama. The five portraits must be the **same man**, so generate them together as one
sheet and slice it:
> character expression sheet, five chest-up portraits of the same fictional football manager
> side by side in a row, in his fifties, grey stubble, dark overcoat over a club tracksuit,
> standing on a floodlit touchline at night; left to right: delighted and applauding, content
> with a small nod, neutral with folded arms, worried and rubbing his face, furious and
> shouting; identical lighting and framing in all five; [STYLE-SCENE] `--ar 5:1`

Files: `manager-1.png` (delighted) to `manager-5.png` (furious). Suggested mapping, which is
easy to change: 100%+, 70 to 99, 40 to 69, 15 to 39, under 15. If the faces drift across the
sheet, keep the best one and regenerate the others from it with a character reference.

---

## 5. Tier 3: optional polish

### 5.1 Logo emblem
Typeset **BENCHED** in a heavy condensed sans in CSS: it stays sharp at every size and costs
nothing. Generate only the emblem that sits beside it:
> a football club style crest: the silhouette of a substitutes' bench inside a shield, a single
> football resting on the bench, [STYLE-ICON]

**If you want the lettering generated** (use GPT-image or Ideogram):
> the word "BENCHED" in heavy condensed athletic block lettering, off-white with an electric
> lime (#d6ff3f) underline stroke, on solid black, clean vector, sports broadcast title style

Expect several tries before the letters come out clean.

### 5.2 Opponent crests (5)
The game already rotates five opponent kits. A crest per club would let a "vs" card open each
match (that's a new UI element to build). Each prompt is **"a fictional football club crest,
no text, [shape and emblem], in [colours], flat vector, isolated on solid black"**:

| File | Kit | Emblem and colours |
|---|---|---|
| `crest-crimson.png` | Crimson | a rearing lion on a round badge; crimson #c92f43 and cream #f4e8d2 |
| `crest-ivory.png` | Ivory | a swan on a shield; ivory #eee9db and deep red #b62e42 |
| `crest-gold.png` | Gold | a bee over a sunburst on a shield; gold #f2c344 and charcoal #28272b |
| `crest-forest.png` | Forest | an oak tree on a shield; forest green #268153 and cream #ece9db |
| `crest-plum.png` | Plum | a raven on a round badge; plum #963966 and cream #e8e3db |

### 5.3 Loading / splash
> a football resting on the penalty spot of an empty floodlit stadium at night, camera low to
> the grass, the goal soft and out of focus behind, lime rim light on the ball; [STYLE-SCENE]
> `--ar 16:9`

### 5.4 GOAL burst
The verdict text stays CSS; this is the burst behind it. It's drawn on pure black so it can
use `mix-blend-mode: screen`, and needs no transparency.
> abstract burst of electric lime (#d6ff3f) light streaks and small confetti radiating from the
> centre, on pure solid black, energetic, no text `--ar 16:9`

### 5.5 Crowd texture for the stands (in-game)
The stands currently use a procedural speckle.
> seamless tileable texture of a packed football stadium crowd at night seen from mid-distance,
> dark, scattered phone lights, scarves in mixed colours, no readable signs or banners
> `--ar 4:1 --tile`

Only Midjourney's `--tile` makes it seamless reliably. With other tools, use an offset-and-heal
pass in an editor.

### 5.6 App icon / favicon
> app icon: a black captain's armband with a bold white letter C on it, on a lime (#d6ff3f)
> rounded square, flat vector, centered

This is the one allowed letter. Most tools manage a single "C".

**Don't generate** these; they're better done in CSS or with an SVG icon set:
- the tiny HUD glyphs (clock, goals, chances), shown at 16 px
- the level pips
- the power bar
- button frames

---

## 6. Delivery specs

| Asset | Generate at | Ship as | Transparent | Folder |
|---|---|---|---|---|
| Upgrade + currency icons (13) | 1024×1024 | 256×256 PNG | yes | `assets/ui/icons/` |
| Manager portraits (5) | sheet at 5:1 | 512×512 PNG each | no | `assets/ui/manager/` |
| Opponent crests (5) | 1024×1024 | 256×256 PNG | yes | `assets/ui/crests/` |
| Menu, training, benched, splash | 16:9, largest the tool offers | 1920×1080 WebP, quality 80 (aim under 300 KB) | no | `assets/ui/bg/` |
| Phone key art (optional) | 9:16 | 1080×1920 WebP | no | `assets/ui/bg/` |
| GOAL burst | 16:9 | 1920×1080 WebP | no (screen blend) | `assets/ui/fx/` |
| Crowd texture | 4:1 | 2048×512 JPG | no | `assets/ui/tex/` |
| Logo emblem | 1024×1024 | 512×512 PNG | yes | `assets/ui/` |
| App icon | 1024×1024 | 512, 192, 32 PNG | no | `assets/ui/` |

- **Transparency:** ask GPT-image for a transparent PNG directly. With other tools, generate on
  solid black as the icon style block already says, then remove the background (any
  background-removal tool is fine for flat icons).
- **Padding:** crop each icon square with the subject at about 80% of the canvas, so a row of
  icons looks even.
- **Names:** use exactly the file names above; the icon names match the upgrade keys in
  `js/app.js`.

---

## 7. Checklist
- [ ] Style locked: `target.png` and `boot.png` accepted and used as the style reference
- [ ] 11 upgrade icons pass the 48 px squint test
- [ ] 2 currency icons
- [ ] Main menu key art (Captain on the right third, left half empty)
- [ ] Training Room background
- [ ] Benched art
- [ ] Manager sheet, sliced into 5
- [ ] Optional: emblem, crests, splash, GOAL burst, crowd texture, app icon
- [ ] Everything exported to the specs and folders in section 6
- [ ] Integration task briefed for Codex (see below)

## 8. Before integrating: two things to know
- **The backgrounds will barely show at first.** The menu and Training Room sit under a 90%
  opaque dark overlay (`#overlay` in `style.css`), so a new background would be almost
  invisible. The integration task must change the layout: for example, the menu panel on the
  left, the key art visible on the right, and a lighter overlay. That's one Codex task once the
  art exists. It would also swap the emoji for the icons, add the confidence portraits and put
  the currency icons next to the balances.
- **Remove the brand marks before any release.** The Captain's current texture (generated by
  Meshy) has sportswear-style stripes and logos and a competition-style badge baked in. That's
  fine while prototyping, but it's a trademark problem for anything public. The same goes for
  any generated art: reject images that sneak a real logo in.
