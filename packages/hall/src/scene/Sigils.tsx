import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector4,
} from "three"
import { PROBE } from "../guild/mode.ts"
import { quality } from "../guild/quality.ts"
import { positions, useGuildStore } from "../guild/useGuild.ts"
import { GLYPH_PATHS } from "../hud/glyphs.ts"
import { hudPrefs } from "../hud/prefs.ts"
import { sky } from "./atmosphere/state.ts"
import { wind } from "./atmosphere/wind.ts"
import { chipOf } from "./chips.ts"
import { FRAME } from "./frame.ts"
import { useOwned, useOwnedMeshes } from "./owned.ts"
import { MAX_PARTICLES, MAX_SIGILS, SIGIL_GLYPHS, SigilBoard } from "./sigilBoard.ts"
import { SIGIL_BOB_PX, SIGIL_GAP_PX, SIGIL_MAX_PX, SIGIL_MIN_PX, SIGIL_WORLD } from "./sigilSize.ts"

/**
 * Deed sigils (scene/sigilBoard.ts has the logic): a medallion over every working adventurer, an ink
 * disc with a brass rim tinted by the role's colour and the deed's glyph in paper, and a burst of
 * sparks or a puff when a deed ends. Two draw calls for the whole guild: one InstancedMesh of
 * camera-facing quads for every sigil (the glyph picked per instance from an atlas), one for every
 * burst particle (hidden when none is in the air). Both sit in screen space under each name chip,
 * sized in CSS px (scene/sigilSize.ts), drawn over the world like the chips, never in the shadow map.
 *
 * Decorative: the roster is the accessible list of who is doing what. Settings → "Sigils over agents".
 */
export function Sigils() {
  const store = useGuildStore()
  const board = useMemo(() => new SigilBoard(positions), [])
  useEffect(() => {
    // Automation (scripts/shot.ts): read what the sigils are doing.
    if (PROBE) Object.assign(window, { sigils: board, chipOf })
  }, [board])
  const uniforms = useMemo(
    () => ({
      uViewport: { value: new Vector2(1, 1) },
      uSize: { value: new Vector4(SIGIL_WORLD, SIGIL_MIN_PX, SIGIL_MAX_PX, SIGIL_GAP_PX) },
      uBob: { value: SIGIL_BOB_PX },
      uBright: { value: 1 },
      uPace: { value: 1 },
      // The shared render clock (atmosphere/wind.ts), by reference: the bob and the bursts' age.
      uTime: wind.uniforms.uTime,
      uInk: { value: new Color("#15110d") },
      uInkHi: { value: new Color("#3a2c1e") },
      uPaper: { value: new Color("#f3e9d4") },
    }),
    [],
  )

  // The atlas lives in a uniform, where freeing a layer's materials can't see it: it is owned on its own.
  const atlas = useOwned(sigilAtlas, (texture) => texture.dispose(), [])
  const built = useOwnedMeshes(
    () => ({ meshes: atlas ? [sigilMesh(board, uniforms, atlas), burstMesh(board, uniforms)] : [] }),
    [board, uniforms, atlas],
  )

  // Live moments only: a seek or a replay rebuilds history without a single pop (ADR 0008).
  useEffect(() => {
    const off = store.moments.on((moment) => board.take(moment))
    const offRebuild = store.moments.onRebuild(() => board.rebuild())
    return () => {
      off()
      offRebuild()
    }
  }, [store, board])

  const motion = useMemo(
    () => (typeof window === "undefined" ? null : window.matchMedia?.("(prefers-reduced-motion: reduce)")),
    [],
  )
  const seen = useMemo(() => ({ version: -1, prefs: hudPrefs.get() }), [])

  useFrame((state, delta) => {
    const sigils = built?.meshes[0]
    const sparks = built?.meshes[1]
    if (!sigils || !sparks) return
    // The views change at the store's refresh (~10×/s), not every frame: read them only then.
    const version = store.snapshot()
    const prefs = hudPrefs.get()
    if (version !== seen.version || prefs !== seen.prefs) {
      seen.version = version
      seen.prefs = prefs
      board.on = prefs.sigils
      board.still = motion?.matches ?? false
      board.sparks = quality.tier === 0 ? 6 : 10
      board.sync(store.views)
    }
    board.step(Math.min(delta, 0.1), wind.uniforms.uTime.value)
    sigils.count = board.write(state.camera)
    sigils.visible = sigils.count > 0
    for (const name of SIGIL_ATTRIBUTES) {
      const attribute = sigils.geometry.getAttribute(name) as InstancedBufferAttribute
      attribute.needsUpdate = true
    }
    if (board.burstsDirty) {
      board.burstsDirty = false
      for (const name of BURST_ATTRIBUTES)
        (sparks.geometry.getAttribute(name) as InstancedBufferAttribute).needsUpdate = true
    }
    sparks.visible = board.burstsUntil > board.now
    uniforms.uViewport.value.set(state.size.width, state.size.height)
    uniforms.uBob.value = board.still ? 0 : SIGIL_BOB_PX
    uniforms.uPace.value = board.pace
    // Self-lit, but under the bloom threshold at night (mood × 0.7): readable, never blown out.
    uniforms.uBright.value = 0.97 - 0.36 * sky.night
  }, FRAME.WORLD)

  if (!built?.meshes[0] || !built.meshes[1]) return null
  return (
    <>
      <primitive object={built.meshes[0]} />
      <primitive object={built.meshes[1]} />
    </>
  )
}

const SIGIL_ATTRIBUTES = ["aAnchor", "aState", "aRim", "aFlash"] as const
const BURST_ATTRIBUTES = ["aOrigin", "aMotion", "aLook", "aShape"] as const

type Uniforms = Record<string, { value: unknown }>

/** Shared by both meshes: the medallion's footing on screen, and its size there. */
const SCREEN = /* glsl */ `
  uniform vec2 uViewport;
  uniform vec4 uSize; // world diameter, min px, max px, gap px
  uniform float uTime;

  /** The anchor's clip position, and the medallion's size there in CSS px. */
  vec4 anchorClip(vec3 world, out float size) {
    vec4 clip = projectionMatrix * viewMatrix * vec4(world, 1.0);
    float perUnit = projectionMatrix[1][1] * uViewport.y * 0.5 / clip.w;
    size = clamp(uSize.x * perUnit, uSize.y, uSize.z);
    return clip;
  }

  /** Moves a clip position by CSS px on screen. */
  vec4 offsetPx(vec4 clip, vec2 px) {
    clip.xy += px * 2.0 / uViewport * clip.w;
    return clip;
  }
`

/** The quad spans radius 1; the medallion's edge is at DISC (the rest is its soft shadow). */
const DISC = 0.8

function sigilMesh(board: SigilBoard, uniforms: Uniforms, atlas: CanvasTexture): InstancedMesh {
  const geometry = new PlaneGeometry(2, 2)
  const { anchor, state, rim, flash } = board.sigils
  geometry.setAttribute("aAnchor", dynamic(anchor, 4))
  geometry.setAttribute("aState", dynamic(state, 4))
  geometry.setAttribute("aRim", dynamic(rim, 4))
  geometry.setAttribute("aFlash", dynamic(flash, 4))
  const material = new ShaderMaterial({
    uniforms: { ...uniforms, uAtlas: { value: atlas } },
    vertexShader: /* glsl */ `
      ${SCREEN}
      uniform float uBob;
      attribute vec4 aAnchor; // xyz, shake px
      attribute vec4 aState;  // cell, alpha, scale, lift px
      attribute vec4 aRim;    // rgb, bob phase
      attribute vec4 aFlash;  // rgb, amount
      varying vec2 vLocal;
      varying float vCell;
      varying float vAlpha;
      varying vec3 vRim;
      varying vec4 vFlash;
      void main() {
        float size;
        vec4 clip = anchorClip(aAnchor.xyz, size);
        float radius = size / (2.0 * ${DISC.toFixed(2)}) * aState.z;
        float bob = sin(uTime * 2.1 + aRim.w) * uBob;
        vec2 centre = vec2(aAnchor.w, aState.w + uSize.w + size * 0.5 + bob);
        gl_Position = offsetPx(clip, centre + position.xy * radius);
        vLocal = position.xy;
        vCell = aState.x;
        vAlpha = aState.y;
        vRim = aRim.rgb;
        vFlash = aFlash;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform float uBright;
      uniform vec3 uInk;
      uniform vec3 uInkHi;
      uniform vec3 uPaper;
      varying vec2 vLocal;
      varying float vCell;
      varying float vAlpha;
      varying vec3 vRim;
      varying vec4 vFlash;
      const float DISC = ${DISC.toFixed(2)};
      const float FACE = 0.69;    // the inner ink face; the rim is FACE..DISC
      const float ICON = 0.62;    // half the glyph box
      void main() {
        float r = length(vLocal);
        float aa = fwidth(r);
        float disc = 1.0 - smoothstep(DISC - aa, DISC + aa, r);
        float onRim = smoothstep(FACE - aa, FACE + aa, r);
        // Ink face, a touch warmer at the top: a struck coin, not a flat dot.
        float top = clamp(vLocal.y * 0.7 + 0.5, 0.0, 1.0);
        vec3 face = mix(uInk, uInkHi, top * 0.55);
        // Brass rim tinted by the role, lit from above; a pop washes it in success or failure.
        vec3 rim = mix(vRim, vFlash.rgb, vFlash.a) * (0.9 + 0.4 * top);
        vec3 colour = mix(face, rim, onRim);
        // A dark seam between rim and face, and a dark outer line, so the rim reads on bright grass.
        float seam = 1.0 - smoothstep(0.0, aa * 1.6, abs(r - FACE));
        float edge = smoothstep(DISC - aa * 2.5, DISC - aa * 0.5, r);
        colour = mix(colour, uInk, max(seam * 0.7, edge * 0.85));
        // The glyph: from the atlas (mipmapped, so it stays smooth small), always sampled, masked
        // to its box (no texture read in a branch).
        vec2 g = vLocal / ICON;
        vec2 box = clamp(g, -1.0, 1.0);
        vec2 cell = vec2(mod(vCell, 4.0), floor(vCell / 4.0));
        vec2 uv = vec2((cell.x + box.x * 0.5 + 0.5) / 4.0, 1.0 - (cell.y + 0.5 - box.y * 0.5) / 4.0);
        float glyph = texture2D(uAtlas, uv, -0.6).a * step(max(abs(g.x), abs(g.y)), 1.0) * (1.0 - onRim);
        colour = mix(colour, mix(uPaper, vFlash.rgb, vFlash.a * 0.45), glyph);
        // A soft shadow just outside the rim lifts it off busy ground.
        float shade = (1.0 - smoothstep(DISC, 1.0, r)) * 0.4;
        float alpha = disc + (1.0 - disc) * shade;
        gl_FragColor = vec4(colour * uBright * disc / max(alpha, 1e-4), alpha * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  return overlay(new InstancedMesh(geometry, material, MAX_SIGILS), 30)
}

function burstMesh(board: SigilBoard, uniforms: Uniforms): InstancedMesh {
  const geometry = new PlaneGeometry(2, 2)
  const { origin, motion, look, shape } = board.bursts
  geometry.setAttribute("aOrigin", dynamic(origin, 3))
  geometry.setAttribute("aMotion", dynamic(motion, 4))
  geometry.setAttribute("aLook", dynamic(look, 4))
  geometry.setAttribute("aShape", dynamic(shape, 4))
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${SCREEN}
      attribute vec3 aOrigin;
      attribute vec4 aMotion; // velocity px/s, birth s, life s
      attribute vec4 aLook;   // rgb, kind (0 spark, 1 puff)
      attribute vec4 aShape;  // lift px, size px, growth, drag
      uniform float uPace;
      varying vec2 vLocal;
      varying vec4 vLook;
      varying float vFade;
      void main() {
        float age = (uTime - aMotion.z) * uPace;
        float t = age / max(aMotion.w, 1e-3);
        if (aMotion.w <= 0.0 || t < 0.0 || t > 1.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // dead: outside the clip box
          return;
        }
        float size;
        vec4 clip = anchorClip(aOrigin, size);
        vec2 centre = vec2(0.0, aShape.x + uSize.w + size * 0.5);
        vec2 dir = normalize(aMotion.xy + 1e-4);
        // Out of the medallion's rim, slowing as it goes.
        float travel = (1.0 - exp(-aShape.w * age)) / aShape.w;
        vec2 at = centre + dir * size * 0.38 + aMotion.xy * travel;
        float scale = aShape.y * max(0.2, 1.0 + aShape.z * t) * 0.5;
        gl_Position = offsetPx(clip, at + position.xy * scale);
        vLocal = position.xy;
        vLook = aLook;
        vFade = smoothstep(0.0, 0.06, t) * pow(1.0 - t, 1.3);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBright;
      varying vec2 vLocal;
      varying vec4 vLook;
      varying float vFade;
      void main() {
        float r = length(vLocal);
        float alpha;
        vec3 colour = vLook.rgb;
        if (vLook.a < 0.5) {
          // A four-point glint: a hot core and two thin arms.
          float arms = (1.0 - smoothstep(0.0, 0.16, min(abs(vLocal.x), abs(vLocal.y)))) * (1.0 - smoothstep(0.15, 1.0, r));
          float core = 1.0 - smoothstep(0.0, 0.45, r);
          alpha = max(core, arms * 0.9);
          colour = mix(colour, vec3(1.0, 0.96, 0.86), core * 0.45);
        } else {
          // A soft round puff.
          alpha = (1.0 - smoothstep(0.25, 1.0, r)) * 0.7;
        }
        gl_FragColor = vec4(colour * uBright, alpha * vFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = overlay(new InstancedMesh(geometry, material, MAX_PARTICLES), 31)
  mesh.visible = false
  return mesh
}

/** Drawn over the world like the chips: no culling (the quads are placed in the shader), no shadows, no picking. */
function overlay(mesh: InstancedMesh, order: number): InstancedMesh {
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = order
  mesh.raycast = () => {}
  return mesh
}

function dynamic(array: Float32Array, size: number): InstancedBufferAttribute {
  return new InstancedBufferAttribute(array, size).setUsage(DynamicDrawUsage)
}

/** Atlas cell size: 4 × 4 cells of 128 px, so mip levels keep cells apart down to 16 px. */
const CELL_PX = 128
const PAD_PX = 10

/**
 * The glyphs, white on clear, painted once from hud/glyphs.ts at startup: 128 px a cell holds a
 * 30 px sigil at Retina density with room to spare, and trilinear mipmaps keep the strokes smooth
 * when it is small. Strokes a little heavier than the HUD's 1.5, for the world's busier ground.
 */
function sigilAtlas(): CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = CELL_PX * 4
  const g = canvas.getContext("2d")
  if (g) {
    g.strokeStyle = "#ffffff"
    g.lineCap = "round"
    g.lineJoin = "round"
    g.lineWidth = 1.7
    const scale = (CELL_PX - PAD_PX * 2) / 16
    SIGIL_GLYPHS.forEach(([, glyph], i) => {
      g.save()
      g.translate((i % 4) * CELL_PX + PAD_PX, Math.floor(i / 4) * CELL_PX + PAD_PX)
      g.scale(scale, scale)
      for (const d of GLYPH_PATHS[glyph]) g.stroke(new Path2D(d))
      g.restore()
    })
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = NoColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 4
  return texture
}
