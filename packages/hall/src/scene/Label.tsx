import { type ThreeElements, useStore } from "@react-three/fiber"
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react"
import type { Group } from "three"
import { join, placed, setContent, Z_RANGE } from "./ChipLayer.tsx"

export interface LabelProps {
  /** Where the label stands, in its parent's space. */
  position?: ThreeElements["group"]["position"]
  /** Centre the label's box on that point (drei's `center`). */
  center?: boolean
  /** Z-index at the camera's near plane and at its far plane: nearer labels over farther ones. */
  zIndexRange?: readonly [number, number]
  style?: CSSProperties
  className?: string
  children?: ReactNode
}

/**
 * HTML over a point in the scene, the way drei's `<Html>` places it (same props, same DOM), but
 * every label on the canvas shares one overlay (scene/ChipLayer.tsx): one container, one React
 * root, one projection pass a frame. Here a label is only a point in the scene graph and an entry
 * in that layer; its content is handed over on every render.
 *
 * The layer's root lives as long as any label does and is unmounted from a task of its own, never
 * inside a commit, so a deep link that puts the whole cast on stage in the Canvas's first commit
 * (which runs inside ReactDOM's) is safe.
 */
export function Label({
  position,
  center = false,
  zIndexRange = Z_RANGE,
  style,
  className,
  children,
}: LabelProps) {
  const store = useStore()
  const anchor = useRef<Group>(null)
  const [label] = useState(placed)
  useLayoutEffect(() => {
    label.anchor = anchor.current
    const leave = join(store, label)
    return () => {
      leave()
      label.anchor = null
    }
  }, [store, label])
  useLayoutEffect(() => {
    setContent(label, { children, style, className, center }, zIndexRange)
  })
  return <group ref={anchor} position={position} />
}
