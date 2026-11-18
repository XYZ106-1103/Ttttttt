/**
 * Global engine constants shared by client and server.
 * Changing these affects world data layout and physics tuning — treat as a breaking change.
 */

/** Edge length of one tile in world pixels. */
export const TILE_SIZE = 16;

/** Edge length of one chunk in tiles. Chunks are the unit of streaming, rendering and persistence. */
export const CHUNK_SIZE = 32;

/** Edge length of one chunk in world pixels. */
export const CHUNK_PIXELS = TILE_SIZE * CHUNK_SIZE;

/** Fixed simulation rate. Simulation is deterministic per tick; rendering interpolates between ticks. */
export const SIM_HZ = 60;

/** Fixed simulation step in seconds. */
export const SIM_DT = 1 / SIM_HZ;
