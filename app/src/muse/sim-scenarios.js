/**
 * Empathic Art -- Simulated journeys
 *
 * A small library of scripted brain-signal journeys for the Simulate button.
 * Each scenario is a named sequence of waypoints on the circumplex; the
 * journey is easeInOut-interpolated between waypoints at ~30 Hz by the
 * MuseSource sim loop, so the user -- with no headband on their head --
 * still sees the fluid, the reveal word, and the log narrate a coherent
 * emotional arc.
 *
 * Scenarios are keyframed rather than random. Same picker choice, same
 * journey, every time. That is a demo need, not a research need -- when
 * a curator is on Zoom watching the piece, we need it to hit predictable
 * beats.
 *
 * Waypoint format:
 *   { name: string,   // emotion label (must exist in EMOTIONS)
 *     w: number,      // weight -- fraction of the total session duration
 *     o: number,      // openness at this waypoint, [0, 1]
 *   }
 * Weights across a scenario sum to ~1.0 (small drift tolerated -- the
 * journey builder normalises time proportionally to totalSeconds).
 *
 * @author  Eyal Gever
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

/**
 * The scenarios themselves. Ordered so the picker shows a natural progression
 * from the safe demo default to more specific arcs.
 */
export const SIM_SCENARIOS = [
  {
    id: "full-circuit",
    label: "Full circuit",
    description: "Walks the whole circumplex -- calm, sad, surge, peak, back to peace. Best for a first demo.",
    legs: [
      { name: "SEED",          w: 0.06, o: 0.50 },
      { name: "Contemplation", w: 0.10, o: 0.45 },
      { name: "Sadness",       w: 0.10, o: 0.30 },
      { name: "Melancholy",    w: 0.10, o: 0.28 },
      { name: "Anger",         w: 0.12, o: 0.55 },
      { name: "Stress",        w: 0.08, o: 0.50 },
      { name: "Awe",           w: 0.10, o: 0.72 },
      { name: "Joy",           w: 0.14, o: 0.85 },
      { name: "Serenity",      w: 0.10, o: 0.70 },
      { name: "Peace",         w: 0.10, o: 0.65 },
    ],
  },
  {
    id: "contemplation-walk",
    label: "Contemplation walk",
    description: "Slow, mostly negative-valence low-arousal drift -- sadness, melancholy, apathy, back to contemplation.",
    legs: [
      { name: "SEED",          w: 0.08, o: 0.42 },
      { name: "Contemplation", w: 0.16, o: 0.48 },
      { name: "Melancholy",    w: 0.18, o: 0.32 },
      { name: "Sadness",       w: 0.18, o: 0.28 },
      { name: "Apathy",        w: 0.12, o: 0.30 },
      { name: "Melancholy",    w: 0.12, o: 0.34 },
      { name: "Contemplation", w: 0.16, o: 0.50 },
    ],
  },
  {
    id: "elation-arc",
    label: "Elation arc",
    description: "Builds slowly from calm to peak positive-valence high-arousal -- awe, joy, elation, love.",
    legs: [
      { name: "SEED",          w: 0.08, o: 0.55 },
      { name: "Serenity",      w: 0.12, o: 0.65 },
      { name: "Peace",         w: 0.10, o: 0.62 },
      { name: "Awe",           w: 0.16, o: 0.78 },
      { name: "Joy",           w: 0.16, o: 0.85 },
      { name: "Elation",       w: 0.14, o: 0.88 },
      { name: "Love",          w: 0.12, o: 0.80 },
      { name: "Serenity",      w: 0.12, o: 0.70 },
    ],
  },
  {
    id: "storm",
    label: "Storm",
    description: "High-arousal negative-valence pressure -- stress, anxiety, anger, fear -- resolving into calm.",
    legs: [
      { name: "SEED",          w: 0.06, o: 0.50 },
      { name: "Stress",        w: 0.14, o: 0.55 },
      { name: "Anxiety",       w: 0.14, o: 0.48 },
      { name: "Anger",         w: 0.16, o: 0.60 },
      { name: "Fear",          w: 0.14, o: 0.52 },
      { name: "Despair",       w: 0.12, o: 0.38 },
      { name: "Contemplation", w: 0.12, o: 0.55 },
      { name: "Serenity",      w: 0.12, o: 0.68 },
    ],
  },
  {
    id: "restless",
    label: "Restless",
    description: "Rapid crossings that never settle -- excitement, surprise, anxiety, boredom, elation. For stress-testing the log.",
    legs: [
      { name: "SEED",          w: 0.06, o: 0.50 },
      { name: "Excitement",    w: 0.10, o: 0.72 },
      { name: "Surprise",      w: 0.08, o: 0.68 },
      { name: "Anxiety",       w: 0.10, o: 0.42 },
      { name: "Boredom",       w: 0.10, o: 0.35 },
      { name: "Elation",       w: 0.10, o: 0.82 },
      { name: "Stress",        w: 0.10, o: 0.55 },
      { name: "Joy",           w: 0.10, o: 0.80 },
      { name: "Apathy",        w: 0.10, o: 0.30 },
      { name: "Contemplation", w: 0.08, o: 0.55 },
      { name: "Serenity",      w: 0.08, o: 0.68 },
    ],
  },
  {
    id: "deep-calm",
    label: "Deep calm",
    description: "Slow drift through the low-arousal positive quadrant -- serenity, calm, peace. Almost no crossings.",
    legs: [
      { name: "SEED",          w: 0.10, o: 0.55 },
      { name: "Serenity",      w: 0.22, o: 0.72 },
      { name: "Calm",          w: 0.22, o: 0.68 },
      { name: "Peace",         w: 0.24, o: 0.75 },
      { name: "Serenity",      w: 0.22, o: 0.70 },
    ],
  },
];

/** Look up a scenario by id. Returns undefined if not found. */
export function getScenario(id) {
  return SIM_SCENARIOS.find((s) => s.id === id);
}

/** Default scenario used when the user has not picked one. */
export const DEFAULT_SCENARIO_ID = "full-circuit";
