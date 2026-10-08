import { Html } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { type ComponentProps, useRef, useState } from "react"

/**
 * drei's `<Html>`, mounted from the first frame on. Each `<Html>` is a ReactDOM root of its own,
 * created in a layout effect and unmounted synchronously in its cleanup. The Canvas's first commit
 * runs synchronously inside ReactDOM's own commit (R3F mounts "within the caller's commit"), so a
 * label mounted there — a deep link that seeks mid-story puts the whole cast on stage in that very
 * commit — has its root made and (StrictMode's effect replay, a sibling suspending) torn down while
 * React is already rendering: "Attempted to synchronously unmount a root while React was already
 * rendering". From a frame (requestAnimationFrame, outside any commit) every later mount and
 * unmount happens in R3F's own scheduled commits. The label shows one frame late: unnoticeable.
 */
export function Label(props: ComponentProps<typeof Html>) {
  const [ready, setReady] = useState(false)
  const asked = useRef(false)
  useFrame(() => {
    if (asked.current) return
    asked.current = true
    setReady(true)
  })
  return ready ? <Html {...props} /> : null
}
