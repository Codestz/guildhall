/**
 * Test preload (bunfig.toml): evaluate three's ESM build once, synchronously, before any test file.
 * Tests that `await import()` the TSL/WebGPU graph leave three's module mid-load; @react-three/fiber's
 * CommonJS build then `require()`s it and Bun 1.4 throws "require() async module … is unsupported"
 * between tests. Loaded here first, the require finds a finished module.
 */
import "three"
