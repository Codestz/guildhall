import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import {
  BoxGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three"
import type { Moment } from "../../guild/moments.ts"
import { hear, masterOf } from "../../guild/ravens.ts"
import { positions, useGuildStore } from "../../guild/useGuild.ts"
import { useOwnedMeshes } from "../owned.ts"
import { wing } from "./Birds.tsx"

/**
 * Ravens carry the guild's messages (docs/ideas.md), hung on the store's moment stream (ADR 0008),
 * so they fly for live OpenCode sessions, replays and the simulator alike:
 *   join   the guildmaster sends a quest: a raven flies from them to the new adventurer, homing
 *          in on them as they walk
 *   loot   a quest is done: the worker's raven carries the news back to the guildmaster
 *   plea   an adventurer asks for permission: a raven rises and circles above them, calling you
 * Each carries a sealed letter in the sender's colour. Two draw calls (ravens, letters).
 */
const MAX = 8
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
  // Ravens and letters: this mount's own (scene/owned.ts).
  const built = useOwnedMeshes(() => {
    // Lit, blue-black with a sheen: flat unlit black read as glitch shards (design review #7).
    const material = new MeshStandardMaterial({
      color: "#2a3142",
      roughness: 0.45,
      metalness: 0.15,
      side: DoubleSide,
      flatShading: true,
    })
    const letterMaterial = new MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 })
    const ravens = new InstancedMesh(wing(), material, MAX)
    const letters = new InstancedMesh(new BoxGeometry(0.34, 0.06, 0.24), letterMaterial, MAX)
    ravens.frustumCulled = false
    letters.frustumCulled = false
    return { meshes: [ravens, letters] }
  }, [])
  const sky = useMemo(() => ({ flights: [] as Flight[], time: 0 }), [])
  // Only live moments send a raven (never a flock on a seek or a replayed backlog); a rebuild
  // grounds whatever is in the air. They are queued here and launched in the frame, below.
  const news = useMemo<Moment[]>(() => [], [])
  useEffect(() => {
    const off = store.moments.on((moment) => {
      hear(news, moment, document.hidden)
    })
    const offRebuild = store.moments.onRebuild(() => {
      news.length = 0
      sky.flights.length = 0
    })
    return () => {
      off()
      offRebuild()
    }
  }, [store, news, sky])

  useFrame((_, delta) => {
    const body = built?.meshes[0]
    const seal = built?.meshes[1]
    if (!body || !seal) return
    const dt = Math.min(delta, 0.1)
    sky.time += dt
    launch(news, store.views, sky.flights)

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
      const size = 1.95 * Math.min(1, t * 8, (1 - t) * 8)
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
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

/** New moments → new flights, newest first while there is room in the sky. */
function launch(news: Moment[], views: readonly { id: string; master: boolean }[], flights: Flight[]): void {
  for (let i = news.length - 1; i >= 0; i--) {
    const entry = news[i]
    if (!entry || flights.length >= MAX) continue
    const master = masterOf(entry, views)
    const here = positions.get(entry.id)
    const there = master ? positions.get(master.id) : undefined
    const color = new Color(entry.color)
    if (entry.kind === "join" && master && there && entry.id !== master.id) {
      flights.push({
        kind: "carry",
        from: there.clone().setY(there.y + 2.4),
        to: entry.id,
        age: 0,
        duration: 2.6,
        color,
      })
    } else if (entry.kind === "loot" && master && here && entry.id !== master.id) {
      flights.push({
        kind: "carry",
        from: here.clone().setY(here.y + 2.4),
        to: master.id,
        age: 0,
        duration: 2.6,
        color,
      })
    } else if (entry.kind === "plea" && here) {
      flights.push({ kind: "plea", from: here.clone(), to: entry.id, age: 0, duration: PLEA_S, color })
    }
  }
  news.length = 0
}

const UP = new Vector3(0, 1, 0)
const goal = new Vector3()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const matrix = new Matrix4()
