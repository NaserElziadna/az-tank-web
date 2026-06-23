# Using the original image assets

The game renders with built-in **vector art by default**, so it runs with no
asset files. To get the original's exact look, drop the image files into
`public/assets/…` (Vite serves `public/` at the site root, so the loader finds
them at `/assets/…`). The renderer detects them on load and swaps the vector
tank/coin/gem for the real sprites automatically — no code change needed.

## Where the files go

Copy these from your local download
(`cdn.tanktrouble.com/cdn.tanktrouble.com/RELEASE-2026-05-11-01/assets/images/`)
into the project's `public/assets/` folder, keeping the same sub-folders:

```
public/assets/
  tankIcon/
    base-320.png        baseShade-320.png
    turret-320.png      turretShade-320.png
    barrel-320.png      barrelShade-320.png
    leftTread-320.png   leftTreadShade-320.png
    rightTread-320.png  rightTreadShade-320.png
  game/
    gold.png  diamond.png  diamondGlow.png  diamondRays.png
    sparkle.png  celebration.png  game.png
  menu/
    background.png
  playerPanel/
    playerPanel.png
```

### One-shot copy (run it yourself)

PowerShell, from the project root:

```powershell
$src = "cdn.tanktrouble.com\cdn.tanktrouble.com\RELEASE-2026-05-11-01\assets\images"
foreach ($d in "tankIcon","game","menu","playerPanel") {
  New-Item -ItemType Directory -Force "public\assets\$d" | Out-Null
  Copy-Item "$src\$d\*" "public\assets\$d\" -Force
}
```

Git-bash equivalent:

```bash
src="cdn.tanktrouble.com/cdn.tanktrouble.com/RELEASE-2026-05-11-01/assets/images"
for d in tankIcon game menu playerPanel; do
  mkdir -p "public/assets/$d" && cp "$src/$d/"* "public/assets/$d/"
done
```

## What uses what

| Asset | Used for |
| --- | --- |
| `tankIcon/*-320.png` + `*Shade-320.png` | Tank body — composited & tinted per player colour (`TankIconCompositor`) |
| `game/gold.png`, `game/diamond.png` | Gold coin / diamond pickups |
| `menu/background.png` | Menu screen background (CSS) |
| `game/game.png` | Packed sheet of wall/floor tiles + effects (no atlas shipped — walls stay vector for now; see note) |
| `playerPanel/playerPanel.png` | HUD panel glyphs (skull/score shards) |

## Tuning after first look (since I can't run it)

If the **tank points the wrong way or is sized oddly**, edit `SPRITE` at the top
of `src/phaser/PhaserRenderer.js`:

- `rotationOffset` — try `0`, `Math.PI/2`, `-Math.PI/2`, or `Math.PI`.
- `lengthScale` — increase/decrease to match the maze scale.

## Note on the maze tiles (`game.png`)

`game.png` is a single packed image with **no frame atlas** in the release, so
wall/floor tiles can't be sliced reliably without the original frame
coordinates. Walls/floor therefore stay on the (light-grey) vector renderer,
which already matches the original's tone. If you can find or recreate the frame
coordinates, I can wire the sheet in too.
