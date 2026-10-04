// Regenerates every committed app-icon output from the SVG masters in build/icon-source/.
// Runs under `electron`, not `node`: Chromium rasterizes the SVGs, so the repo needs no image
// dependency. The macOS .icon isn't generated here: it's assembled by hand in Icon Composer from
// the layers/ this script writes, because Apple hasn't published the .icon format.
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SOURCE = join(ROOT, 'build/icon-source')
const ICO_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]
// Below this the sparkle and the cap gap blur into noise, so the .ico switches to the simplified
// master. Windows only picks these hand-tuned sizes at 100% scaling.
const SMALL_ART_BELOW = 30
const LAYERS = ['magnet', 'caps', 'sparkle']

const full = readFileSync(join(SOURCE, 'icon.svg'), 'utf8')
const small = readFileSync(join(SOURCE, 'icon-small.svg'), 'utf8')

// Software rendering keeps the output identical across machines, whatever their GPU.
app.disableHardwareAcceleration()

async function rasterize(win, svg, px, output) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const result = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(src)}
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ${px}
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, ${px}, ${px})
    return ${output === 'png' ? 'canvas.toDataURL()' : `Array.from(ctx.getImageData(0, 0, ${px}, ${px}).data)`}
  })()`)
  return output === 'png' ? Buffer.from(result.split(',')[1], 'base64') : Buffer.from(result)
}

// 32-bit BMP as ICO stores it: BGRA rows bottom-up, the header height doubled to cover the AND
// mask, and the mask left all zero because the alpha channel does the masking.
function bmpEntry(rgba, px) {
  const pixels = Buffer.alloc(px * px * 4)
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const from = (y * px + x) * 4
      const to = ((px - 1 - y) * px + x) * 4
      pixels[to] = rgba[from + 2]
      pixels[to + 1] = rgba[from + 1]
      pixels[to + 2] = rgba[from]
      pixels[to + 3] = rgba[from + 3]
    }
  }
  const andMask = Buffer.alloc(Math.ceil(px / 32) * 4 * px)
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(px, 4)
  header.writeInt32LE(px * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(pixels.length + andMask.length, 20)
  return Buffer.concat([header, pixels, andMask])
}

function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length
  entries.forEach(({ px, data }, i) => {
    // A width/height byte of 0 means 256.
    directory[i * 16] = px % 256
    directory[i * 16 + 1] = px % 256
    directory.writeUInt16LE(1, i * 16 + 4)
    directory.writeUInt16LE(32, i * 16 + 6)
    directory.writeUInt32LE(data.length, i * 16 + 8)
    directory.writeUInt32LE(offset, i * 16 + 12)
    offset += data.length
  })
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)])
}

function readIcoSizes(buffer) {
  return Array.from({ length: buffer.readUInt16LE(4) }, (_, i) => buffer[6 + i * 16] || 256)
}

// Icon Composer layers are full-bleed and macOS applies the squircle mask itself, so each group
// is scaled until the master's tile edge meets the 1024 canvas edge.
function writeLayers() {
  const [, inset, tile] = full.match(
    /<rect id="background" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/
  )
  LAYERS.forEach((id, i) => {
    const group = full.match(new RegExp(`<g id="${id}"[\\s\\S]*?</g>`))?.[0]
    if (!group) throw new Error(`icon.svg has no <g id="${id}">`)
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n` +
      `  <g transform="scale(${1024 / tile}) translate(-${inset} -${inset})">\n  ${group}\n  </g>\n</svg>\n`
    writeFileSync(join(SOURCE, 'layers', `${i + 1}-${id}.svg`), svg)
  })
}

async function main() {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')

  const entries = []
  for (const px of ICO_SIZES) {
    if (px >= 256) {
      entries.push({ px, data: await rasterize(win, full, px, 'png') })
    } else {
      const rgba = await rasterize(win, px < SMALL_ART_BELOW ? small : full, px, 'rgba')
      entries.push({ px, data: bmpEntry(rgba, px) })
    }
  }
  const icoFile = ico(entries)
  writeFileSync(join(ROOT, 'build/icon.ico'), icoFile)
  writeFileSync(join(ROOT, 'resources/icon.ico'), icoFile)
  writeFileSync(join(ROOT, 'resources/icon.png'), await rasterize(win, full, 512, 'png'))
  writeLayers()

  const written = readIcoSizes(readFileSync(join(ROOT, 'build/icon.ico')))
  if (written.join() !== ICO_SIZES.join()) {
    throw new Error(`icon.ico has sizes ${written.join(', ')}, expected ${ICO_SIZES.join(', ')}`)
  }
  console.log(`icon.ico: ${written.join(', ')} px (sparkle from ${SMALL_ART_BELOW} px up)`)
  console.log('resources/icon.png: 512 px')
  console.log(`layers: ${LAYERS.map((id, i) => `${i + 1}-${id}.svg`).join(', ')}`)
}

app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error)
      app.exit(1)
    }
  )
