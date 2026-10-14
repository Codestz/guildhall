/**
 * The work FX's shader: every particle's place, size, colour and fade are worked out here from its
 * burst's origin and time and its own seed (`aOrigin`, `aInfo`), at the clock `uTime`, so the CPU never
 * touches a particle after it is spawned and the same seed at the same age always draws the same.
 *
 * One quad per particle (a camera-facing card; a spark a streak along its motion; a ring flat on the
 * water). Premultiplied output with blend (1, 1 − α): a particle writing α 0 adds its light (sparks,
 * motes, a glint), the others blend over. Lit kinds take the day's light (`uLight`), the glowing ones
 * keep theirs. Everything thins out between `uFade` metres from the camera, so a zoom never pops one.
 */
import { swatch } from "../events/fxMaterial.ts"
import { KIND } from "./kinds.ts"

const v3 = (c: [number, number, number]) => `vec3(${c.map((x) => x.toFixed(4)).join(", ")})`

const COL = {
  glow: v3(swatch("glow")),
  orange: v3(swatch("orange")),
  orangeLight: v3(swatch("orange-light")),
  timberLight: v3(swatch("timber-light")),
  sandLight: v3(swatch("sand-light")),
  sand: v3(swatch("sand")),
  stoneLight: v3(swatch("stone-light")),
  greyLight: v3(swatch("grey-light")),
  foam: v3(swatch("water-foam")),
  dirtLight: v3(swatch("dirt-light")),
  dirt: v3(swatch("dirt")),
  timberLightWood: v3(swatch("timber-light")),
  red: v3(swatch("banner-red")),
  blue: v3(swatch("roof-blue")),
  green: v3(swatch("teal")),
  whitewash: v3(swatch("whitewash")),
  snowLight: v3(swatch("snow-light")),
  tealLight: v3(swatch("teal-light")),
  gold: v3(swatch("gold")),
}

export const VERTEX = /* glsl */ `
attribute vec4 aOrigin;
attribute vec4 aInfo;
uniform float uTime;
uniform vec3 uLight;
uniform vec2 uFade;
varying vec2 vUv;
varying vec3 vColour;
varying float vAlpha;
varying float vAdd;
varying float vShape;

const float G = 9.8;

// a seeded uniform in [0, 1): the same on every GPU (integer hash)
float rnd(float seed, float k) {
  uint x = uint(seed * 4194304.0) ^ (uint(k) * 0x9E3779B9u);
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return float(x) / 4294967295.0;
}

vec2 turn(vec2 v, float a) {
  float c = cos(a); float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// a thrown particle: out at (th, r), up at u, under gravity, resting on the floor f (metres under o)
vec3 thrown(vec3 o, float th, float r, float u, float a, float f) {
  vec3 p = o + vec3(cos(th) * r * a, u * a - 0.5 * G * a * a, sin(th) * r * a);
  if (p.y < o.y - f) {
    // landed: where it came down, on the floor
    float land = (u + sqrt(u * u + 2.0 * G * f)) / G;
    p = o + vec3(cos(th) * r * land, -f, sin(th) * r * land);
  }
  return p;
}

void main() {
  vec2 corner = position.xy;
  vUv = corner;
  vec3 o = aOrigin.xyz;
  float kind = aInfo.x;
  float seed = aInfo.y;
  float scale = aInfo.z;
  float yaw = aInfo.w;
  float age = uTime - aOrigin.w;

  vec3 p = o;
  float size = 0.0;
  vec2 stretch = vec2(1.0);
  float spin = 0.0;
  float alpha = 0.0;
  float add = 0.0;
  float shape = 0.0; // 0 soft disc, 1 card, 2 star, 3 ring, 4 streak, 5 puff
  bool lit = true;
  float life = 1.0;
  vec3 colour = vec3(1.0);
  float th = rnd(seed, 1.0) * 6.2832;
  // a streak's tail (shape 4): where it was a moment ago
  vec3 prev = o;

  if (kind < ${KIND.sparks.id}.5) {
    life = 0.28 + 0.3 * rnd(seed, 2.0);
    float u = life > 0.0 ? age / life : 1.0;
    // up and out, a little toward where the hammer faces
    float r = 1.2 + 2.4 * rnd(seed, 3.0);
    p = thrown(o, th, r, 2.2 + 2.8 * rnd(seed, 4.0), age, 0.9);
    p.xz += vec2(sin(yaw), cos(yaw)) * 0.6 * age;
    float agoS = max(age - 0.05, 0.0);
    prev = thrown(o, th, r, 2.2 + 2.8 * rnd(seed, 4.0), agoS, 0.9);
    prev.xz += vec2(sin(yaw), cos(yaw)) * 0.6 * agoS;
    size = 0.035 * scale;
    colour = mix(${COL.glow}, ${COL.orange}, clamp(u * 1.3, 0.0, 1.0)) * 5.0;
    alpha = 1.0 - u * u;
    add = 1.0; shape = 4.0; lit = false;
  } else if (kind < ${KIND.stone.id}.5) {
    bool wood = kind < ${KIND.chips.id}.5;
    life = (wood ? 0.6 : 0.5) + 0.3 * rnd(seed, 2.0);
    float u = age / life;
    float r = (wood ? 1.0 : 1.4) + 1.5 * rnd(seed, 3.0);
    p = thrown(o, th, r, (wood ? 1.5 : 1.8) + 1.6 * rnd(seed, 4.0), age, 0.55 * scale);
    size = (wood ? 0.13 : 0.1) * (0.8 + 0.6 * rnd(seed, 5.0)) * scale;
    stretch = wood ? vec2(1.0, 0.45) : vec2(1.0, 0.8);
    spin = age * (8.0 + 10.0 * rnd(seed, 6.0)) * (rnd(seed, 7.0) < 0.5 ? -1.0 : 1.0);
    colour = wood
      // dark bark and brown wood read on sand and on logs; the odd fresh-cut orange flake
      ? (rnd(seed, 9.0) < 0.25
          ? mix(${COL.orange}, ${COL.orangeLight}, rnd(seed, 8.0))
          : mix(${COL.dirt}, ${COL.timberLightWood}, rnd(seed, 8.0)))
      : mix(${COL.stoneLight}, ${COL.greyLight}, rnd(seed, 8.0));
    alpha = 1.0 - smoothstep(0.7, 1.0, u);
    shape = 1.0;
  } else if (kind < ${KIND.splash.id}.5) {
    float up = 2.0 + 2.2 * rnd(seed, 4.0);
    life = min(${KIND.splash.life.toFixed(2)}, 2.0 * up / G);
    float u = age / life;
    p = thrown(o, th, 0.3 + 0.9 * rnd(seed, 3.0), up, age, 1.0);
    size = (0.09 + 0.06 * rnd(seed, 5.0)) * scale;
    colour = mix(${COL.foam}, vec3(1.0), 0.4);
    alpha = 0.95 * (1.0 - smoothstep(0.8, 1.0, u));
    shape = 0.0;
  } else if (kind < ${KIND.ring.id}.5) {
    life = ${KIND.ring.life.toFixed(2)};
    float u = age / life;
    // flat on the water, spreading and thinning
    size = (0.14 + 0.8 * (1.0 - (1.0 - u) * (1.0 - u))) * scale;
    p = o + vec3(0.0, 0.18, 0.0);
    colour = ${COL.foam};
    alpha = 0.6 * (1.0 - u);
    shape = 3.0;
  } else if (kind < ${KIND.dust.id}.5) {
    life = 0.9 + 0.4 * rnd(seed, 2.0);
    float u = age / life;
    float r = 0.35 + 0.5 * rnd(seed, 3.0);
    // out fast, slowing, a little up
    float d = r * (1.0 - exp(-3.0 * age));
    p = o + vec3(cos(th) * d, 0.0, sin(th) * d);
    size = (0.14 + 0.26 * sqrt(u)) * (0.8 + 0.4 * rnd(seed, 5.0)) * scale;
    colour = mix(${COL.sandLight}, ${COL.snowLight}, 0.2 + 0.4 * rnd(seed, 8.0));
    alpha = 0.75 * pow(1.0 - u, 1.2) * min(1.0, age * 12.0);
    // sat on the ground, not cut by it
    p.y += size * 0.8 + 0.3 * age * rnd(seed, 4.0);
    spin = rnd(seed, 6.0) * 6.28;
    shape = 5.0;
  } else if (kind < ${KIND.pages.id}.5) {
    life = 1.4 + 0.4 * rnd(seed, 2.0);
    float u = age / life;
    // lifted, then drifting down, swaying side to side
    float rise = 0.7 * (1.0 - exp(-4.0 * age)) - 0.3 * age;
    float sway = sin(age * 5.0 + th) * 0.18;
    vec2 out2 = vec2(cos(th), sin(th)) * (0.25 * age + 0.1);
    vec2 side = vec2(-sin(th), cos(th)) * sway;
    p = o + vec3(out2.x + side.x, 0.25 + rise, out2.y + side.y);
    size = 0.16 * scale;
    stretch = vec2(1.0, 0.75 * (0.35 + 0.65 * abs(cos(age * 4.0 + th))));
    spin = sin(age * 3.0 + th) * 0.8;
    colour = mix(${COL.whitewash}, ${COL.sandLight}, rnd(seed, 8.0));
    alpha = 1.0 - smoothstep(0.75, 1.0, u);
    shape = 1.0;
  } else if (kind < ${KIND.motes.id}.5) {
    life = 1.1 + 0.5 * rnd(seed, 2.0);
    float u = age / life;
    float a = th + age * (2.0 + rnd(seed, 3.0));
    float rad = 0.2 + 0.25 * rnd(seed, 4.0) + 0.15 * age;
    p = o + vec3(cos(a) * rad, 0.2 + age * (0.45 + 0.35 * rnd(seed, 5.0)), sin(a) * rad);
    size = 0.1 * (0.7 + 0.6 * rnd(seed, 6.0)) * (0.75 + 0.25 * sin(age * 18.0 + th)) * scale;
    colour = mix(${COL.tealLight}, ${COL.glow}, rnd(seed, 8.0)) * 5.0;
    alpha = sin(3.1416 * clamp(u, 0.0, 1.0));
    add = 1.0; lit = false; shape = 0.0;
  } else if (kind < ${KIND.glint.id}.5) {
    life = ${KIND.glint.life.toFixed(2)};
    float u = age / life;
    p = o + vec3(0.0, 0.05 * age, 0.0);
    size = 0.38 * sin(3.1416 * clamp(u, 0.0, 1.0)) * scale;
    spin = age * 2.0 + th;
    colour = mix(${COL.gold}, ${COL.glow}, 0.5) * 4.0;
    alpha = 1.0;
    add = 1.0; lit = false; shape = 2.0;
  } else if (kind < ${KIND.steam.id}.5) {
    // steam: puffs off the work, staggered, rising and slowing, growing as they thin
    float delay = 0.35 * rnd(seed, 2.0);
    life = 1.1 + 0.5 * rnd(seed, 3.0) + delay;
    age -= delay;
    float u = age / (life - delay);
    float rise = (0.9 + 0.5 * rnd(seed, 4.0)) * (1.0 - exp(-1.5 * age)) / 1.5;
    float drift = (0.12 + 0.3 * rnd(seed, 5.0)) * age;
    p = o + vec3(cos(th) * drift, 0.1 + rise, sin(th) * drift);
    size = (0.08 + 0.2 * sqrt(max(u, 0.0))) * scale;
    colour = ${COL.snowLight};
    alpha = 0.7 * (1.0 - u) * min(1.0, age * 8.0);
    spin = th;
    shape = 5.0;
  } else if (kind < ${KIND.shoot.id}.5) {
    // arrows: each flies in along the facing and stands in the target, one after another
    float delay = 0.22 * rnd(seed, 2.0);
    float fly = 0.16;
    float a = age - delay;
    vec3 dir = vec3(sin(yaw), 0.0, cos(yaw));
    vec3 hit = o + vec3(rnd(seed, 3.0) - 0.5, rnd(seed, 4.0) - 0.5, rnd(seed, 5.0) - 0.5) * 0.35;
    // from short of the target and a little above, fast, dropping into it
    vec3 from = hit - dir * 3.2 + vec3(0.0, 0.7, 0.0);
    float f = clamp(a / fly, 0.0, 1.0);
    p = mix(from, hit, f);
    float fb = clamp((a - 0.045) / fly, 0.0, 1.0);
    prev = mix(from, hit, fb);
    // landed: the shaft stands in it
    if (a >= fly) prev = hit - dir * 0.3 + vec3(0.0, 0.06, 0.0);
    size = 0.06 * scale;
    age = a;
    colour = mix(${COL.sandLight}, vec3(1.0), 0.6) * 1.4;
    alpha = 1.0 - smoothstep(0.55, 1.0, (a - fly) / 0.75);
    lit = false; shape = 4.0;
    life = fly + 0.75;
  } else if (kind < ${KIND.pin.id}.5) {
    // paper sheets drift in from the side, flutter and lie pinned to the board
    float delay = 0.3 * rnd(seed, 2.0);
    life = 1.9;
    age -= delay;
    float u = age / life;
    float settle = 1.0 - smoothstep(0.0, 0.55, age);
    vec2 side = vec2(cos(th), sin(th));
    vec3 rest = vec3((rnd(seed, 3.0) - 0.5) * 1.0, 0.1 + (rnd(seed, 4.0) - 0.5) * 0.55, 0.0);
    vec3 off = vec3(side.x * 0.7, 0.8, side.y * 0.7) * settle;
    off.x += sin(age * 14.0 + th) * 0.12 * settle;
    off.y += sin(age * 9.0 + th * 2.0) * 0.1 * settle;
    p = o + rest + off;
    size = 0.19 * scale;
    stretch = vec2(0.8, 1.0);
    spin = (rnd(seed, 6.0) - 0.5) * 0.5 + sin(age * 12.0 + th) * 0.6 * settle;
    colour = mix(${COL.whitewash}, vec3(1.0), 0.3 + 0.4 * rnd(seed, 8.0)) * 1.1;
    alpha = min(1.0, age * 10.0) * (1.0 - smoothstep(0.8, 1.0, u));
    shape = 1.0;
    life += delay;
    age += delay;
  } else {
    // cheer: confetti thrown up from the heroes, fluttering down, with the odd glint
    life = 1.0 + 0.5 * rnd(seed, 2.0);
    float u = age / life;
    bool star = rnd(seed, 9.0) < 0.25;
    float r = 0.5 + 1.0 * rnd(seed, 3.0);
    float up = 3.0 + 1.6 * rnd(seed, 4.0);
    // light: the paper slows and sways rather than falls
    float a = age;
    vec3 q = o + vec3(cos(th) * r * (1.0 - exp(-2.5 * a)) / 2.5, up * (1.0 - exp(-2.0 * a)) / 2.0 - 0.7 * a, sin(th) * r * (1.0 - exp(-2.5 * a)) / 2.5);
    q.y -= 1.1 * a * a;
    q.xz += vec2(sin(a * 7.0 + th), cos(a * 6.0 + th * 2.0)) * 0.08 * a;
    p = q;
    float ci = floor(rnd(seed, 8.0) * 5.0);
    colour = ci < 1.0 ? ${COL.red} : ci < 2.0 ? ${COL.blue} : ci < 3.0 ? ${COL.green} : ci < 4.0 ? ${COL.gold} : ${COL.orangeLight};
    if (star) {
      size = 0.2 * sin(3.1416 * clamp(u, 0.0, 1.0)) * scale;
      spin = age * 3.0 + th;
      colour = mix(${COL.gold}, ${COL.glow}, 0.5) * 4.0;
      alpha = 1.0; add = 1.0; lit = false; shape = 2.0;
    } else {
      size = 0.07 * (0.8 + 0.5 * rnd(seed, 5.0)) * scale;
      stretch = vec2(1.0, 0.55 + 0.45 * abs(sin(age * 9.0 + th)));
      spin = age * (6.0 + 6.0 * rnd(seed, 6.0));
      colour *= 1.1;
      alpha = 1.0 - smoothstep(0.75, 1.0, u);
      lit = false; shape = 1.0;
    }
  }

  float far = 1.0 - smoothstep(uFade.x, uFade.y, distance(cameraPosition, o));
  alpha *= far;
  // not yet born, or gone: a degenerate quad off the screen
  if (age < 0.0 || age > life || alpha <= 0.002 || size <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  vColour = lit ? colour * uLight : colour;
  vAlpha = clamp(alpha, 0.0, 1.0);
  vAdd = add;
  vShape = shape;

  if (shape > 3.5 && shape < 4.5) {
    // a streak from where it was a moment ago to where it is, across the view
    vec4 a = viewMatrix * vec4(p, 1.0);
    vec4 b = viewMatrix * vec4(prev, 1.0);
    vec2 d = a.xy - b.xy;
    float n = length(d);
    vec2 along = n > 1e-5 ? d / n : vec2(0.0, 1.0);
    vec2 across = vec2(-along.y, along.x);
    vec4 mv = corner.x > 0.0 ? a : b;
    mv.xy += along * corner.x * size + across * corner.y * size;
    gl_Position = projectionMatrix * mv;
    return;
  }
  if (shape > 2.5 && shape < 3.5) {
    // flat on the water
    gl_Position = projectionMatrix * viewMatrix * vec4(p + vec3(corner.x, 0.0, corner.y) * size, 1.0);
    return;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += turn(corner * stretch, spin) * size;
  gl_Position = projectionMatrix * mv;
}
`

export const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColour;
varying float vAlpha;
varying float vAdd;
varying float vShape;
void main() {
  float a = vAlpha;
  float r = length(vUv);
  if (vShape < 0.5) {
    float k = clamp(1.0 - r * r, 0.0, 1.0);
    a *= k * k;
  } else if (vShape < 1.5) {
    // a card: hard edged, a little darker toward one side so it reads as a flake
    a *= 1.0;
  } else if (vShape < 2.5) {
    float x = abs(vUv.x);
    float y = abs(vUv.y);
    float star = max(0.0, 1.0 - x * 7.0) * (1.0 - y) + max(0.0, 1.0 - y * 7.0) * (1.0 - x);
    a *= clamp(star + exp(-r * r * 14.0), 0.0, 1.0);
  } else if (vShape < 3.5) {
    a *= smoothstep(0.52, 0.8, r) * (1.0 - smoothstep(0.82, 1.0, r));
  } else if (vShape < 4.5) {
    a *= 1.0 - vUv.y * vUv.y;
  } else {
    // a cartoon puff: a firm round edge, a little lighter in the middle
    a *= 1.0 - smoothstep(0.78, 1.0, r);
  }
  if (a < 0.004) discard;
  // premultiplied: an additive particle writes no alpha, so it adds its light
  gl_FragColor = vec4(vColour * a, a * (1.0 - vAdd));
}
`
