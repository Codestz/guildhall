import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import {
  BoxGeometry,
  Color,
  DoubleSide,
  type InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three"
import type { LogEntry } from "../../guild/store.ts"
import { positions, useGuildStore } from "../../guild/useGuild.ts"
import { wing } from "./Birds.tsx"

/**
 * Ravens carry the guild's messages (docs/ideas.md), read from the chronicle like everything else,
 * so they fly for live OpenCode sessions, replays and the simulator alike:
 *   join   the guildmaster sends a quest: a raven flies from them to the new adventurer, homing
 *          in on them as they walk
 *   loot   a quest is done: the worker's raven carries the news back to the guildmaster
 *   plea   an adventurer asks for permission: a raven rises and circles above them, calling you
 * Each carries a sealed letter in the sender's colour. Two draw calls (ravens, letters).
 */
const MAX = 8
/** Only what happens now sends a raven: never a flock on a seek or a replayed backlog. */
const FRESH_MS = 1500
const PLEA_S = 5

interface Flight {
  kind: "carry" | "plea"
  from: Vector3
  /** Whose position to fly to (followed live), or circle above for a plea. */
  to: string
  age: number
  duration: number
  color: Color
}

export function Ravens() {
  const store = useGuildStore()
  const geometry = useMemo(wing, [])
  const letterGeometry = useMemo(() => new BoxGeometry(0.34, 0.06, 0.24), [])
  const material = useMemo(() => new MeshBasicMaterial({ color: "#16181c", side: DoubleSide }), [])
  const letterMaterial = useMemo(() => new MeshBasicMaterial({ color: "#ffffff" }), [])
  const ravens = useRef<InstancedMesh>(null)
  const letters = useRef<InstancedMesh>(null)
  const sky = useMemo(() => ({ flights: [] as Flight[], seen: -1, time: 0 }), [])

  useEffect(
    () => () => {
      geometry.dispose()
      letterGeometry.dispose()
      material.dispose()
      letterMaterial.dispose()
    },
    [geometry, letterGeometry, material, letterMaterial],
  )

  useFrame((_, delta) => {
    const body = ravens.current
    const seal = letters.current
    if (!body || !seal) return
    const dt = Math.min(delta, 0.1)
    sky.time += dt
    collect(store.log, store.time, store.views, sky)

    let k = 0
    for (let i = sky.flights.length - 1; i >= 0; i--) {
      const flight = sky.flights[i]
      if (!flight) continue
      flight.age += dt
      const at = positions.get(flight.to)
      // A new adventurer mounts a frame or two after their chronicle line: wait for them, briefly.
      if (flight.age > flight.duration || (!at && flight.age > 1)) {
        sky.flights.splice(i, 1)
        continue
      }
      if (!at) {
        flight.age = 0
        continue
      }
      const t = flight.age / flight.duration
      let heading: number
      if (flight.kind === "carry") {
        // A high arc, landing just above the recipient's head.
        goal.set(at.x, at.y + 3, at.z)
        const distance = flight.from.distanceTo(goal)
        const s = MathUtils.smootherstep(t, 0, 1)
        position.lerpVectors(flight.from, goal, s)
        position.y += Math.sin(Math.PI * s) * (3 + distance * 0.22)
        heading = Math.atan2(goal.x - flight.from.x, goal.z - flight.from.z)
      } else {
        // Rise from them, circle above, calling.
        const rise = MathUtils.smoothstep(t, 0, 0.25)
        const angle = sky.time * 2.4 + i
        const radius = 1.4 * rise
        position.set(
          at.x + Math.cos(angle) * radius,
          at.y + 2.2 + rise * 2.6,
          at.z + Math.sin(angle) * radius,
        )
        heading = -angle
      }
      // Grow in, shrink out; flap hard, glide at the top of the arc.
      const size = 1.5 * Math.min(1, t * 8, (1 - t) * 8)
      const beat =
        Math.sin(sky.time * 13 + i * 2) * (flight.kind === "carry" && t > 0.35 && t < 0.65 ? 0.3 : 1)
      rotation.setFromAxisAngle(UP, heading)
      body.setMatrixAt(k, matrix.compose(position, rotation, scale.set(size, size * beat, size)))
      position.y -= 0.18 * size
      seal.setMatrixAt(k, matrix.compose(position, rotation, scale.setScalar(size)))
      seal.setColorAt(k, flight.color)
      k++
    }
    body.count = k
    seal.count = k
    body.instanceMatrix.needsUpdate = true
    seal.instanceMatrix.needsUpdate = true
    if (seal.instanceColor) seal.instanceColor.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={ravens} args={[geometry, material, MAX]} frustumCulled={false} />
      <instancedMesh ref={letters} args={[letterGeometry, letterMaterial, MAX]} frustumCulled={false} />
    </>
  )
}

/** New chronicle lines → new flights. A rewind (seek, new story) just resets what's been seen. */
function collect(
  log: LogEntry[],
  now: number,
  views: readonly { id: string; master: boolean }[],
  sky: { flights: Flight[]; seen: number },
): void {
  const newest = log.at(-1)?.key ?? -1
  if (newest < sky.seen) {
    sky.seen = newest
    sky.flights.length = 0
    return
  }
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]
    if (!entry || entry.key <= sky.seen) break
    if (now - entry.at > FRESH_MS || sky.flights.length >= MAX) continue
    const master = views.find((v) => v.master)
    const here = positions.get(entry.id)
    const there = master ? positions.get(master.id) : undefined
    const color = new Color(entry.color)
    if (entry.kind === "join" && master && there && entry.id !== master.id) {
      sky.flights.push({
        kind: "carry",
        from: there.clone().setY(there.y + 2.4),
        to: entry.id,
        age: 0,
        duration: 2.6,
        color,
      })
    } else if (entry.kind === "loot" && master && here && entry.id !== master.id) {
      sky.flights.push({
        kind: "carry",
        from: here.clone().setY(here.y + 2.4),
        to: master.id,
        age: 0,
        duration: 2.6,
        color,
      })
    } else if (entry.kind === "plea" && here) {
      sky.flights.push({ kind: "plea", from: here.clone(), to: entry.id, age: 0, duration: PLEA_S, color })
    }
  }
  sky.seen = newest
}

const UP = new Vector3(0, 1, 0)
const goal = new Vector3()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const matrix = new Matrix4()
