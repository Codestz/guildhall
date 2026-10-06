import { useEffect, useState } from "react"

/**
 * An object made and freed by the same mount. useMemo + an effect cleanup breaks under StrictMode
 * (the cleanup disposes what the second mount keeps drawing — fatal for a BatchedMesh, whose
 * dispose drops its textures); here every mount builds its own and frees exactly that one.
 */
/** `key`: rebuild when it changes (identity). `make` and `free` are read on that mount only. */
export function useOwned<T>(make: () => T, free: (value: T) => void, key: unknown): T | null {
  const [value, setValue] = useState<T | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` alone decides when to rebuild
  useEffect(() => {
    const made = make()
    setValue(made)
    return () => {
      setValue(null)
      free(made)
    }
  }, [key])
  return value
}
